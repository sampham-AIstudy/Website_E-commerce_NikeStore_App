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
  var { user_id, fullname, phone, address, total_amount, cartItems } = req.body;

  if (!fullname || !phone || !address || !cartItems || cartItems.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đủ thông tin và sản phẩm' });
  }

  // 1. Tạo đơn hàng trong bảng `orders`
  var sqlOrder = 'INSERT INTO orders (user_id, fullname, phone, address, total_amount, status) VALUES (?, ?, ?, ?, ?, "pending")';
  var valuesOrder = [user_id || null, fullname, phone, address, total_amount];

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

      res.json({ status: 'success', message: 'Đặt hàng thành công!', order_id: orderId });
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

  db.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId], function(err, result) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng để cập nhật' });
    
    res.json({ status: 'success', message: 'Đã cập nhật trạng thái đơn hàng thành công' });
  });
});

module.exports = router;
