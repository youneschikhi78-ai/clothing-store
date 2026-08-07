const express = require('express');
const router = express.Router();
const { db, hashPassword, verifyPassword } = require('../db');
const { isGuest } = require('../middleware/auth');
const { isValidEmail, loginLimiter, resetLoginAttempts } = require('../middleware/security');

router.get('/login', isGuest, (req, res) => {
  res.render('store/login', {
    title: 'تسجيل الدخول',
    layout: 'store',
    error: req.query.banned ? 'حسابك محظور من المتجر. تواصل مع إدارة المتجر.' : null,
    next: req.query.next || '/',
    cartCount: 0,
  });
});

router.post('/login', loginLimiter, (req, res) => {
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
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

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
});

router.get('/register', isGuest, (req, res) => {
  res.render('store/register', {
    title: 'إنشاء حساب',
    layout: 'store',
    error: null,
    cartCount: 0,
  });
});

router.post('/register', (req, res) => {
  const { name, email, password, confirm } = req.body;
  let error = null;

  if (!name || !email || !password) error = 'يرجى ملء جميع الحقول';
  else if (name.length < 2) error = 'الاسم قصير جداً';
  else if (!isValidEmail(email)) error = 'البريد الإلكتروني غير صالح';
  else if (password.length < 6) error = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  else if (password.length > 128) error = 'كلمة المرور طويلة جداً';
  else if (password !== confirm) error = 'كلمتا المرور غير متطابقتين';
  else if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) error = 'هذا البريد مسجل مسبقاً';

  if (error) {
    return res.render('store/register', {
      title: 'إنشاء حساب',
      layout: 'store',
      error,
      cartCount: 0,
    });
  }

  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, hashPassword(password), 'customer');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
