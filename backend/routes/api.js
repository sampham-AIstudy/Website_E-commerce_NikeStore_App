var express = require('express');
var router = express.Router();
var mysql = require('mysql2');
var multer = require('multer');
var path = require('path');
var fs = require('fs');
var https = require('https');
var http = require('http');
var url = require('url');

// Ensure the root public/assets folder exists
var uploadDir = path.join(__dirname, '../../public/assets');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ─── Subfolder helper ────────────────────────────────────────────────────────
function getUploadSubfolder(category, item_type) {
  const cat  = (category  || 'misc').toLowerCase().trim();
  const type = (item_type || '').toLowerCase().trim();

  // category folder: men / women / kids / misc
  const catDir = ['men','women','kids'].includes(cat) ? cat : 'misc';

  // item_type → subfolder (hỗ trợ cả tiếng Anh và legacy Vietnamese dùng substring)
  let typeDir;
  if (['shoes','sneakers','giày','chạy bộ','running'].some(w => type.includes(w)))
    typeDir = 'shoes';
  else if (['hoodie','jacket','shirt','apparel','áo','tops','pants','shorts','quần','leggings','tights','clothing','quần áo','thời trang'].some(w => type.includes(w)))
    typeDir = 'apparel';
  else if (['cap','bags','backpack','accessories','phụ kiện','socks','tất','nón','mũ','balo','túi'].some(w => type.includes(w)))
    typeDir = 'accessories';
  else if (['equipment','dụng cụ','training','gym','thảm'].some(w => type.includes(w)))
    typeDir = 'equipment';
  else
    typeDir = 'misc';

  // e.g.  products/men/shoes
  return path.join('assets', 'products', catDir, typeDir);
}

function getUploadDir(category, item_type) {
  const sub = getUploadSubfolder(category, item_type);
  const dir = path.join(__dirname, '../../public', sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return { dir, sub };
}

// Multer Storage — dynamic destination based on category & item_type
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    var cat  = req.body.category  || 'misc';
    var type = req.body.item_type || '';
    var { dir } = getUploadDir(cat, type);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    var uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'upload_' + uniqueSuffix + path.extname(file.originalname));
  }
});

var upload = multer({ storage: storage });

// =============================================
// KẾT NỐI MySQL (XAMPP mặc định)
// =============================================
var db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nike_store'
});

db.connect(function (err) {
  if (err) {
    console.error('❌ Lỗi kết nối MySQL:', err.stack);
    return;
  }
  console.log('✅ Đã kết nối thành công đến MySQL: nike_store');
});

// =============================================
// Kiểm tra các cột DB đang có (tự thích ứng)
// =============================================
var dbColumns = ['id', 'title', 'price', 'image', 'category']; // cột cơ bản luôn có
db.query("SHOW COLUMNS FROM products", function (err, cols) {
  if (!err && cols) {
    dbColumns = cols.map(function (c) { return c.Field; });
    console.log('📋 Cột trong DB:', dbColumns.join(', '));
  }
});

function hasCol(col) { return dbColumns.includes(col); }

// Helper function to download an image from a URL and save it into the correct subfolder
function downloadImage(imageUrl, category, item_type, cb) {
  try {
    var { dir: destDir, sub } = getUploadDir(category, item_type);
    var parsedUrl = url.parse(imageUrl);
    var protocol  = parsedUrl.protocol === 'https:' ? https : http;

    var ext = path.extname(parsedUrl.pathname) || '.png';
    if (ext.indexOf('?') !== -1) ext = ext.substring(0, ext.indexOf('?'));
    if (!ext || ext.length > 5 || ext.indexOf('/') !== -1) ext = '.png';

    var filename = 'dl_' + Date.now() + ext;
    var destPath = path.join(destDir, filename);
    // URL path relative to /public   e.g.  /assets/products/men/shoes/dl_xxx.png
    var publicUrl = '/' + sub.replace(/\\/g, '/') + '/' + filename;

    var options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
      }
    };

    protocol.get(imageUrl, options, function (response) {
      if (response.statusCode === 301 || response.statusCode === 302) {
        var loc = response.headers.location;
        if (loc && !loc.startsWith('http://') && !loc.startsWith('https://'))
          loc = url.resolve(imageUrl, loc);
        return downloadImage(loc, category, item_type, cb);
      }
      if (response.statusCode !== 200)
        return cb(new Error('Server returned status ' + response.statusCode));

      var fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);
      fileStream.on('finish', function () { fileStream.close(); cb(null, publicUrl); });
      fileStream.on('error',  function (err) { fs.unlink(destPath, function(){}); cb(err); });
    }).on('error', function (err) { cb(err); });
  } catch (err) { cb(err); }
}

// =============================================
// GET /api/products  →  Lấy toàn bộ sản phẩm
// =============================================
router.get('/products', function (req, res, next) {
  var orderBy = hasCol('created_at') ? 'ORDER BY created_at DESC' : 'ORDER BY id DESC';
  var sql = 'SELECT * FROM products ' + orderBy;
  db.query(sql, function (error, results) {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    res.json({ status: 'success', count: results.length, data: results });
  });
});

// =============================================
// GET /api/products/:id  →  Lấy 1 sản phẩm
// =============================================
router.get('/products/:id', function (req, res, next) {
  db.query('SELECT * FROM products WHERE id = ?', [req.params.id], function (error, results) {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    if (results.length === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });
    res.json({ status: 'success', data: results[0] });
  });
});

