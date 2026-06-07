var express = require('express');
var router = express.Router();
var mysql = require('mysql2');

// Kết nối MySQL (giống api.js)
var db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nike_store'
});

db.connect(function (err) {
  if (err) {
    console.error('❌ Lỗi kết nối MySQL (orders):', err.stack);
    return;
  }
});

// =============================================
// POST /api/orders/checkout  →  Xử lý Thanh Toán
// =============================================
router.post('/checkout', function (req, res) {
  var { user_id, fullname, phone, address, total_amount, cartItems, voucher_ids } = req.body;

  if (!fullname || !phone || !address || !cartItems || cartItems.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đủ thông tin và sản phẩm' });
  }

  // 1. Tạo đơn hàng trong bảng `orders`
  var paymentMethod = req.body.payment_method || 'cod';
  var sqlOrder = 'INSERT INTO orders (user_id, fullname, phone, address, total_amount, payment_method, status) VALUES (?, ?, ?, ?, ?, ?, "pending")';
  var valuesOrder = [user_id || null, fullname, phone, address, total_amount, paymentMethod];

  db.query(sqlOrder, valuesOrder, function (err, result) {
    if (err) return res.status(500).json({ status: 'error', message: 'Lỗi tạo đơn hàng: ' + err.message });

    var orderId = result.insertId;

    // 2. Thêm các sản phẩm vào bảng `order_items`
    var sqlItems = 'INSERT INTO order_items (order_id, product_id, quantity, price, size, color) VALUES ?';
    
    // Tạo mảng dữ liệu cho nhiều row [ [order_id, product_id, quantity, price, size, color], [...] ]
    var valuesItems = cartItems.map(item => [
      orderId,
      item.id,
      item.cartQuantity || 1,
      item.price,
      item.size || 'N/A',
      item.color || 'N/A'
    ]);

    db.query(sqlItems, [valuesItems], function (err2, result2) {
      if (err2) return res.status(500).json({ status: 'error', message: 'Lỗi lưu chi tiết đơn hàng: ' + err2.message });

      // Cập nhật số lượng tồn kho (stock)
      var updatePromises = cartItems.map(item => {
        return new Promise((resolve) => {
          var qty = item.cartQuantity || 1;
          db.query('UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?', [qty, item.id], resolve);
        });
      });

      Promise.all(updatePromises).then(() => {
        // Cập nhật trạng thái các voucher đã dùng
        if (voucher_ids && voucher_ids.length > 0 && user_id) {
          voucher_ids.forEach(vid => {
            // Cập nhật user_vouchers thành đã sử dụng
            db.query('UPDATE user_vouchers SET is_used = 1, used_at = NOW(), order_id = ? WHERE user_id = ? AND voucher_id = ? AND is_used = 0', [orderId, user_id, vid]);
            // Tăng số lượt đã dùng của voucher
            db.query('UPDATE vouchers SET used_count = used_count + 1 WHERE id = ?', [vid]);
          });
        }
        res.json({ status: 'success', message: 'Đặt hàng thành công!', order_id: orderId });
      });
    });
  });
});

// =============================================
// GET /api/orders  →  Lấy danh sách đơn hàng (Cho Admin)
// =============================================
router.get('/', function(req, res) {
  db.query('SELECT * FROM orders ORDER BY created_at DESC', function(err, results) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: results });
  });
});

// =============================================
// GET /api/orders/:id  →  Lấy chi tiết đơn hàng & sản phẩm (Cho Admin)
// =============================================
router.get('/:id', function(req, res) {
  var orderId = req.params.id;
  
  // 1. Lấy thông tin đơn hàng
  db.query('SELECT * FROM orders WHERE id = ?', [orderId], function(err, ordersResult) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    if (ordersResult.length === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    
    // 2. Lấy danh sách item + title + image
    var sqlItems = `
      SELECT oi.*, p.title, p.image 
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `;
    db.query(sqlItems, [orderId], function(err2, itemsResult) {
      if (err2) return res.status(500).json({ status: 'error', message: err2.message });
      
      res.json({
        status: 'success',
        order: ordersResult[0],
        items: itemsResult
      });
    });
  });
});

// =============================================
// PUT /api/orders/:id/status  →  Cập nhật trạng thái đơn hàng (Cho Admin)
// =============================================
router.put('/:id/status', function(req, res) {
  var orderId = req.params.id;
  var status = req.body.status;

  if (!status) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp trạng thái mới' });
  }

  // 1. Lấy trạng thái cũ của đơn hàng
  db.query('SELECT status FROM orders WHERE id = ?', [orderId], function(err1, result1) {
    if (err1) return res.status(500).json({ status: 'error', message: err1.message });
    if (result1.length === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    
    var oldStatus = result1[0].status;

    // 2. Cập nhật trạng thái mới
    db.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId], function(err, result) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      
      // 3. Xử lý tồn kho (stock) dựa trên sự thay đổi trạng thái
      if (status === 'cancelled' && oldStatus !== 'cancelled') {
        // Hủy đơn -> Trả lại kho
        db.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId], function(err3, items) {
          if (!err3 && items) {
            items.forEach(item => {
              db.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
            });
          }
        });
      } else if (oldStatus === 'cancelled' && status !== 'cancelled') {
        // Khôi phục đơn -> Trừ lại kho
        db.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId], function(err3, items) {
          if (!err3 && items) {
            items.forEach(item => {
              db.query('UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?', [item.quantity, item.product_id]);
            });
          }
        });
      }
      
      res.json({ status: 'success', message: 'Đã cập nhật trạng thái đơn hàng thành công' });
    });
  });
});

// =============================================
// PUT /api/orders/:id/payment-status  →  Xác nhận thanh toán VPBank (Cho Admin)
// =============================================
router.put('/:id/payment-status', function(req, res) {
  var orderId = req.params.id;
  var payment_status = req.body.payment_status;

  var allowed = ['pending', 'paid', 'failed'];
  if (!payment_status || !allowed.includes(payment_status)) {
    return res.status(400).json({ status: 'error', message: 'Trạng thái thanh toán không hợp lệ (pending/paid/failed)' });
  }

  db.query('UPDATE orders SET payment_status = ? WHERE id = ?', [payment_status, orderId], function(err, result) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });

    res.json({ status: 'success', message: 'Đã cập nhật trạng thái thanh toán thành công' });
  });
});

module.exports = router;
