var express = require('express');
var router = express.Router();
var mysql = require('mysql2');
var { sendOTP } = require('../utils/mailer');
var multer = require('multer');
var path = require('path');
var fs = require('fs');

// ─── Multer config for avatar uploads ──────────────────────────────────────
var avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    var dir = path.join(__dirname, '../public/images/avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    var ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'avatar_' + req.params.id + '_' + Date.now() + ext);
  }
});
var uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: function (req, file, cb) {
    var allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    var ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Chỉ chấp nhận ảnh JPG, PNG, GIF, WEBP!'));
  }
});

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
// POST /api/auth/login
// Body: { username, password }
// =============================================
router.post('/login', function (req, res) {
  var username = req.body.username;
  var password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng nhập username và password' });
  }

  db.query(
    'SELECT id, username, role, email FROM users WHERE (username = ? OR email = ?) AND password = ?',
    [username, username, password],
    function (error, results) {
      if (error) return res.status(500).json({ status: 'error', message: error.message });
      if (results.length === 0) {
        return res.status(401).json({ status: 'error', message: 'Sai tên đăng nhập hoặc mật khẩu' });
      }
      var user = results[0];
      res.json({
        status: 'success',
        message: 'Đăng nhập thành công',
        user: { id: user.id, username: user.username, role: user.role, email: user.email }
      });
    }
  );
});

// =============================================
// GET /api/auth/users  →  Danh sách user (admin only)
// =============================================
router.get('/users', function (req, res) {
  db.query('SELECT id, username, role, created_at FROM users ORDER BY id', function (error, results) {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    res.json({ status: 'success', data: results });
  });
});


// =============================================
// POST /api/auth/register  →  Tạo tài khoản USER
//   (chỉ được tạo role=user, admin do DBA thạo thủ công)
// =============================================
router.post('/register', function (req, res) {
  var { username, email, password, otp } = req.body;
  if (!username || !email || !password || !otp) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng nhập đầy đủ tên đăng nhập, email, mật khẩu và OTP!' });
  }
  if (password.length < 6) {
    return res.status(400).json({ status: 'error', message: 'Mật khẩu phải ít nhất 6 ký tự' });
  }

  // 1. Xác thực OTP
  db.query(
    'SELECT * FROM otps WHERE email = ? AND code = ? AND purpose = \'register\' AND expires_at > NOW()',
    [email, otp],
    function (errOtp, resultsOtp) {
      if (errOtp) return res.status(500).json({ status: 'error', message: 'Lỗi xác thực mã OTP: ' + errOtp.message });
      if (resultsOtp.length === 0) {
        return res.status(400).json({ status: 'error', message: 'Mã OTP không chính xác hoặc đã hết hạn!' });
      }

      // Xóa OTP
      db.query('DELETE FROM otps WHERE email = ?', [email], function () {
        // 2. Thêm người dùng mới
        db.query(
          'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, \'user\')',
          [username, email, password],
          function (error, results) {
            if (error) {
              if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ status: 'error', message: 'Tên đăng nhập hoặc Email đã tồn tại, vui lòng chọn tên khác' });
              }
              return res.status(500).json({ status: 'error', message: error.message });
            }
            res.json({
              status: 'success',
              message: 'Tạo tài khoản thành công! Vui lòng đăng nhập.',
              insertId: results.insertId
            });
          }
        );
      });
    }
  );
});

// =============================================
// POST /api/auth/google  →  Đăng nhập bằng Google
// Body: { credential: "<Google ID token>" }
// =============================================
var https = require('https');

