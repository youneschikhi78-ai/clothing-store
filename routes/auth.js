const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword } = db;
const { isGuest } = require('../middleware/auth');
const { isValidEmail, loginLimiter, resetLoginAttempts } = require('../middleware/security');

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get('/login', isGuest, (req, res) => {
  res.render('store/login', {
    title: 'تسجيل الدخول',
    layout: 'store',
    error: req.query.banned ? 'حسابك محظور من المتجر. تواصل مع إدارة المتجر.' : null,
    next: req.query.next || '/',
    cartCount: 0,
  });
});

router.post('/login', loginLimiter, ah(async (req, res) => {
  if (req.rateLock) {
    return res.render('store/login', {
      title: 'تسجيل الدخول',
      layout: 'store',
      error: `محاولات دخول كثيرة. جرب مرة أخرى بعد ${req.rateLock} دقيقة.`,
      next: req.body.next || '/',
      cartCount: 0,
    });
  }

  const { email, password, next } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

  let error = null;
  if (!user) error = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  else if (!verifyPassword(password, user.password_hash)) error = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  else if (user.banned) error = 'حسابك محظور من المتجر. تواصل مع إدارة المتجر.';

  if (error) {
    return res.render('store/login', {
      title: 'تسجيل الدخول',
      layout: 'store',
      error,
      next: next || '/',
      cartCount: 0,
    });
  }

  resetLoginAttempts(res);
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect(user.role === 'admin' ? '/admin' : (next && next !== '/admin/login' ? next : '/'));
}));

router.get('/register', isGuest, (req, res) => {
  res.render('store/register', {
    title: 'إنشاء حساب',
    layout: 'store',
    error: null,
    cartCount: 0,
  });
});

router.post('/register', ah(async (req, res) => {
  const { name, email, password, confirm } = req.body;
  let error = null;

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);

  if (!name || !email || !password) error = 'يرجى ملء جميع الحقول';
  else if (name.length < 2) error = 'الاسم قصير جداً';
  else if (!isValidEmail(email)) error = 'البريد الإلكتروني غير صالح';
  else if (password.length < 6) error = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  else if (password.length > 128) error = 'كلمة المرور طويلة جداً';
  else if (password !== confirm) error = 'كلمتا المرور غير متطابقتين';
  else if (existing) error = 'هذا البريد مسجل مسبقاً';

  if (error) {
    return res.render('store/register', {
      title: 'إنشاء حساب',
      layout: 'store',
      error,
      cartCount: 0,
    });
  }

  const info = await db.run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, hashPassword(password), 'customer']);
  const user = await db.get('SELECT * FROM users WHERE id = ?', [info.lastInsertRowid]);
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect('/');
}));

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
