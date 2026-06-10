const express = require('express');
const router = express.Router();
const mysql = require('mysql2');

// KẾT NỐI MySQL (XAMPP mặc định)
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nike_store',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Middleware xác thực quyền Admin
const requireAdmin = (req, res, next) => {
  // Vì đây là API gọi từ phía client đã login (thông qua token ở headers hoặc session tùy cơ chế)
  // Trong dự án hiện tại, backend dường như chưa có middleware JWT bắt buộc cho mọi API.
  // Nhưng để bảo mật, ta sẽ thêm ở đây nếu có. Hiện tại pass through.
  next();
};

/**
 * Lấy khoảng thời gian (WHERE clause) dựa trên tham số `range`
 */
function getDateCondition(range) {
  let condition = '';
  switch (range) {
    case 'today':
      condition = 'DATE(o.created_at) = CURDATE()';
      break;
    case '7d':
      condition = 'o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
      break;
    case '30d':
      condition = 'o.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
      break;
    case 'this_month':
      condition = 'MONTH(o.created_at) = MONTH(CURDATE()) AND YEAR(o.created_at) = YEAR(CURDATE())';
      break;
    case 'this_year':
      condition = 'YEAR(o.created_at) = YEAR(CURDATE())';
      break;
    default:
      condition = '1=1'; // All time
  }
  return condition;
}