router.post('/google', function (req, res) {
  var credential = req.body.credential;
  if (!credential) {
    return res.status(400).json({ status: 'error', message: 'Thiếu Google credential' });
  }

  // Xác minh ID token qua Google tokeninfo API (không cần thư viện)
  var verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + credential;
  https.get(verifyUrl, function (googleRes) {
    var raw = '';
    googleRes.on('data', function (chunk) { raw += chunk; });
    googleRes.on('end', function () {
      var payload;
      try { payload = JSON.parse(raw); } catch (e) {
        return res.status(400).json({ status: 'error', message: 'Google token không hợp lệ' });
      }
      if (payload.error || !payload.email) {
        return res.status(401).json({ status: 'error', message: 'Không thể xác minh tài khoản Google' });
      }

      var email    = payload.email;
      var name     = payload.name || email.split('@')[0];
      var googleId = payload.sub;

      // Tìm user theo google_id hoặc email
      db.query(
        'SELECT id, username, role, avatar FROM users WHERE username = ? LIMIT 1',
        [email],
        function (err, rows) {
          if (err) return res.status(500).json({ status: 'error', message: err.message });

          if (rows.length > 0) {
            // User đã tồn tại → cập nhật avatar nếu đăng nhập bằng google, sau đó đăng nhập luôn
            var u = rows[0];
            db.query('UPDATE users SET avatar = ? WHERE id = ?', [payload.picture, u.id], function(updateErr) {
              return res.json({
                status: 'success',
                message: 'Đăng nhập Google thành công!',
                user: { id: u.id, username: u.username, role: u.role, displayName: name, avatar: payload.picture }
              });
            });
            return;
          }

          // Tạo user mới từ Google account
          db.query(
            'INSERT INTO users (username, password, role, avatar) VALUES (?, ?, \'user\', ?)',
            [email, 'google_oauth_' + googleId, payload.picture],
            function (insertErr, insertResult) {
              if (insertErr) {
                // Nếu trùng email thì thử lấy lại
                if (insertErr.code === 'ER_DUP_ENTRY') {
                  return res.status(409).json({ status: 'error', message: 'Email đã được dùng bởi tài khoản khác' });
                }
                return res.status(500).json({ status: 'error', message: insertErr.message });
              }
              res.json({
                status: 'success',
                message: 'Tạo tài khoản Google thành công!',
                user: { id: insertResult.insertId, username: email, role: 'user', displayName: name, avatar: payload.picture }
              });
            }
          );
        }
      );
    });
  }).on('error', function (e) {
    res.status(500).json({ status: 'error', message: 'Không thể kết nối Google: ' + e.message });
  });
});

// =============================================
// DELETE /api/auth/users/:id  →  Xóa user
// =============================================
router.delete('/users/:id', function (req, res) {
  db.query('DELETE FROM users WHERE id = ?', [req.params.id], function (error, results) {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    res.json({ status: 'success', message: 'Đã xóa user' });
  });
});

// =============================================
// POST /api/auth/send-otp
// Body: { email, purpose } ('register' or 'forgot')
// =============================================
router.post('/send-otp', function (req, res) {
  var email = req.body.email;
  var purpose = req.body.purpose;

  if (!email || !purpose) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ email và mục đích xác thực!' });
  }

  // 1. Kiểm tra nghiệp vụ
  if (purpose === 'register') {
    db.query('SELECT id FROM users WHERE email = ? OR username = ?', [email, email], function (err, results) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      if (results.length > 0) {
        return res.status(409).json({ status: 'error', message: 'Email hoặc tên đăng nhập này đã được sử dụng!' });
      }
      generateAndSendOTP(email, purpose, res);
    });
  } else if (purpose === 'forgot') {
    db.query('SELECT id FROM users WHERE email = ?', [email], function (err, results) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      if (results.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy tài khoản nào được đăng ký bằng email này!' });
      }
      generateAndSendOTP(email, purpose, res);
    });
  } else {
    return res.status(400).json({ status: 'error', message: 'Mục đích xác thực OTP không hợp lệ!' });
  }
});

