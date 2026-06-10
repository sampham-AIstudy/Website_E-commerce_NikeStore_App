var express = require('express');
var router  = express.Router();
var mysql   = require('mysql2');
var { vnpay, VnpLocale, ProductCode } = require('../utils/vnpayService');

// ─── Kết nối MySQL ─────────────────────────────────────────────────────────────
var db = mysql.createPool({
  host    : 'localhost',
  user    : 'root',
  password: '',
  database: 'nike_store',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
console.log('✅ Orders router đã khởi tạo MySQL Pool');

// ─── Helper: giảm stock sau khi thanh toán thành công ─────────────────────────
function reduceStock(orderId, callback) {
  db.query(
    'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
    [orderId],
    function (err, items) {
      if (err || !items || items.length === 0) return callback && callback();
      var done = 0;
      items.forEach(function (item) {
        db.query(
          'UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?',
          [item.quantity, item.product_id],
          function () { if (++done === items.length && callback) callback(); }
        );
      });
    }
  );
}

// ─── Helper: hoàn kho khi huỷ đơn (chỉ dùng khi stock đã bị trừ) ─────────────
function restoreStock(orderId, callback) {
  db.query(
    'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
    [orderId],
    function (err, items) {
      if (err || !items || items.length === 0) return callback && callback();
      var done = 0;
      items.forEach(function (item) {
        db.query(
          'UPDATE products SET stock = stock + ? WHERE id = ?',
          [item.quantity, item.product_id],
          function () { if (++done === items.length && callback) callback(); }
        );
      });
    }
  );
}

// ─── Map: inMemory timeout handles cho auto-cancel ───────────────────────────
// key: orderId (string), value: Timeout handle
var pendingVnpayTimers = {};

function scheduleVnpayAutoCancel(orderId, delayMs) {
  // Xoá timer cũ nếu có (idempotent)
  if (pendingVnpayTimers[orderId]) {
    clearTimeout(pendingVnpayTimers[orderId]);
  }
  pendingVnpayTimers[orderId] = setTimeout(function () {
    delete pendingVnpayTimers[orderId];
    // Chỉ cancel nếu vẫn còn đang ở trạng thái pending_payment
    db.query(
      "UPDATE orders SET status = 'pending', payment_status = 'failed' " +
      "WHERE id = ? AND status = 'pending_payment'",
      [orderId],
      function (err, result) {
        if (!err && result.affectedRows > 0) {
          console.log(`⏰ [VNPay] Đơn hàng #${orderId} đã hết thời gian thanh toán, chuyển sang trạng thái pending.`);
          // Giải phóng voucher
          db.query(
            "UPDATE user_vouchers SET order_id = NULL WHERE order_id = ? AND is_used = 0",
            [orderId]
          );
        }
      }
    );
  }, delayMs);
}

// =============================================
// POST /api/orders/checkout  →  Xử lý Thanh Toán
// =============================================
router.post('/checkout', async function (req, res) {
  var { user_id, fullname, phone, address, cartItems, voucher_ids, payment_method } = req.body;
  payment_method = (payment_method || 'cod').toLowerCase();

  if (!fullname || !phone || !address || !cartItems || cartItems.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đủ thông tin và sản phẩm' });
  }

  const promiseDb = db.promise();
  try {
    await promiseDb.query('START TRANSACTION');

    // 1. Lấy thông tin giá, tồn kho của sản phẩm
    const productIds = cartItems.map(i => i.id);
    const [products] = await promiseDb.query(
      'SELECT id, title, price, stock, category, item_type, discount_percent FROM products WHERE id IN (?) FOR UPDATE',
      [productIds]
    );

    const stockMap = {};
    products.forEach(p => { stockMap[p.id] = p; });

    let backendSubtotal = 0;

    // Kiểm tra tồn kho & tính subtotal
    for (const item of cartItems) {
      const p = stockMap[item.id];
      if (!p) {
        await promiseDb.query('ROLLBACK');
        return res.status(400).json({ status: 'error', message: 'Sản phẩm không tồn tại (ID: ' + item.id + ')' });
      }
      const qty = item.cartQuantity || 1;
      if (p.stock < qty) {
        await promiseDb.query('ROLLBACK');
        return res.status(400).json({ status: 'error', message: 'Sản phẩm "' + p.title + '" chỉ còn ' + p.stock + ' trong kho!' });
      }
      
      // Override price from DB to prevent tampering
      item.price = p.price; 
      item.dbProduct = p; // Luu tạm để tính voucher
      backendSubtotal += (p.price * qty);
    }

    let backendTax = backendSubtotal * 0.10;
    let backendGrandTotal = backendSubtotal + backendTax;

    // 2. Tính toán Vouchers
    let totalDiscount = 0;
    if (voucher_ids && voucher_ids.length > 0) {
      const [vouchers] = await promiseDb.query('SELECT * FROM vouchers WHERE id IN (?)', [voucher_ids]);
      
      for (const v of vouchers) {
        let eligibleAmount = 0;
        
        if (v.category === 'shipping') {
          // Giả sử phí ship cố định 30000 giống frontend
          eligibleAmount = 30000;
        } else {
          // Product voucher
          for (const item of cartItems) {
            const p = item.dbProduct;
            let isEligible = true;
            if (v.apply_scope === 'category') {
              const allowed = (v.scope_value || '').toLowerCase().split(',').map(s => s.trim());
              isEligible = allowed.includes((p.category||'').toLowerCase()) || allowed.includes((p.item_type||'').toLowerCase());
            } else if (v.apply_scope === 'exclude_outlet') {
              isEligible = parseInt(p.discount_percent || 0) === 0;
            }
            
            if (isEligible) {
              eligibleAmount += (item.price * (item.cartQuantity || 1)) * 1.10; // Tính cả thuế
            }
          }
        }

        // Kiểm tra điều kiện tối thiểu
        if (eligibleAmount > 0 && backendGrandTotal >= v.min_order_value) {
          let disc = 0;
          if (v.discount_type === 'fixed') {
            disc = parseFloat(v.discount_value);
          } else {
            disc = eligibleAmount * (parseFloat(v.discount_value) / 100);
            if (v.max_discount && disc > parseFloat(v.max_discount)) {
              disc = parseFloat(v.max_discount);
            }
          }
          totalDiscount += disc;
        }
      }
    }

    if (totalDiscount > backendGrandTotal) totalDiscount = backendGrandTotal;
    backendGrandTotal -= totalDiscount;
    backendGrandTotal = Math.round(backendGrandTotal);

    // 3. Xử lý N-Coin
    if (payment_method === 'ncoin') {
      if (!user_id) {
        await promiseDb.query('ROLLBACK');
        return res.status(401).json({ status: 'error', message: 'Bạn phải đăng nhập để thanh toán bằng N-Coin.' });
      }
      const [users] = await promiseDb.query('SELECT n_coin FROM users WHERE id = ? FOR UPDATE', [user_id]);
      if (users.length === 0) {
        await promiseDb.query('ROLLBACK');
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
      }
      if (parseFloat(users[0].n_coin || 0) < backendGrandTotal) {
        await promiseDb.query('ROLLBACK');
        return res.status(400).json({ status: 'error', message: 'Số dư N-Coin không đủ để thanh toán!' });
      }
      
      // Trừ tiền
      const [updateRes] = await promiseDb.query('UPDATE users SET n_coin = n_coin - ? WHERE id = ? AND n_coin >= ?', [backendGrandTotal, user_id, backendGrandTotal]);
      if (updateRes.affectedRows === 0) {
        await promiseDb.query('ROLLBACK');
        return res.status(400).json({ status: 'error', message: 'Lỗi trừ tiền N-Coin (không đủ số dư).' });
      }
    }

    // 4. Tạo Order
    let initialStatus = 'processing';
    let pStatus = 'pending';
    let expiredDateStr = null;

    if (payment_method === 'vnpay') {
      initialStatus = 'pending_payment';
      pStatus = 'pending';
      const expiredDate = new Date(Date.now() + 15 * 60 * 1000);
      expiredDateStr = expiredDate.toISOString().slice(0, 19).replace('T', ' ');
    } else if (payment_method === 'vpbank') {
      initialStatus = 'pending';
      pStatus = 'unpaid';
    } else if (payment_method === 'ncoin') {
      initialStatus = 'processing'; 
      pStatus = 'paid';
    } else {
      // COD
      initialStatus = 'processing';
      pStatus = 'pending';
    }

    const [orderRes] = await promiseDb.query(`
      INSERT INTO orders
        (user_id, fullname, phone, address, total_amount, payment_method, status, payment_status, payment_expired_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [user_id || null, fullname, phone, address, backendGrandTotal, payment_method, initialStatus, pStatus, expiredDateStr]);

    const orderId = orderRes.insertId;

    // 5. Thêm Order Items
    const valuesItems = cartItems.map(item => [orderId, item.id, item.cartQuantity || 1, item.price, item.size || 'N/A', item.color || 'N/A']);
    await promiseDb.query('INSERT INTO order_items (order_id, product_id, quantity, price, size, color) VALUES ?', [valuesItems]);

    // 6. Cập nhật tồn kho (Ngoại trừ VNPay vì VNPay chỉ trừ khi thanh toán xong)
    if (payment_method !== 'vnpay') {
      for (const item of cartItems) {
        const qty = item.cartQuantity || 1;
        await promiseDb.query('UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?', [qty, item.id]);
      }
    }

    // 7. Gắn Voucher
    if (voucher_ids && voucher_ids.length > 0 && user_id) {
      await promiseDb.query('UPDATE user_vouchers SET order_id = ? WHERE user_id = ? AND voucher_id IN (?) AND is_used = 0', [orderId, user_id, voucher_ids]);
      if (payment_method !== 'vnpay') {
        // Mark used
        await promiseDb.query('UPDATE user_vouchers SET is_used = 1, used_at = NOW() WHERE order_id = ?', [orderId]);
        await promiseDb.query('UPDATE vouchers SET used_count = used_count + 1 WHERE id IN (?)', [voucher_ids]);
      }
    }

    await promiseDb.query('COMMIT');

    // 8. VNPay Redirect
    if (payment_method === 'vnpay') {
      handleVnpayCheckout(orderId, backendGrandTotal, user_id, voucher_ids, res, req);
    } else {
      res.json({ status: 'success', message: 'Đặt hàng thành công!', order_id: orderId });
    }

  } catch (err) {
    await promiseDb.query('ROLLBACK');
    console.error('Lỗi checkout:', err);
    res.status(500).json({ status: 'error', message: 'Lỗi hệ thống trong quá trình đặt hàng' });
  }
});

// ─── Gọi VNPay API sau khi đã tạo đơn ─────────────────────────────────────────
function handleVnpayCheckout(orderId, totalAmount, userId, voucherIds, res, req) {
  var amount = parseInt(totalAmount); // VNPay yêu cầu số tiền * 100 (đã fix, thư viện tự nhân)
  var ipAddr = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress || '127.0.0.1';

  try {
    const paymentUrl = vnpay.buildPaymentUrl({
      vnp_Amount: amount,
      vnp_IpAddr: ipAddr,
      vnp_TxnRef: orderId.toString() + '_' + Date.now(),
      vnp_OrderInfo: `Thanh toan don hang #${orderId}`,
      vnp_OrderType: ProductCode.Other,
      vnp_ReturnUrl: 'http://localhost:3000/payment/vnpay/return',
      vnp_Locale: VnpLocale.VN,
    });

    const urlParams = new URLSearchParams(paymentUrl.split('?')[1]);
    const txnRef = urlParams.get('vnp_TxnRef');

    db.query(
      'UPDATE orders SET vnpay_txn_ref = ? WHERE id = ?',
      [txnRef, orderId],
      function (err) {
        if (err) console.error('❌ Không lưu được vnpay_txn_ref:', err.message);
      }
    );

    scheduleVnpayAutoCancel(orderId, 15 * 60 * 1000);

    res.json({
      status  : 'vnpay_redirect',
      payUrl  : paymentUrl,
      order_id: orderId,
      message : 'Chuyển đến VNPay để thanh toán',
    });
  } catch (err) {
    console.error('❌ [VNPay] Lỗi gọi API:', err.message);
    db.query("UPDATE orders SET status = 'pending' WHERE id = ?", [orderId]);
    res.status(500).json({
      status : 'error',
      message: 'Không thể kết nối đến VNPay: ' + err.message,
    });
  }
}

// =============================================
// GET /api/orders/vnpay/ipn  →  VNPay gọi về để xác nhận kết quả thanh toán
// =============================================
router.get('/vnpay/ipn', function (req, res) {
  try {
    const verify = vnpay.verifyIpnCall(req.query);
    if (!verify.isSuccess) {
      return res.status(200).json({ RspCode: '97', Message: 'Checksum failed' });
    }
  } catch (e) {
    return res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
  }

  var vnpayTxnRef = req.query.vnp_TxnRef;
  var responseCode = req.query.vnp_ResponseCode;

  // Xử lý Nạp N-Coin
  if (vnpayTxnRef && vnpayTxnRef.startsWith('NCOIN_')) {
    if (responseCode === '00') {
      var parts = vnpayTxnRef.split('_'); // NCOIN_{userId}_{timestamp}
      if (parts.length >= 2) {
        var userId = parts[1];
        var amountInReq = parseInt(req.query.vnp_Amount) / 100;
        db.query("UPDATE users SET n_coin = COALESCE(n_coin, 0) + ? WHERE id = ?", [amountInReq, userId]);
      }
    }
    return res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
  }

  db.query(
    "SELECT * FROM orders WHERE vnpay_txn_ref = ? LIMIT 1",
    [vnpayTxnRef],
    function (err, rows) {
      if (err || rows.length === 0) {
        return res.status(200).json({ RspCode: '01', Message: 'Order not found' });
      }

      var order = rows[0];

      if (order.payment_status === 'paid' || order.status === 'cancelled') {
        return res.status(200).json({ RspCode: '02', Message: 'Order already confirmed' });
      }

      var amountInDb = parseInt(order.total_amount);
      var amountInReq = parseInt(req.query.vnp_Amount) / 100;
      if (amountInDb !== amountInReq) {
        return res.status(200).json({ RspCode: '04', Message: 'Invalid amount' });
      }

      if (responseCode === '00') {
        if (pendingVnpayTimers[order.id]) {
          clearTimeout(pendingVnpayTimers[order.id]);
          delete pendingVnpayTimers[order.id];
        }

        db.query(
          "UPDATE orders SET payment_status = 'paid', status = 'processing' WHERE id = ?",
          [order.id],
          function (err2) {
            db.query(
              "UPDATE vouchers v JOIN user_vouchers uv ON v.id = uv.voucher_id SET v.used_count = v.used_count + 1 WHERE uv.order_id = ?",
              [order.id]
            );
            db.query(
              "UPDATE user_vouchers SET is_used = 1, used_at = NOW() WHERE order_id = ? AND is_used = 0",
              [order.id]
            );
            reduceStock(order.id, function () {});
          }
        );
      } else {
        if (pendingVnpayTimers[order.id]) {
          clearTimeout(pendingVnpayTimers[order.id]);
          delete pendingVnpayTimers[order.id];
        }

        db.query(
          "UPDATE orders SET payment_status = 'failed', status = 'pending' WHERE id = ?",
          [order.id],
          function (errCancel) {
            db.query(
              "UPDATE user_vouchers SET order_id = NULL WHERE order_id = ? AND is_used = 0",
              [order.id]
            );
          }
        );
      }
      res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
    }
  );
});

// =============================================
// GET /api/orders/vnpay/check-payment  →  Frontend polling kết quả thanh toán
// =============================================
router.get('/vnpay/check-payment', function (req, res) {
  var orderId = req.query.order_id;
  if (!orderId) return res.status(400).json({ status: 'error', message: 'Thiếu order_id' });

  if (orderId.startsWith('NCOIN_')) {
    // Đối với N-Coin, giả lập thành công để polling dừng lại
    return res.json({ status: 'success', order: { payment_status: 'paid' } });
  }

  // Với order thì phải extract order id thật (vì mã trả về từ vnpay có thể là ID_Timestamp)
  var realOrderId = orderId.split('_')[0];

  db.query(
    'SELECT id, status, payment_status, payment_method, total_amount, created_at FROM orders WHERE id = ?',
    [realOrderId],
    function (err, rows) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
      res.json({ status: 'success', order: rows[0] });
    }
  );
});

// =============================================
// GET /api/orders  →  Lấy danh sách đơn hàng (Cho Admin)
// =============================================
router.get('/', function (req, res) {
  db.query('SELECT * FROM orders ORDER BY created_at DESC', function (err, results) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: results });
  });
});

