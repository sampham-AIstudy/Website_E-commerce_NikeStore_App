const nodemailer = require('nodemailer');

// Cấu hình transporter. 
// Sử dụng Gmail SMTP. Người dùng có thể cấu hình qua biến môi trường MAIL_USER và MAIL_PASS.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER || '', // Địa chỉ Gmail của bạn
    pass: process.env.MAIL_PASS || ''  // Mật khẩu ứng dụng (App Password)
  }
});

/**
 * Gửi mã OTP về email của người dùng
 * @param {string} email Địa chỉ email nhận
 * @param {string} code Mã OTP (6 chữ số)
 * @param {string} purpose Mục đích gửi ('register' hoặc 'forgot')
 */
async function sendOTP(email, code, purpose) {
  const isRegister = purpose === 'register';
  const subject = isRegister ? 'Nike Store - Mã OTP Xác Nhận Đăng Ký' : 'Nike Store - Mã OTP Đặt Lại Mật Khẩu';
  const actionText = isRegister ? 'xác nhận đăng ký tài khoản mới' : 'đặt lại mật khẩu tài khoản';
  
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #eef2f5; border-radius: 20px; background-color: #ffffff; color: #111111;">
      <div style="text-align: center; margin-bottom: 25px;">
        <h2 style="color: #FF5400; margin: 0; font-size: 28px; font-weight: 900; letter-spacing: -1px; text-transform: uppercase;">NIKE<span style="color: #111111;">STORE</span></h2>
        <p style="font-size: 12px; color: #707072; text-transform: uppercase; tracking-wider; margin-top: 5px;">Premium Footwear Portal</p>
      </div>
      
      <div style="border-top: 2px solid #FF5400; padding-top: 25px;">
        <p style="font-size: 15px; line-height: 1.6; color: #333333;">Xin chào,</p>
        <p style="font-size: 15px; line-height: 1.6; color: #333333;">Bạn đã gửi yêu cầu ${actionText} tại Nike Store. Dưới đây là mã xác thực OTP của bạn:</p>
        
        <div style="background-color: #f7f7f9; border-radius: 16px; padding: 20px; text-align: center; margin: 30px 0; border: 1px dashed #e1e8ed;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #FF5400; font-family: monospace; display: inline-block; padding-left: 8px;">${code}</span>
        </div>
        
        <p style="font-size: 13px; line-height: 1.6; color: #707072;">Mã OTP này có hiệu lực trong vòng <strong>5 phút</strong>. Vì sự an toàn của tài khoản, vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
        <p style="font-size: 13px; line-height: 1.6; color: #707072;">Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.</p>
      </div>
      
      <div style="border-top: 1px solid #f1f1f4; margin-top: 30px; padding-top: 20px; text-align: center; font-size: 11px; color: #a1a1a5;">
        <p>&copy; 2026 Nike Store. Đường Đại Lộ Nike, Hà Nội, Việt Nam.</p>
      </div>
    </div>
  `;

  console.log(`[MAILER] 📧 Chuẩn bị gửi OTP [${code}] đến [${email}] cho mục đích [${purpose}]`);

  // Nếu không cấu hình tài khoản gửi mail, ta in trực tiếp ra console để tiện phát triển/kiểm thử cục bộ
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS || 
      process.env.MAIL_USER.includes('dia_chi_gmail_cua_ban') || 
      process.env.MAIL_PASS.includes('mat_khau_ung_dung_gmail')) {
    console.log('\n=============================================================');
    console.log(`[MAILER] ⚠️ SMTP CHƯA CẤU HÌNH. MÃ OTP CỦA BẠN LÀ: ${code}`);
    console.log(`[MAILER] Để gửi email thực tế, vui lòng thiết lập biến môi trường MAIL_USER và MAIL_PASS.`);
    console.log('=============================================================\n');
    return true; 
  }

  try {
    await transporter.sendMail({
      from: `"Nike Store" <${process.env.MAIL_USER}>`,
      to: email,
      subject: subject,
      html: html
    });
    console.log(`[MAILER] ✅ Đã gửi email OTP thành công tới ${email}`);
    return true;
  } catch (error) {
    console.error('[MAILER] ❌ Lỗi khi gửi email qua nodemailer:', error);
    throw error;
  }
}

module.exports = { sendOTP };
