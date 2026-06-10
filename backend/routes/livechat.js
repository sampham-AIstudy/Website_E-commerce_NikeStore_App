var express = require('express');
var router = express.Router();
var mysql = require('mysql2');
var multer = require('multer');
var path = require('path');
var fs = require('fs');

// Cấu hình Multer để upload ảnh
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    var uploadDir = path.join(__dirname, '../public/uploads/chat');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    var uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

var upload = multer({ 
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // Giới hạn 25MB
  fileFilter: function (req, file, cb) {
    var ext = path.extname(file.originalname).toLowerCase();
    var allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif'];
    if (!allowed.includes(ext)) {
      return cb(new Error('Chỉ cho phép tải lên hình ảnh!'));
    }
    cb(null, true);
  }
});

// =============================================
// KẾT NỐI MySQL
// =============================================
var db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nike_store',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// =============================================
// GET /api/livechat/sessions  →  Lấy danh sách phiên chat
// =============================================
router.get('/sessions', function(req, res) {
  var sql = `
    SELECT 
      session_id,
      MAX(user_id) as user_id,
      MAX(username) as username,
      COUNT(*) as message_count,
      SUM(CASE WHEN is_read = 0 AND sender = 'customer' THEN 1 ELSE 0 END) as unread_count,
      MAX(created_at) as last_message_at,
      (SELECT message FROM chat_messages cm2 WHERE cm2.session_id = cm.session_id ORDER BY cm2.created_at DESC LIMIT 1) as last_message
    FROM chat_messages cm
    GROUP BY session_id
    ORDER BY last_message_at DESC
  `;
  db.query(sql, function(err, results) {
    if (err) {
      console.error('LiveChat sessions error:', err);
      return res.status(500).json({ status: 'error', message: err.message });
    }
    res.json({ status: 'success', data: results });
  });
});

// =============================================
// GET /api/livechat/messages/:sessionId  →  Lấy lịch sử tin nhắn
// =============================================
router.get('/messages/:sessionId', function(req, res) {
  var sessionId = req.params.sessionId;
  db.query(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId],
    function(err, results) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      
      // Đánh dấu đã đọc tất cả tin từ customer
      db.query(
        'UPDATE chat_messages SET is_read = 1 WHERE session_id = ? AND sender = ?',
        [sessionId, 'customer'],
        function() {} // fire and forget
      );
      
      res.json({ status: 'success', data: results });
    }
  );
});

// =============================================
// POST /api/livechat/upload  →  Upload ảnh
// =============================================
router.post('/upload', upload.single('image'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Không có file nào được tải lên.' });
  }
  var imageUrl = '/uploads/chat/' + req.file.filename;
  res.json({ status: 'success', url: imageUrl });
});

// =============================================
// POST /api/livechat/send  →  Admin gửi tin nhắn (REST fallback)
// =============================================
router.post('/send', function(req, res) {
  var sessionId = req.body.session_id;
  var message   = req.body.message;
  var sender    = req.body.sender || 'admin';
  var userId    = req.body.user_id || null;
  var username  = req.body.username || 'Admin';
  var type      = req.body.type || 'text';

  if (!sessionId || !message) {
    return res.status(400).json({ status: 'error', message: 'Thiếu session_id hoặc message' });
  }

  db.query(
    'INSERT INTO chat_messages (session_id, user_id, username, sender, message, type) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, userId, username, sender, message, type],
    function(err, result) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      res.json({ status: 'success', id: result.insertId });
    }
  );
});

// =============================================
// GET /api/livechat/unread-count  →  Tổng tin chưa đọc (cho admin badge)
// =============================================
router.get('/unread-count', function(req, res) {
  db.query(
    'SELECT COUNT(*) as count FROM chat_messages WHERE is_read = 0 AND sender = "customer"',
    function(err, results) {
      if (err) return res.status(500).json({ count: 0 });
      res.json({ count: results[0] ? results[0].count : 0 });
    }
  );
});

module.exports = router;