// =============================================
// GET /api/orders/:id  →  Lấy chi tiết đơn hàng (Cho Admin)
// =============================================
router.get('/:id', function (req, res) {
  var orderId = req.params.id;
  db.query('SELECT * FROM orders WHERE id = ?', [orderId], function (err, ordersResult) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    if (ordersResult.length === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });

    var sqlItems = `
      SELECT oi.*, p.title, p.image
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `;
    db.query(sqlItems, [orderId], function (err2, itemsResult) {
      if (err2) return res.status(500).json({ status: 'error', message: err2.message });
      res.json({ status: 'success', order: ordersResult[0], items: itemsResult });
    });
  });
});

// =============================================
// PUT /api/orders/:id/status  →  Cập nhật trạng thái đơn hàng (Cho Admin)
// =============================================
router.put('/:id/status', function (req, res) {
  var orderId = req.params.id;
  var status  = req.body.status;

  if (!status) return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp trạng thái mới' });

  db.query('SELECT status, payment_method, delivered_at FROM orders WHERE id = ?', [orderId], function (err1, result1) {
    if (err1) return res.status(500).json({ status: 'error', message: err1.message });
    if (result1.length === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });

    var oldStatus = result1[0].status;
    var payMethod = result1[0].payment_method;
    var deliveredAt = result1[0].delivered_at;

    if (status === 'returning') {
      if (oldStatus !== 'delivered') {
        return res.status(400).json({ status: 'error', message: 'Chỉ có thể yêu cầu trả hàng khi đơn hàng đã được giao.' });
      }
      if (deliveredAt) {
        var diffDays = (Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 15) {
          return res.status(400).json({ status: 'error', message: 'Đã quá hạn 15 ngày để yêu cầu trả hàng.' });
        }
      }
    }

    var sqlUpdate = 'UPDATE orders SET status = ? WHERE id = ?';
    var sqlParams = [status, orderId];

    if (status === 'processing' && payMethod === 'vpbank') {
      sqlUpdate = 'UPDATE orders SET status = ?, payment_status = ? WHERE id = ?';
      sqlParams = [status, 'paid', orderId];
    } else if (status === 'delivered') {
      sqlUpdate = 'UPDATE orders SET status = ?, delivered_at = NOW() WHERE id = ?';
      sqlParams = [status, orderId];
    } else if (status === 'returning' && req.body.return_reason) {
      sqlUpdate = 'UPDATE orders SET status = ?, return_reason = ? WHERE id = ?';
      sqlParams = [status, req.body.return_reason, orderId];
    }

    db.query(sqlUpdate, sqlParams, function (err, result) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });

      // Xử lý kho hàng theo thay đổi trạng thái
      var stockChanged = false;
      var refundStatuses = ['cancelled', 'returned'];
      
      if (refundStatuses.includes(status) && !refundStatuses.includes(oldStatus) && oldStatus !== 'pending_payment') {
        stockChanged = true;
        restoreStock(orderId);
      } else if (refundStatuses.includes(oldStatus) && !refundStatuses.includes(status)) {
        stockChanged = true;
        reduceStock(orderId);
      }

      // Xử lý hoàn tiền N-Coin
      if (refundStatuses.includes(status) && !refundStatuses.includes(oldStatus)) {
        db.query('SELECT user_id, total_amount, payment_status FROM orders WHERE id = ?', [orderId], function(errOrder, orderData) {
          if (!errOrder && orderData.length > 0 && orderData[0].user_id) {
            var orderInfo = orderData[0];
            // Chỉ hoàn N-Coin nếu đơn đã được thanh toán (hoặc admin đánh dấu đã thu tiền)
            if (orderInfo.payment_status === 'paid') {
              db.query('UPDATE users SET n_coin = COALESCE(n_coin, 0) + ? WHERE id = ?', [orderInfo.total_amount, orderInfo.user_id]);
              db.query('UPDATE orders SET payment_status = "refunded" WHERE id = ?', [orderId]);
            }
          }
        });
      }

      res.json({ status: 'success', message: 'Đã cập nhật trạng thái đơn hàng thành công' });
    });
  });
});

