var express = require('express');
var router = express.Router();
var mysql = require('mysql2');

// =============================================
// KẾT NỐI MySQL
// =============================================
var db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nike_store'
});

db.connect(function(err) {
  if (err) {
    console.error('❌ Lỗi kết nối MySQL (index route):', err.stack);
    return;
  }
  console.log('✅ Index router đã kết nối MySQL');
});

// ─── Pagination helper ─────────────────────────────────────────────────────────
var PAGE_SIZE = 12;
function paginate(req, allResults) {
  var page       = Math.max(1, parseInt(req.query.page) || 1);
  var totalItems = allResults.length;
  var totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  page           = Math.min(page, totalPages);
  var start      = (page - 1) * PAGE_SIZE;
  return {
    items:      allResults.slice(start, start + PAGE_SIZE),
    page:       page,
    totalPages: totalPages,
    totalItems: totalItems
  };
}

// =============================================
// GET /  →  Trang Chủ
// =============================================
router.get('/', function(req, res, next) {
  db.query('SELECT * FROM products ORDER BY id DESC', function(error, results) {
    if (error) return res.render('error', { message: 'Lỗi tải cơ sở dữ liệu sản phẩm', error: error });
    var p = paginate(req, results);
    res.render('index', { products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems });
  });
});

// =============================================
// GET /men  →  Giày Nam
// =============================================
router.get('/men', function(req, res) {
  db.query('SELECT * FROM products WHERE category = "men" ORDER BY id DESC', function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Thời Trang Nam', categorySlug: 'men', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems });
  });
});

// =============================================
// GET /women  →  Giày Nữ
// =============================================
router.get('/women', function(req, res) {
  db.query('SELECT * FROM products WHERE category = "women" ORDER BY id DESC', function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Thời Trang Nữ', categorySlug: 'women', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems });
  });
});

// =============================================
// GET /kids  →  Giày Trẻ Em
// =============================================
router.get('/kids', function(req, res) {
  db.query('SELECT * FROM products WHERE category = "kids" ORDER BY id DESC', function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Thời Trang Trẻ Em', categorySlug: 'kids', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems });
  });
});

// =============================================
// GET /new  →  Sản Phẩm Mới
// =============================================
router.get('/new', function(req, res) {
  db.query('SELECT * FROM products WHERE is_new = 1 ORDER BY id DESC', function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Sản Phẩm Mới Nhất', categorySlug: 'new', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems });
  });
});

// =============================================
// GET /sale  →  Khuyến Mãi
// =============================================
router.get('/sale', function(req, res) {
  db.query('SELECT * FROM products WHERE discount_percent > 0 ORDER BY id DESC', function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Giảm Giá Cực Sốc', categorySlug: 'sale', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems });
  });
});

// =============================================
// GET /products/:id  →  Trang Chi Tiết Sản Phẩm & Gợi Ý Tương Tự & Đánh Giá
// =============================================
router.get('/products/:id', function(req, res) {
  var id = req.params.id;
  
  // 1. Lấy thông tin sản phẩm chính
  db.query('SELECT * FROM products WHERE id = ?', [id], function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    if (results.length === 0) return res.status(404).render('error', { message: 'Không tìm thấy sản phẩm này', error: { status: 404 } });
    
    var product = results[0];

    // 2. Lấy 4 sản phẩm tương tự cùng category
    db.query('SELECT * FROM products WHERE category = ? AND id != ? LIMIT 4', [product.category, product.id], function(err2, relResults) {
      var related = err2 ? [] : relResults;
      
      // 3. Lấy tất cả đánh giá của sản phẩm này từ bảng reviews mới tạo
      db.query('SELECT * FROM reviews WHERE product_id = ? ORDER BY id DESC', [product.id], function(err3, reviewsResults) {
        var reviews = err3 ? [] : reviewsResults;
        
        res.render('product', { 
          product: product, 
          relatedProducts: related,
          reviews: reviews
        });
      });
    });
  });
});

// =============================================
// POST /api/products/:id/reviews  →  Thêm đánh giá mới vào CSDL
// =============================================
router.post('/api/products/:id/reviews', function(req, res) {
  var productId = req.params.id;
  var userId = req.body.user_id || null;
  var username = req.body.username || 'Khách ẩn danh';
  var rating = parseInt(req.body.rating) || 5;
  var comment = req.body.comment || '';

  if (!comment) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng điền nội dung nhận xét' });
  }

  var sql = 'INSERT INTO reviews (product_id, user_id, username, rating, comment) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [productId, userId, username, rating, comment], function(err, result) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    
    res.json({ 
      status: 'success', 
      message: 'Gửi đánh giá thành công',
      review: {
        id: result.insertId,
        product_id: productId,
        user_id: userId,
        username: username,
        rating: rating,
        comment: comment,
        created_at: new Date()
      }
    });
  });
});

// =============================================
// GET /my-orders  →  Trang Đơn Hàng Của Tôi
// =============================================
router.get('/my-orders', function(req, res) {
  res.render('my-orders', { title: 'Nike Store - Đơn Hàng Của Tôi' });
});

// =============================================
// GET /wishlist  →  Trang Danh Sách Yêu Thích
// =============================================
router.get('/wishlist', function(req, res) {
  res.render('wishlist', { title: 'Nike Store - Danh Sách Yêu Thích Của Tôi' });
});

// =============================================
// GET /search  →  Trang Tìm Kiếm Sản Phẩm (MySQL LIKE Query)
// =============================================
router.get('/search', function(req, res) {
  var query = req.query.q || '';
  var likeQuery = '%' + query + '%';
  var sql = 'SELECT * FROM products WHERE title LIKE ? OR description LIKE ? OR item_type LIKE ? OR category LIKE ? ORDER BY id DESC';
  
  db.query(sql, [likeQuery, likeQuery, likeQuery, likeQuery], function(error, results) {
    if (error) return res.status(500).render('error', { message: 'Lỗi truy vấn tìm kiếm', error });
    res.render('search', { 
      title: 'Nike Store - Tìm Kiếm: ' + query,
      query: query,
      products: results || []
    });
  });
});

// =============================================
// GET /cart  →  Trang Giỏ Hàng & Thanh Toán
// =============================================
router.get('/cart', function(req, res) {
  res.render('cart', { title: 'Nike Store - Giỏ Hàng Của Bạn' });
});

// =============================================
// GET /login  →  Trang Đăng Nhập & Đăng Ký
// =============================================
router.get('/login', function(req, res) {
  res.render('login', { title: 'Nike Store - Đăng Nhập / Đăng Ký' });
});

// =============================================
// GET /admin  →  Trang Quản Trị Hệ Thống (Đơn Hàng, Sản Phẩm, Người Dùng)
// =============================================
router.get('/admin', function(req, res) {
  // Query 1: Danh sách Đơn Hàng
  db.query('SELECT * FROM orders ORDER BY created_at DESC', function(err1, orders) {
    if (err1) return res.status(500).render('error', { message: 'Lỗi tải đơn hàng', error: err1 });

    // Query 2: Danh sách Sản Phẩm
    db.query('SELECT * FROM products ORDER BY id DESC', function(err2, products) {
      if (err2) return res.status(500).render('error', { message: 'Lỗi tải sản phẩm', error: err2 });

      // Query 3: Danh sách Thành Viên
      db.query('SELECT * FROM users ORDER BY id', function(err3, users) {
        if (err3) return res.status(500).render('error', { message: 'Lỗi tải tài khoản', error: err3 });

        res.render('admin', {
          orders: orders || [],
          products: products || [],
          users: users || []
        });
      });
    });
  });
});

module.exports = router;
