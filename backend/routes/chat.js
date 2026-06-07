var express = require('express');
var router = express.Router();
var mysql = require('mysql2');
var { GoogleGenAI } = require('@google/genai');

// Cấu hình Database
var db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nike_store'
});

// Khởi tạo Gemini AI Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

router.post('/', async function (req, res) {
  try {
    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ error: 'Nội dung tin nhắn không được để trống' });
    }

    // Lấy danh sách sản phẩm để làm ngữ cảnh
    db.query('SELECT id, title, price, category, color, item_type FROM products LIMIT 50', async function(err, products) {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).json({ error: 'Lỗi truy xuất cơ sở dữ liệu' });
      }

      // Xây dựng chuỗi Context về sản phẩm
      let productContext = products.map(p => `- ID: ${p.id}, Tên: ${p.title}, Giá: ${p.price}đ, Danh mục: ${p.category}, Màu: ${p.color}, Loại: ${p.item_type}`).join('\n');

      const systemPrompt = `Bạn là chuyên gia tư vấn bán hàng nhiệt tình và chuyên nghiệp của Nike Store.
Nhiệm vụ của bạn là tư vấn giày, quần áo, phụ kiện cho khách hàng dựa trên danh sách sản phẩm cửa hàng đang có.
Nếu khách hàng hỏi về một sản phẩm cụ thể, hãy cố gắng tìm sản phẩm phù hợp nhất trong danh sách và giới thiệu nó.

ĐẶC BIỆT QUAN TRỌNG VỀ ĐỊNH DẠNG TRẢ LỜI:
- Trả lời ngắn gọn, thân thiện, súc tích (dưới 100 chữ nếu có thể).
- Khi bạn muốn giới thiệu một sản phẩm, BẮT BUỘC phải đính kèm thẻ sản phẩm bằng cú pháp chính xác như sau:
[PRODUCT_ID: {id}] 
Ví dụ: "Em thấy đôi này rất hợp với anh ạ: [PRODUCT_ID: 15]"

DANH SÁCH SẢN PHẨM HIỆN CÓ:
${productContext}
`;
      
      const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: userMessage,
          config: {
              systemInstruction: systemPrompt,
              temperature: 0.7,
          }
      });

      let textResponse = response.text;
      
      // Parse response to find product recommendations and fetch their full details (image, etc.)
      const productRegex = /\[PRODUCT_ID:\s*(\d+)\]/g;
      let recommendedProductIds = [];
      let match;
      while ((match = productRegex.exec(textResponse)) !== null) {
        recommendedProductIds.push(parseInt(match[1]));
      }

      if (recommendedProductIds.length > 0) {
        // Fetch full product info for UI rendering
        db.query('SELECT id, title, price, image FROM products WHERE id IN (?)', [recommendedProductIds], function(err2, recProducts) {
          if (err2) {
             return res.json({ reply: textResponse, products: [] });
          }
          res.json({ reply: textResponse, products: recProducts });
        });
      } else {
        res.json({ reply: textResponse, products: [] });
      }

    });

  } catch (error) {
    console.error('Chat AI Error:', error);
    res.status(500).json({ error: 'Đã xảy ra lỗi khi gọi AI. Vui lòng kiểm tra lại API Key.' });
  }
});

module.exports = router;