function generateAndSendOTP(email, purpose, res) {
  var code = Math.floor(100000 + Math.random() * 900000).toString();
  var expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  db.query('DELETE FROM otps WHERE email = ?', [email], function (errDel) {
    if (errDel) return res.status(500).json({ status: 'error', message: 'Lỗi chuẩn bị mã OTP: ' + errDel.message });

    db.query(
      'INSERT INTO otps (email, code, purpose, expires_at) VALUES (?, ?, ?, ?)',
      [email, code, purpose, expiresAt],
      async function (errIns) {
        if (errIns) return res.status(500).json({ status: 'error', message: 'Lỗi lưu mã OTP: ' + errIns.message });

        try {
          await sendOTP(email, code, purpose);
          res.json({ status: 'success', message: 'Mã xác thực OTP đã được gửi về email của bạn (Hiệu lực 5 phút)!' });
        } catch (errMail) {
          res.status(500).json({ status: 'error', message: 'Gửi mail thất bại: ' + errMail.message });
        }
      }
    );
  });
}

// =============================================
// POST /api/auth/verify-otp
// Body: { email, otp, purpose }
// =============================================
router.post('/verify-otp', function (req, res) {
  var { email, otp, purpose } = req.body;

  if (!email || !otp || !purpose) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ Email, mã OTP và mục đích xác thực!' });
  }

  db.query(
    'SELECT * FROM otps WHERE email = ? AND code = ? AND purpose = ? AND expires_at > NOW()',
    [email, otp, purpose],
    function (errOtp, resultsOtp) {
      if (errOtp) return res.status(500).json({ status: 'error', message: 'Lỗi xác thực mã OTP: ' + errOtp.message });
      if (resultsOtp.length === 0) {
        return res.status(400).json({ status: 'error', message: 'Mã OTP không chính xác hoặc đã hết hạn!' });
      }
      res.json({ status: 'success', message: 'Xác thực OTP thành công!' });
    }
  );
});

// =============================================
// POST /api/auth/reset-password
// Body: { email, password, otp }
// =============================================
router.post('/reset-password', function (req, res) {
  var { email, password, otp } = req.body;

  if (!email || !password || !otp) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng điền đầy đủ Email, Mật khẩu mới và OTP!' });
  }
  if (password.length < 6) {
    return res.status(400).json({ status: 'error', message: 'Mật khẩu phải ít nhất 6 ký tự!' });
  }

  db.query(
    'SELECT * FROM otps WHERE email = ? AND code = ? AND purpose = \'forgot\' AND expires_at > NOW()',
    [email, otp],
    function (errOtp, resultsOtp) {
      if (errOtp) return res.status(500).json({ status: 'error', message: 'Lỗi xác thực mã OTP: ' + errOtp.message });
      if (resultsOtp.length === 0) {
        return res.status(400).json({ status: 'error', message: 'Mã OTP không chính xác hoặc đã hết hạn!' });
      }

      db.query('DELETE FROM otps WHERE email = ?', [email], function () {
        db.query(
          'UPDATE users SET password = ? WHERE email = ?',
          [password, email],
          function (error, results) {
            if (error) return res.status(500).json({ status: 'error', message: error.message });
            if (results.affectedRows === 0) {
              return res.status(404).json({ status: 'error', message: 'Không tìm thấy tài khoản để đặt lại mật khẩu!' });
            }
            res.json({
              status: 'success',
              message: 'Đặt lại mật khẩu thành công! Hãy dùng mật khẩu mới này để đăng nhập.'
            });
          }
        );
      });
    }
  );
});