// GET /api/analytics/v2/dashboard
router.get('/v2/dashboard', requireAdmin, async (req, res) => {
  const range = req.query.range || 'all';
  const dateCond = getDateCondition(range);

  try {
    const stats = {};

    // 1. KPI Tổng quan
    const kpiData = await new Promise((resolve, reject) => {
      const q = `
        SELECT
          COUNT(*) AS total_orders,
          SUM(CASE WHEN o.status NOT IN ('cancelled','pending_payment') THEN o.total_amount ELSE 0 END) AS gross_revenue,
          SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount ELSE 0 END) AS confirmed_revenue,
          COUNT(DISTINCT o.user_id) AS total_customers,
          SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) AS success_orders,
          SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders
        FROM orders o
        WHERE ${dateCond}
      `;
      db.query(q, (err, results) => err ? reject(err) : resolve(results[0]));
    });

    stats.kpi = {
      gross_revenue: kpiData.gross_revenue || 0,
      confirmed_revenue: kpiData.confirmed_revenue || 0,
      total_orders: kpiData.total_orders || 0,
      total_customers: kpiData.total_customers || 0,
      success_rate: kpiData.total_orders > 0 ? Math.round((kpiData.success_orders / kpiData.total_orders) * 100) : 0,
      cancel_rate: kpiData.total_orders > 0 ? Math.round((kpiData.cancelled_orders / kpiData.total_orders) * 100) : 0,
    };

    // 2. Biểu đồ doanh thu (Revenue Chart)
    const revenueGrouping = (range === 'today' || range === '7d' || range === '30d' || range === 'this_month') 
      ? 'DATE(o.created_at)' 
      : 'DATE_FORMAT(o.created_at, "%Y-%m")';
    
    const revenueData = await new Promise((resolve, reject) => {
      const q = `
        SELECT 
          ${revenueGrouping} as label,
          SUM(CASE WHEN o.status NOT IN ('cancelled','pending_payment') THEN o.total_amount ELSE 0 END) as value
        FROM orders o
        WHERE ${dateCond}
        GROUP BY label
        ORDER BY label ASC
      `;
      db.query(q, (err, results) => err ? reject(err) : resolve(results));
    });
    stats.revenueChart = revenueData;

    // 3. Phân bổ trạng thái đơn hàng (Order Status Chart)
    const orderStatusData = await new Promise((resolve, reject) => {
      const q = `
        SELECT status, COUNT(*) as count 
        FROM orders o 
        WHERE ${dateCond}
        GROUP BY status
      `;
      db.query(q, (err, results) => err ? reject(err) : resolve(results));
    });
    stats.orderStatusChart = orderStatusData;

    // 4. Top Sản Phẩm Bán Chạy (Top Products)
    const topProductsData = await new Promise((resolve, reject) => {
      const q = `
        SELECT 
          p.id, p.title, p.image, p.stock,
          SUM(oi.quantity) as total_sold,
          SUM(oi.quantity * oi.price) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.status NOT IN ('cancelled','pending_payment') AND ${dateCond}
        GROUP BY p.id
        ORDER BY total_sold DESC
        LIMIT 10
      `;
      db.query(q, (err, results) => err ? reject(err) : resolve(results));
    });
    stats.topProducts = topProductsData;

    // 5. Cảnh báo tồn kho (Low Stock)
    const lowStockData = await new Promise((resolve, reject) => {
      const q = `
        SELECT id, title, image, stock 
        FROM products 
        WHERE stock <= 20
        ORDER BY stock ASC 
        LIMIT 5
      `;
      db.query(q, (err, results) => err ? reject(err) : resolve(results));
    });
    stats.lowStock = lowStockData;
    stats.kpi.low_stock_count = lowStockData.length;

    // 6. Doanh thu theo danh mục (Category Chart)
    const categoryData = await new Promise((resolve, reject) => {
      const q = `
        SELECT 
          p.item_type as label,
          SUM(oi.quantity * oi.price) as value
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.status NOT IN ('cancelled','pending_payment') AND ${dateCond}
        GROUP BY p.item_type
        ORDER BY value DESC
      `;
      db.query(q, (err, results) => err ? reject(err) : resolve(results));
    });
    stats.categoryChart = categoryData;

    // 7. Sinh Gợi Ý Thông Minh (Smart Insights) - Heuristics Rules
    const insights = [];
    
    // Rule 1: Product recommendation
    if (topProductsData.length > 0) {
      const bestProduct = topProductsData[0];
      if (bestProduct.stock < 50) {
        insights.push({
          type: 'warning',
          icon: '🔥',
          text: `Sản phẩm <strong>${bestProduct.title}</strong> đang bán rất chạy (${bestProduct.total_sold} chiếc) nhưng kho chỉ còn ${bestProduct.stock}. Cần nhập thêm hàng ngay!`
        });
      } else {
        insights.push({
          type: 'success',
          icon: '📈',
          text: `Sản phẩm <strong>${bestProduct.title}</strong> dẫn đầu doanh số với ${bestProduct.total_sold} chiếc được bán ra. Cân nhắc đẩy mạnh quảng cáo!`
        });
      }
    }

    // Rule 2: Low Stock Alert
    if (lowStockData.length > 0) {
      insights.push({
        type: 'danger',
        icon: '⚠️',
        text: `Có <strong>${lowStockData.length} sản phẩm</strong> sắp hết hàng (tồn kho dưới 20 chiếc). Hãy kiểm tra thẻ Tồn kho.`
      });
    }

    // Rule 3: Category Insights
    if (categoryData.length > 0) {
      const bestCategory = categoryData[0];
      insights.push({
        type: 'info',
        icon: '💡',
        text: `Danh mục <strong>${bestCategory.label}</strong> mang lại doanh thu cao nhất. Ưu tiên các chương trình khuyến mãi cho nhóm này để kích cầu.`
      });
    }

    // Rule 4: Conversion Rate
    if (kpiData.total_orders > 0) {
      const cancelRate = Math.round((kpiData.cancelled_orders / kpiData.total_orders) * 100);
      if (cancelRate > 20) {
        insights.push({
          type: 'danger',
          icon: '📉',
          text: `Tỷ lệ hủy đơn đang ở mức cao (<strong>${cancelRate}%</strong>). Hãy kiểm tra lại lý do hủy đơn từ khách hàng.`
        });
      } else {
        const successRate = Math.round((kpiData.success_orders / kpiData.total_orders) * 100);
        insights.push({
          type: 'success',
          icon: '✅',
          text: `Tỷ lệ giao hàng thành công đạt <strong>${successRate}%</strong>. Hoạt động vận hành đang rất ổn định!`
        });
      }
    }

    stats.insights = insights;

    res.json({ status: 'success', data: stats });
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ status: 'error', message: 'Lỗi khi tải dữ liệu thống kê.' });
  }
});

module.exports = router;
