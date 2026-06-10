var express = require('express');
var router = express.Router();
var mysql = require('mysql2');
var { GoogleGenAI } = require('@google/genai');

// Cấu hình Database
var db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nike_store',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Khởi tạo Gemini AI Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Lưu lịch sử hội thoại theo session (Map: sessionId → Array of messages)
const conversationHistory = new Map();

router.post('/', async function (req, res) {
  try {
    const userMessage = req.body.message;
    const sessionId = req.body.sessionId || 'default';

    if (!userMessage) {
      return res.status(400).json({ error: 'Nội dung tin nhắn không được để trống' });
    }

    // Lấy danh sách sản phẩm đa dạng theo từng loại để làm ngữ cảnh
    // Strategy: lấy sản phẩm từ mỗi item_type, tổng không quá 150 sp
    const productQuery = `
      SELECT id, title, price, category, color, item_type
      FROM products
      ORDER BY RAND()
      LIMIT 150
    `;

    db.query(productQuery, async function(err, products) {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).json({ error: 'Lỗi truy xuất cơ sở dữ liệu' });
      }

      // Nhóm sản phẩm theo item_type để context rõ ràng hơn cho AI
      const grouped = {};
      products.forEach(p => {
        const type = p.item_type || 'other';
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(p);
      });

      // Build context cấu trúc rõ ràng
      let productContext = '';
      for (const [type, items] of Object.entries(grouped)) {
        productContext += `\n=== ${type.toUpperCase()} ===\n`;
        productContext += items.map(p =>
          `  - ID: ${p.id}, Tên: ${p.title}, Giá: ${Number(p.price).toLocaleString('vi-VN')}đ, Danh mục: ${p.category}, Màu: ${p.color || 'Không rõ'}`
        ).join('\n');
        productContext += '\n';
      }

      const systemPrompt = `Bạn là chuyên gia tư vấn bán hàng nhiệt tình và thân thiện của Nike Store Việt Nam.
Nhiệm vụ: tư vấn TOÀN BỘ sản phẩm Nike gồm giày, quần, áo, hoodie, jacket, shorts, socks, mũ/cap, phụ kiện, balo, dụng cụ thể thao,...

QUY TẮC TRẢ LỜI:
1. Phân tích yêu cầu khách: họ hỏi về loại sản phẩm gì? giá bao nhiêu? màu gì?
2. Tìm sản phẩm ĐÚNG LOẠI trong danh sách (ví dụ: hỏi quần → tìm item_type = shorts/pants/clothing, hỏi áo → tìm shirt/hoodie/jacket/apparel)
3. Trả lời ngắn gọn, thân thiện (dưới 100 chữ)
4. BẮT BUỘC đính kèm ID sản phẩm phù hợp nhất bằng cú pháp: [PRODUCT_ID: {id}]
   Ví dụ: "Em có đôi giày này rất hợp: [PRODUCT_ID: 15]"
5. Nếu khách hỏi về quần thì tìm item_type có chứa: pants, shorts, clothing, apparel
6. Nếu khách hỏi về áo thì tìm item_type có chứa: shirt, hoodie, jacket, apparel, tops
7. Nếu không tìm được sản phẩm phù hợp → thành thật nói cửa hàng chưa có loại đó

DANH SÁCH SẢN PHẨM HIỆN CÓ (nhóm theo loại):
${productContext}
`;

      // Lấy lịch sử hội thoại của session này
      let history = conversationHistory.get(sessionId) || [];

      // Thêm tin nhắn mới của user vào history
      history.push({ role: 'user', parts: [{ text: userMessage }] });

      // Giới hạn history tối đa 10 lượt (để tiết kiệm token)
      if (history.length > 20) {
        history = history.slice(history.length - 20);
      }

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: history,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
          }
        });

        let textResponse = response.text;

        // Thêm phản hồi của AI vào history
        history.push({ role: 'model', parts: [{ text: textResponse }] });
        conversationHistory.set(sessionId, history);

        // Parse response để tìm sản phẩm được gợi ý
        const productRegex = /\[PRODUCT_ID:\s*(\d+)\]/g;
        let recommendedProductIds = [];
        let match;
        while ((match = productRegex.exec(textResponse)) !== null) {
          const id = parseInt(match[1]);
          if (!isNaN(id) && !recommendedProductIds.includes(id)) {
            recommendedProductIds.push(id);
          }
        }

        if (recommendedProductIds.length > 0) {
          db.query(
            'SELECT id, title, price, image, item_type, color FROM products WHERE id IN (?)',
            [recommendedProductIds],
            function(err2, recProducts) {
              if (err2) {
                return res.json({ reply: textResponse, products: [] });
              }
              res.json({ reply: textResponse, products: recProducts });
            }
          );
        } else {
          res.json({ reply: textResponse, products: [] });
        }

      } catch (aiError) {
        console.error('Gemini AI Error:', aiError);
        return res.status(500).json({ error: 'Lỗi khi gọi AI: ' + aiError.message });
      }
    });

  } catch (error) {
    console.error('Chat Route Error:', error);
    res.status(500).json({ error: 'Đã xảy ra lỗi. Vui lòng thử lại.' });
  }
});

module.exports = router;
