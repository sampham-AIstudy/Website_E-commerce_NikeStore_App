var express = require('express');
var router = express.Router();
var mysql = require('mysql2');
var { sendOTP } = require('../utils/mailer');

var db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nike_store'
});

db.connect(function (err) {
  if (err) { console.error('❌ Auth DB lỗi:', err.stack); return; }
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
        'SELECT id, username, role FROM users WHERE username = ? LIMIT 1',
        [email],
        function (err, rows) {
          if (err) return res.status(500).json({ status: 'error', message: err.message });

          if (rows.length > 0) {
            // User đã tồn tại → đăng nhập luôn
            var u = rows[0];
            return res.json({
              status: 'success',
              message: 'Đăng nhập Google thành công!',
              user: { id: u.id, username: u.username, role: u.role, displayName: name, avatar: payload.picture }
            });
          }

          // Tạo user mới từ Google account
          db.query(
            'INSERT INTO users (username, password, role) VALUES (?, ?, \'user\')',
            [email, 'google_oauth_' + googleId],
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

module.exports = router;
