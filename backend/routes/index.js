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

// ─── Server-side filter helper for category pages ─────────────────────────────
var VALID_ITEM_TYPES = ['shoes','bags','cap','equipment','hoodie','jacket','pants','shirt','shorts','socks','accessories','apparel'];
var VALID_SORTS      = ['default','price-asc','price-desc'];

function buildCategoryQuery(baseWhere, req) {
  var conditions = [baseWhere];
  var params     = [];
  var itemType   = (req.query.item_type || '').toLowerCase().trim();
  var priceRange = (req.query.price_range || '').trim();
  var sortVal    = (req.query.sort || 'default').trim();
  var searchQ    = (req.query.q || '').trim();

  // Filter by item_type
  if (itemType && VALID_ITEM_TYPES.includes(itemType)) {
    conditions.push('item_type = ?');
    params.push(itemType);
  }

  // Filter by price range (giá trong DB là nghìn VNĐ, nhân 1000 cho so sánh)
  if (priceRange === 'under-1m') {
    conditions.push('price < 1000');
  } else if (priceRange === '1m-2m') {
    conditions.push('price >= 1000 AND price <= 2000');
  } else if (priceRange === '2m-4m') {
    conditions.push('price >= 2000 AND price <= 4000');
  } else if (priceRange === 'over-4m') {
    conditions.push('price > 4000');
  }

  // Search by title
  if (searchQ) {
    conditions.push('title LIKE ?');
    params.push('%' + searchQ + '%');
  }

  // Build ORDER BY
  var orderBy = 'ORDER BY id DESC';
  if (sortVal === 'price-asc')  orderBy = 'ORDER BY price ASC';
  if (sortVal === 'price-desc') orderBy = 'ORDER BY price DESC';

  var sql = 'SELECT * FROM products WHERE ' + conditions.join(' AND ') + ' ' + orderBy;
  return { sql: sql, params: params, filters: { item_type: itemType, price_range: priceRange, sort: sortVal, q: searchQ } };
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
  var q = buildCategoryQuery('category = "men"', req);
  db.query(q.sql, q.params, function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Thời Trang Nam', categorySlug: 'men', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems, filters: q.filters });
  });
});

// =============================================
// GET /women  →  Giày Nữ
// =============================================
router.get('/women', function(req, res) {
  var q = buildCategoryQuery('category = "women"', req);
  db.query(q.sql, q.params, function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Thời Trang Nữ', categorySlug: 'women', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems, filters: q.filters });
  });
});

// =============================================
// GET /kids  →  Giày Trẻ Em
// =============================================
router.get('/kids', function(req, res) {
  var q = buildCategoryQuery('category = "kids"', req);
  db.query(q.sql, q.params, function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Thời Trang Trẻ Em', categorySlug: 'kids', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems, filters: q.filters });
  });
});

// =============================================
// GET /new  →  Sản Phẩm Mới
// =============================================
router.get('/new', function(req, res) {
  var q = buildCategoryQuery('is_new = 1', req);
  db.query(q.sql, q.params, function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Sản Phẩm Mới Nhất', categorySlug: 'new', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems, filters: q.filters });
  });
});

// =============================================
// GET /sale  →  Khuyến Mãi
// =============================================
router.get('/sale', function(req, res) {
  var q = buildCategoryQuery('discount_percent > 0', req);
  db.query(q.sql, q.params, function(error, results) {
    if (error) return res.status(500).render('error', { message: error.message, error });
    var p = paginate(req, results);
    res.render('category', { categoryTitle: 'Giảm Giá Cực Sốc', categorySlug: 'sale', products: p.items, page: p.page, totalPages: p.totalPages, totalItems: p.totalItems, filters: q.filters });
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
// GET /api/products/:id/purchases  →  Lấy danh sách các lần mua sản phẩm của user
// =============================================
router.get('/api/products/:id/purchases', function(req, res) {
  var productId = req.params.id;
  var userId = req.query.userId;
  if (!userId) return res.json({ purchases: [] });

  var sql = `
    SELECT o.id as order_id, o.created_at, r.id as review_id, r.rating, r.comment 
    FROM orders o 
    JOIN order_items oi ON o.id = oi.order_id 
    LEFT JOIN reviews r ON r.order_id = o.id AND r.product_id = oi.product_id
    WHERE o.user_id = ? AND oi.product_id = ? AND o.status != 'cancelled'
    ORDER BY o.created_at DESC
  `;
  db.query(sql, [userId, productId], function(err, results) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ purchases: results });
  });
});

// =============================================
// POST /api/products/:id/reviews  →  Thêm hoặc cập nhật đánh giá theo đơn hàng
// =============================================
router.post('/api/products/:id/reviews', function(req, res) {
  var productId = req.params.id;
  var userId = req.body.user_id || null;
  var username = req.body.username || 'Khách ẩn danh';
  var rating = parseInt(req.body.rating) || 5;
  var comment = req.body.comment || '';
  var orderId = req.body.order_id || null;

  if (!userId || !orderId) {
    return res.status(403).json({ status: 'error', message: 'Vui lòng đăng nhập và chọn một đơn hàng hợp lệ để đánh giá' });
  }
  if (!comment) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng điền nội dung nhận xét' });
  }

  // 1. Check if user actually owns this order and order contains product
  var checkOrderSql = 'SELECT 1 FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.id = ? AND o.user_id = ? AND oi.product_id = ? AND o.status != "cancelled" LIMIT 1';
  db.query(checkOrderSql, [orderId, userId, productId], function(err1, orderRes) {
    if (err1) return res.status(500).json({ status: 'error', message: err1.message });
    if (orderRes.length === 0) {
      return res.status(403).json({ status: 'error', message: 'Bạn không thể đánh giá cho đơn hàng này.' });
    }

    // 2. Check if a review already exists for this order
    var checkReviewSql = 'SELECT id FROM reviews WHERE order_id = ? AND product_id = ? LIMIT 1';
    db.query(checkReviewSql, [orderId, productId], function(err2, revRes) {
      if (err2) return res.status(500).json({ status: 'error', message: err2.message });

      if (revRes.length > 0) {
        // Update
        var updateSql = 'UPDATE reviews SET rating = ?, comment = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?';
        db.query(updateSql, [rating, comment, revRes[0].id], function(err3) {
          if (err3) return res.status(500).json({ status: 'error', message: err3.message });
          res.json({ status: 'success', message: 'Cập nhật đánh giá thành công' });
        });
      } else {
        // Insert
        var insertSql = 'INSERT INTO reviews (product_id, order_id, user_id, username, rating, comment) VALUES (?, ?, ?, ?, ?, ?)';
        db.query(insertSql, [productId, orderId, userId, username, rating, comment], function(err4, result) {
          if (err4) return res.status(500).json({ status: 'error', message: err4.message });
          res.json({ status: 'success', message: 'Gửi đánh giá thành công' });
        });
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
// GET /profile  →  Trang Thông Tin Cá Nhân
// =============================================
router.get('/profile', function(req, res) {
  res.render('profile', { title: 'Nike Store - Thông Tin Cá Nhân' });
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

        // Query 4: Danh sách Vouchers
        db.query('SELECT * FROM vouchers ORDER BY id DESC', function(err4, vouchers) {
          if (err4) return res.status(500).render('error', { message: 'Lỗi tải mã giảm giá', error: err4 });

          res.render('admin', {
            orders: orders || [],
            products: products || [],
            users: users || [],
            vouchers: vouchers || []
          });
        });
      });
    });
  });
});

module.exports = router;
