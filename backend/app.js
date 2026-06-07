const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config(); // Fallback to current dir
var createError = require('http-errors');
var express = require('express');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');

var indexRouter = require('./routes/index');
var apiRouter = require('./routes/api');
var authRouter = require('./routes/auth');
var ordersRouter = require('./routes/orders');
var chatRouter = require('./routes/chat');

var app = express();

// Helper to translate item_type to Vietnamese globally for EJS
app.locals.translateItemType = function(type) {
  const map = {
    'accessories': 'Phụ kiện',
    'apparel': 'Quần áo',
    'bags': 'Balo/Túi',
    'cap': 'Mũ/Nón',
    'equipment': 'Dụng cụ',
    'hoodie': 'Áo Hoodie',
    'jacket': 'Áo khoác',
    'pants': 'Quần dài',
    'shirt': 'Áo thun',
    'shoes': 'Giày',
    'shorts': 'Quần ngắn',
    'socks': 'Tất/Vớ'
  };
  return map[(type || '').toLowerCase()] || type || '';
};

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
// app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '../public')));

// Cho phép React (Vite port 5173) hoặc các client khác gọi API
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

// Routes
app.use('/', indexRouter);
app.use('/api', apiRouter);
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/chat', chatRouter);

// 404 handler
app.use(function (req, res, next) {
  next(createError(404));
});

// Error handler
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
