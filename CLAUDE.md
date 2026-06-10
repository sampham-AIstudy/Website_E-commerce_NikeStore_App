# CLAUDE.md — Quy tắc bổ sung cho dự án Nike Store

> Tệp này là phần mở rộng của GEMINI.md toàn cục.
> Các rule ở đây được đúc kết từ những lỗi lặp lại nhiều lần trong quá trình phát triển dự án Nike Store.

---

## 1. Terminal — Luôn dùng PowerShell

- **KHÔNG BAO GIỜ** đề xuất lệnh CMD (`cd`, `set`, `dir`, `&&`, `type`, `cls`, ...).
- Luôn dùng lệnh PowerShell tương đương (`Set-Location`, `$env:VAR`, `Get-ChildItem`, ...`).
- Nếu gặp lỗi CMD, tự dịch sang PowerShell ngay mà không cần user nhắc.

---

## 2. SQL — Luôn đưa lệnh cho user tự thực thi

- **KHÔNG BAO GIỜ** tự chạy lệnh SQL thay đổi cơ sở dữ liệu (ALTER, CREATE, DROP, UPDATE, INSERT hàng loạt).
- Luôn xuất đoạn SQL ra để user dán vào phpMyAdmin hoặc MySQL CLI tự chạy.
- Sau khi user thực thi xong, hỏi user kết quả rồi mới làm bước tiếp theo.
- Không giả định SQL đã chạy thành công.

---

## 3. Đồng bộ Web + Database phải đi cùng nhau

- Khi sửa logic trên web (route, EJS, filter,...) mà liên quan đến cột/bảng DB → **luôn kiểm tra và cung cấp SQL đồng bộ kèm theo**.
- Khi thay đổi schema DB → **luôn cập nhật code backend + frontend tương ứng**.
- Ví dụ lỗi hay gặp: sửa `item_type` trên web nhưng DB vẫn còn giá trị cũ không khớp → user phải hỏi lại.

---

## 4. Logic giỏ hàng và thanh toán — Chuẩn Shopee

- Giỏ hàng: sản phẩm thêm vào **KHÔNG mặc định được tích**; user phải tự tích mặc muốn thanh toán.
- Thứ tự giỏ hàng: sản phẩm **thêm mới nhất** hiển thị ở trên đầu.
- Thanh toán: chỉ thanh toán những sản phẩm đã tích, không phải toàn bộ giỏ.
- Địa chỉ giao hàng: user có thể thêm **nhiều địa chỉ**, có 1 địa chỉ mặc định, khi thanh toán chỉ cần chọn.
- Kích thước (size): phải **tự động** theo loại sản phẩm (giày → số, quần áo → S/M/L/XL).
- Voucher: chia 2 loại — giảm giá sản phẩm và giảm phí ship (giống Shopee).

---

## 5. Sản phẩm — Tính năng thực tế

- Mỗi loại sản phẩm (`item_type`) có kích thước riêng, không dùng chung một bộ size.
- Kho hàng phải giảm đúng số lượng khi mua.
- Đánh giá sản phẩm: chỉ được đánh giá sau khi đã mua; mỗi đơn hàng chỉ đánh giá 1 lần; có thể chỉnh sửa.
- Màu sắc sản phẩm phải chuẩn hóa tiếng Việt: Trắng, Đen, Đỏ, Xanh, Xanh lá, Xanh Navy, Vàng, Cam, Hồng, Tím, Xám, Nâu, Bạc.

---

## 6. Xác thực OTP qua Email

- OTP được gửi **sau** khi user nhập email (không gửi ngay khi mở form).
- Luồng quên mật khẩu: nhập email → OTP xác thực → mới cho phép nhập mật khẩu mới.
- Luồng đăng ký: nhập thông tin → OTP xác thực email → mới tạo tài khoản.
- Nút "Quên mật khẩu" phải đặt **dưới ô nhập mật khẩu** (không phải giữa form).
- Email OTP log ra terminal là bình thường — đó là log debug.

---

## 7. Bộ lọc sản phẩm

- Bộ lọc phải bao quát **tất cả** các trang: trang chủ, nam, nữ, trẻ em, tìm kiếm, quản trị viên.
- `item_type = 'clothing'` hay `'quần áo'` chung chung → **xóa**, thay bằng danh mục cụ thể: `shirt`, `pants`, `hoodie`, `jacket`, `shorts`, `socks`, `cap`.
- Bộ lọc phải tự cập nhật khi thay đổi loại sản phẩm (không cần chọn thủ công từng trường).

---

## 8. Giao diện — Nhất quán và hiện đại

- Font chữ phải **nhất quán** toàn bộ trang — không được có trường hợp chữ to chữ nhỏ không đồng đều.
- Thanh trượt (slider/carousel) chỉ trượt trái/phải — **không trượt theo scroll chuột**.
- Animation: mượt mà, không giật, không ảnh hưởng đến UX khi cuộn trang.
- Các section (xu hướng, câu chuyện,...) phải có style tối giản hiện đại, không trắng trơn.

---

## 9. Không tự chạy script thay đổi dữ liệu

- Script import ảnh hàng loạt, script seed DB, script migrate — **đưa lệnh và hướng dẫn cho user tự chạy**.
- Sau khi script chạy xong: hỏi user kết quả, sau đó đồng bộ DB nếu cần.
- Script tải ảnh phải có cơ chế **chống trùng lặp** (dùng hash cache, lưu vào file giữa các lần chạy).

---

## 10. Kiểm tra thực tế trước khi báo "xong"

- Trước khi nói "đã hoàn thành", hãy tự kiểm tra:
  - Route có tồn tại không?
  - Dữ liệu DB có khớp với code filter không?
  - Edge case (chưa đăng nhập, giỏ hàng rỗng, hết hàng,...) đã xử lý chưa?
- Nếu chưa thể kiểm tra, ghi rõ **checklist kiểm tra** để user tự verify.
- **Không báo thành công khi chưa có output thực tế từ user.**

---

## 11. Nhớ ngữ cảnh dự án

- Dự án là **Nike Store** — Node.js + Express + EJS + MySQL (không phải React/Next.js).
- File cơ sở dữ liệu tham khảo: `databases/nike_store.sql`.
- Khi cần sửa gì liên quan đến DB, luôn đọc file SQL này trước để hiểu schema hiện tại.
- Khi tính năng mới cần bảng/cột mới, luôn kiểm tra xem đã có trong schema chưa trước khi tạo thêm.

---

## 12. Chatbot AI và tính năng nâng cao

- Chatbot: phải gợi ý sản phẩm cụ thể và hiển thị link bấm vào được, không chỉ trả lời văn bản.
- API Gemini: đọc key từ `.env`, không hardcode.
- Khi route chatbot bị lỗi 404, kiểm tra lại `app.js` đã mount route đúng chưa.

---

*Cập nhật lần cuối: 07/06/2026 — Đúc kết từ phân tích 50 session gần nhất.*