// =============================================
// GET /api/auth/profile/:id  →  Lấy thông tin cá nhân
// =============================================
router.get('/profile/:id', function (req, res) {
  var id = req.params.id;
  db.query(
    'SELECT id, username, email, fullname, phone, avatar, role, gender, dob, n_coin, created_at FROM users WHERE id = ?',
    [id],
    function (error, results) {
      if (error) return res.status(500).json({ status: 'error', message: error.message });
      if (results.length === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
      res.json({ status: 'success', data: results[0] });
    }
  );
});

// =============================================
// PUT /api/auth/profile/:id  →  Cập nhật thông tin cá nhân
// Body: { fullname, phone, gender, dob }
// =============================================
router.put('/profile/:id', function (req, res) {
  var id = req.params.id;
  var { fullname, phone, gender, dob } = req.body;

  if (!fullname || !phone) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng nhập đầy đủ họ tên và số điện thoại!' });
  }

  // Handle empty string for dob as NULL
  var dobValue = dob && dob.trim() !== '' ? dob : null;

  db.query(
    'UPDATE users SET fullname = ?, phone = ?, gender = ?, dob = ? WHERE id = ?',
    [fullname, phone, gender || null, dobValue, id],
    function (error, results) {
      if (error) return res.status(500).json({ status: 'error', message: error.message });
      if (results.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
      res.json({ status: 'success', message: 'Cập nhật thông tin thành công!' });
    }
  );
});

// =============================================
// PUT /api/auth/change-email/:id  →  Đổi Email
// Body: { oldPassword, newEmail }
// =============================================
router.put('/change-email/:id', function (req, res) {
  var id = req.params.id;
  var { oldPassword, newEmail } = req.body;

  if (!oldPassword || !newEmail) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng nhập mật khẩu xác thực và email mới!' });
  }

  // Verify old password first
  db.query('SELECT id FROM users WHERE id = ? AND password = ?', [id, oldPassword], function (error, results) {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    if (results.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Mật khẩu xác nhận không đúng!' });
    }

    db.query('UPDATE users SET email = ? WHERE id = ?', [newEmail, id], function (err2) {
      if (err2) {
        if (err2.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ status: 'error', message: 'Email này đã được tài khoản khác sử dụng!' });
        }
        return res.status(500).json({ status: 'error', message: err2.message });
      }
      res.json({ status: 'success', message: 'Đổi email thành công! Vui lòng dùng email mới ở lần đăng nhập tới.' });
    });
  });
});

// =============================================
// PUT /api/auth/change-password/:id  →  Đổi mật khẩu
// Body: { oldPassword, newPassword }
// =============================================
router.put('/change-password/:id', function (req, res) {
  var id = req.params.id;
  var { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng nhập đầy đủ mật khẩu cũ và mới!' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ status: 'error', message: 'Mật khẩu mới phải ít nhất 6 ký tự!' });
  }

  // Verify old password first
  db.query('SELECT id FROM users WHERE id = ? AND password = ?', [id, oldPassword], function (error, results) {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    if (results.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Mật khẩu hiện tại không đúng!' });
    }

    db.query('UPDATE users SET password = ? WHERE id = ?', [newPassword, id], function (err2) {
      if (err2) return res.status(500).json({ status: 'error', message: err2.message });
      res.json({ status: 'success', message: 'Đổi mật khẩu thành công! Vui lòng đăng nhập lại.' });
    });
  });
});

// =============================================
// POST /api/auth/upload-avatar/:id  →  Upload ảnh đại diện
// Form: multipart/form-data, field name: "avatar"
// =============================================
router.post('/upload-avatar/:id', uploadAvatar.single('avatar'), function (req, res) {
  var id = req.params.id;
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng chọn file ảnh!' });
  }

  var avatarUrl = '/images/avatars/' + req.file.filename;

  // Delete old avatar file if exists
  db.query('SELECT avatar FROM users WHERE id = ?', [id], function (err, rows) {
    if (!err && rows.length > 0 && rows[0].avatar) {
      var oldPath = path.join(__dirname, '../public', rows[0].avatar);
      if (fs.existsSync(oldPath)) {
        fs.unlink(oldPath, function () {});
      }
    }

    // Save new avatar path to DB
    db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, id], function (error) {
      if (error) return res.status(500).json({ status: 'error', message: error.message });
      res.json({ status: 'success', message: 'Cập nhật ảnh đại diện thành công!', avatarUrl: avatarUrl });
    });
  });
});