// =============================================
// POST /api/products  →  Thêm sản phẩm mới (Có hỗ trợ Upload ảnh & Tự động tải từ URL)
// =============================================
router.post('/products', upload.single('imageFile'), function (req, res, next) {
  var body = req.body;
  var destDir = path.join(__dirname, '../../public/assets');

  function saveProduct(finalImagePath) {
    // Luôn có: title, price, image, category
    var cols = ['title', 'price', 'image', 'category'];
    var vals = [
      body.title,
      body.price,
      finalImagePath,
      body.category || 'men'
    ];

    // Thêm cột mở rộng nếu DB đã có
    if (hasCol('rating'))           { cols.push('rating');           vals.push(body.rating || 4.5); }
    if (hasCol('color'))            { cols.push('color');            vals.push(body.color || 'Trắng'); }
    if (hasCol('sizes'))            { cols.push('sizes');            vals.push(body.sizes || '38,39,40,41,42'); }
    if (hasCol('item_type'))        { cols.push('item_type');        vals.push(body.item_type || 'Chạy bộ'); }
    if (hasCol('is_new'))           { cols.push('is_new');           vals.push(body.is_new === '1' || body.is_new === 1 ? 1 : 0); }
    if (hasCol('discount_percent')) { cols.push('discount_percent'); vals.push(body.discount_percent || 0); }
    if (hasCol('description'))      { cols.push('description');      vals.push(body.description || ''); }
    if (hasCol('stock'))            { cols.push('stock');            vals.push(body.stock || 100); }

    var placeholders = cols.map(function () { return '?'; }).join(', ');
    var sql = 'INSERT INTO products (' + cols.join(', ') + ') VALUES (' + placeholders + ')';

    db.query(sql, vals, function (error, results) {
      if (error) return res.status(500).json({ status: 'error', message: error.message });
      res.json({ status: 'success', message: 'Đã thêm sản phẩm thành công', insertId: results.insertId });
    });
  }

  if (req.file) {
    // Multer already saved to correct subdir; build the public URL
    var cat  = body.category  || 'misc';
    var type = body.item_type || '';
    var { sub } = getUploadDir(cat, type);
    saveProduct('/' + sub.replace(/\\/g, '/') + '/' + req.file.filename);
  } else if (body.image && body.image.trim()) {
    var imageUrl = body.image.trim();
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      saveProduct(imageUrl);
    } else {
      downloadImage(imageUrl, body.category, body.item_type, function (err, localPath) {
        if (err) {
          console.error('❌ Lỗi tải ảnh từ URL:', err.message);
          saveProduct(imageUrl);
        } else {
          saveProduct(localPath);
        }
      });
    }
  } else {
    saveProduct('/assets/products/misc/product1.png');
  }
});

// =============================================
// PUT /api/products/:id  →  Cập nhật sản phẩm (Có hỗ trợ Upload ảnh mới & Tải từ URL)
// =============================================
router.put('/products/:id', upload.single('imageFile'), function (req, res, next) {
  var body = req.body;
  var productId = req.params.id;
  var destDir = path.join(__dirname, '../../public/assets');

  function updateProduct(finalImagePath) {
    var setParts = ['title=?', 'price=?', 'image=?', 'category=?'];
    var vals = [body.title, body.price, finalImagePath, body.category];

    if (hasCol('rating'))           { setParts.push('rating=?');           vals.push(body.rating); }
    if (hasCol('color'))            { setParts.push('color=?');            vals.push(body.color); }
    if (hasCol('sizes'))            { setParts.push('sizes=?');            vals.push(body.sizes); }
    if (hasCol('item_type'))        { setParts.push('item_type=?');        vals.push(body.item_type); }
    if (hasCol('is_new'))           { setParts.push('is_new=?');           vals.push(body.is_new === '1' || body.is_new === 1 ? 1 : 0); }
    if (hasCol('discount_percent')) { setParts.push('discount_percent=?'); vals.push(body.discount_percent); }
    if (hasCol('description'))      { setParts.push('description=?');      vals.push(body.description); }
    if (hasCol('stock'))            { setParts.push('stock=?');            vals.push(body.stock); }

    vals.push(productId);
    var sql = 'UPDATE products SET ' + setParts.join(', ') + ' WHERE id=?';

    db.query(sql, vals, function (error, results) {
      if (error) return res.status(500).json({ status: 'error', message: error.message });
      if (results.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });
      res.json({ status: 'success', message: 'Đã cập nhật sản phẩm thành công' });
    });
  }

  if (req.file) {
    var cat2  = body.category  || 'misc';
    var type2 = body.item_type || '';
    var { sub: sub2 } = getUploadDir(cat2, type2);
    updateProduct('/' + sub2.replace(/\\/g, '/') + '/' + req.file.filename);
  } else if (body.image && body.image.trim()) {
    var imageUrl = body.image.trim();
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      updateProduct(imageUrl);
    } else {
      downloadImage(imageUrl, body.category, body.item_type, function (err, localPath) {
        if (err) {
          console.error('❌ Lỗi tải ảnh từ URL:', err.message);
          updateProduct(imageUrl);
        } else {
          updateProduct(localPath);
        }
      });
    }
  } else {
    updateProduct(body.image || '/assets/products/misc/product1.png');
  }
});

// =============================================
// DELETE /api/products/:id  →  Xóa sản phẩm (Sửa lỗi dư tiền tố /api)
// =============================================
router.delete('/products/:id', function (req, res, next) {
  db.query('DELETE FROM products WHERE id = ?', [req.params.id], function (error, results) {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    if (results.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'Không tìm thấy sản phẩm' });
    res.json({ status: 'success', message: 'Đã xóa sản phẩm thành công' });
  });
});

module.exports = router;