// =============================================
// PUT /api/orders/:id/payment-status  →  Xác nhận thanh toán (Cho Admin)
// =============================================
router.put('/:id/payment-status', function (req, res) {
  var orderId        = req.params.id;
  var payment_status = req.body.payment_status;

  var allowed = ['pending', 'paid', 'failed'];
  if (!payment_status || !allowed.includes(payment_status)) {
    return res.status(400).json({ status: 'error', message: 'Trạng thái thanh toán không hợp lệ (pending/paid/failed)' });
  }

  db.query('UPDATE orders SET payment_status = ? WHERE id = ?', [payment_status, orderId], function (err, result) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    res.json({ status: 'success', message: 'Đã cập nhật trạng thái thanh toán thành công' });
  });
});

// =============================================
// POST /api/orders/:id/repay  →  Thanh Toán Lại Đơn Hàng Chờ Thanh Toán
// =============================================
router.post('/:id/repay', function (req, res) {
  var orderId = req.params.id;
  
  db.query(
    'SELECT * FROM orders WHERE id = ? AND status = "pending_payment"',
    [orderId],
    function (err, rows) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      if (rows.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng chờ thanh toán này hoặc đơn hàng đã được xử lý.' });
      }
      
      var order = rows[0];
      var amount = parseInt(order.total_amount);
      var ipAddr = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress || '127.0.0.1';
      
      try {
        const paymentUrl = vnpay.buildPaymentUrl({
          vnp_Amount: amount,
          vnp_IpAddr: ipAddr,
          vnp_TxnRef: order.id.toString() + '_' + Date.now(),
          vnp_OrderInfo: `Thanh toan lai don hang #${order.id}`,
          vnp_OrderType: ProductCode.Other,
          vnp_ReturnUrl: 'http://localhost:3000/payment/vnpay/return',
          vnp_Locale: VnpLocale.VN,
        });

        const urlParams = new URLSearchParams(paymentUrl.split('?')[1]);
        const txnRef = urlParams.get('vnp_TxnRef');

        var expiredDate = new Date(Date.now() + 15 * 60 * 1000);
        var paymentExpiredAt = expiredDate.toISOString().slice(0, 19).replace('T', ' ');
        
        db.query(
          'UPDATE orders SET vnpay_txn_ref = ?, payment_expired_at = ? WHERE id = ?',
          [txnRef, paymentExpiredAt, order.id],
          function (errUpdate) {
            if (errUpdate) console.error('❌ Lỗi cập nhật vnpay_txn_ref khi repay:', errUpdate.message);
            
            scheduleVnpayAutoCancel(order.id, 15 * 60 * 1000);
            
            res.json({
              status: 'success',
              payUrl: paymentUrl
            });
          }
        );
      } catch (err) {
        console.error('❌ [VNPay Repay] Lỗi gọi API:', err.message);
        res.status(500).json({
          status: 'error',
          message: 'Không thể kết nối đến VNPay: ' + err.message
        });
      }
    }
  );
});

// ─── Helper nội bộ: đánh dấu voucher đã dùng ─────────────────────────────────
function markVouchersUsed(orderId, userId, voucherIds) {
  if (!voucherIds || voucherIds.length === 0 || !userId) return;
  voucherIds.forEach(function (vid) {
    db.query(
      'UPDATE user_vouchers SET is_used = 1, used_at = NOW(), order_id = ? WHERE user_id = ? AND voucher_id = ? AND is_used = 0',
      [orderId, userId, vid]
    );
    db.query('UPDATE vouchers SET used_count = used_count + 1 WHERE id = ?', [vid]);
  });
}

module.exports = router;
