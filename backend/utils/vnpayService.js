const { VNPay, VnpLocale, ProductCode } = require('vnpay');

// Khởi tạo VNPay với cấu hình Sandbox
const vnpay = new VNPay({
    tmnCode: 'D0A2JLIZ',
    secureSecret: 'KFRVKF6HNYMRYTFPZKM0WOD87Q8GAY3S',
    vnpayHost: 'https://sandbox.vnpayment.vn',
    testMode: true, // môi trường Sandbox
    hashAlgorithm: 'SHA512',
});

module.exports = {
    vnpay,
    VnpLocale,
    ProductCode
};