// =============================================
// SỔ ĐỊA CHỈ (ADDRESS BOOK) API
// =============================================

// GET /api/auth/users/:id/addresses
router.get('/users/:id/addresses', function(req, res) {
  var userId = req.params.id;
  db.query('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [userId], function(err, results) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: results });
  });
});

// POST /api/auth/users/:id/addresses
router.post('/users/:id/addresses', function(req, res) {
  var userId = req.params.id;
  var { fullname, phone, province, ward, address, full_address, type, is_default } = req.body;

  if (!fullname || !phone || !full_address) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng điền đủ thông tin bắt buộc' });
  }

  // Check if user has any addresses to force default on the first one
  db.query('SELECT COUNT(*) as cnt FROM user_addresses WHERE user_id = ?', [userId], function(err, rows) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    
    var isDefault = (rows[0].cnt === 0 || is_default) ? 1 : 0;

    var insertAddress = function() {
      db.query(
        'INSERT INTO user_addresses (user_id, fullname, phone, province, ward, address, full_address, type, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, fullname, phone, province || null, ward || null, address, full_address, type || 'home', isDefault],
        function(errIns, results) {
          if (errIns) return res.status(500).json({ status: 'error', message: errIns.message });
          res.json({ status: 'success', message: 'Thêm địa chỉ thành công', insertId: results.insertId });
        }
      );
    };

    if (isDefault) {
      // If setting as default, clear others first
      db.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId], function(errUpd) {
        if (errUpd) return res.status(500).json({ status: 'error', message: errUpd.message });
        insertAddress();
      });
    } else {
      insertAddress();
    }
  });
});

// PUT /api/auth/addresses/:id
router.put('/addresses/:id', function(req, res) {
  var id = req.params.id;
  var { fullname, phone, province, ward, address, full_address, type, is_default, user_id } = req.body;

  if (!fullname || !phone || !full_address) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng điền đủ thông tin bắt buộc' });
  }

  var updateAddress = function() {
    db.query(
      'UPDATE user_addresses SET fullname = ?, phone = ?, province = ?, ward = ?, address = ?, full_address = ?, type = ?, is_default = ? WHERE id = ?',
      [fullname, phone, province || null, ward || null, address, full_address, type || 'home', is_default ? 1 : 0, id],
      function(errUpd, results) {
        if (errUpd) return res.status(500).json({ status: 'error', message: errUpd.message });
        res.json({ status: 'success', message: 'Cập nhật địa chỉ thành công' });
      }
    );
  };

  if (is_default && user_id) {
    db.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND id != ?', [user_id, id], function(errClear) {
      if (errClear) return res.status(500).json({ status: 'error', message: errClear.message });
      updateAddress();
    });
  } else {
    updateAddress();
  }
});

// DELETE /api/auth/addresses/:id
router.delete('/addresses/:id', function(req, res) {
  var id = req.params.id;
  db.query('DELETE FROM user_addresses WHERE id = ?', [id], function(err, results) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', message: 'Xóa địa chỉ thành công' });
  });
});

// PUT /api/auth/addresses/:id/default
router.put('/addresses/:id/default', function(req, res) {
  var id = req.params.id;
  var userId = req.body.user_id;

  if (!userId) return res.status(400).json({ status: 'error', message: 'Thiếu user_id' });

  db.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId], function(err1) {
    if (err1) return res.status(500).json({ status: 'error', message: err1.message });
    db.query('UPDATE user_addresses SET is_default = 1 WHERE id = ?', [id], function(err2) {
      if (err2) return res.status(500).json({ status: 'error', message: err2.message });
      res.json({ status: 'success', message: 'Thiết lập địa chỉ mặc định thành công' });
    });
  });
});

// Handle multer errors (file type, size)
router.use(function (err, req, res, next) {
  if (err instanceof multer.MulterError || err.message) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
  next(err);
});

module.exports = router;
