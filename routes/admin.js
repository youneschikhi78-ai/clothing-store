const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { db, slugify } = require('../db');
const { isAdmin } = require('../middleware/auth');
const { cleanNumber } = require('../middleware/security');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/image\/(png|jpe?g|gif|webp|svg)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('صيغة الصورة غير مدعومة'));
  },
});

function handleUploadError(err, req, res, next) {
  if (err) {
    const fallback = req.path || '/admin/products';
    if (err.code === 'LIMIT_FILE_SIZE') return res.redirect(fallback + '?upload=size');
    return res.redirect(fallback + '?upload=format');
  }
  next();
}

router.use(isAdmin);
router.use((req, res, next) => {
  res.locals.adminUser = req.session.user;
  res.locals.adminPath = req.path;
  next();
});

function getStats() {
  return {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    newOrders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'new'").get().c,
    customers: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer'").get().c,
    unreadMessages: db.prepare('SELECT COUNT(*) c FROM messages WHERE read = 0').get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status = 'delivered'").get().t,
    lowStock: db.prepare('SELECT COUNT(*) c FROM products WHERE stock <= 5').get().c,
  };
}

router.get('/', (req, res) => {
  const stats = getStats();
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8').all();
  const recentMessages = db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 5').all();
  const topProducts = db.prepare(
    `SELECT oi.product_name, SUM(oi.qty) qty, SUM(oi.price * oi.qty) revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'delivered'
     GROUP BY oi.product_id
     ORDER BY qty DESC LIMIT 5`
  ).all();

  res.render('admin/dashboard', { title: 'لوحة التحكم', layout: 'admin', stats, recentOrders, recentMessages, topProducts });
});

/* ---------- المنتجات ---------- */
router.get('/products', (req, res) => {
  const products = db.prepare(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.created_at DESC'
  ).all();
  res.render('admin/products', { title: 'المنتجات', layout: 'admin', products });
});

router.get('/products/new', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/product-form', { title: 'منتج جديد', layout: 'admin', product: null, categories, error: null, upload: req.query.upload });
});

router.post('/products/new', upload.single('image'), handleUploadError, (req, res) => {
  const { name, category_id, description, price, old_price, stock, featured } = req.body;
  let error = null;
  if (!name || price === '' || price === undefined || stock === '' || stock === undefined) {
    error = 'الاسم والسعر والمخزون حقول مطلوبة';
  } else if (name.length < 2 || name.length > 200) {
    error = 'اسم المنتج غير صالح';
  } else if (cleanNumber(price) <= 0 || cleanNumber(stock) < 0) {
    error = 'السعر أو المخزون غير صالح';
  }

  const image = req.file ? '/uploads/' + req.file.filename : (req.body.image_url || '');
  if (error) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('admin/product-form', { title: 'منتج جديد', layout: 'admin', product: null, categories, error });
  }

  db.prepare(
    'INSERT INTO products (name, slug, category_id, description, price, old_price, stock, image, featured, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
  ).run(
    name, slugify(name), category_id || null, description || '', cleanNumber(price),
    old_price ? cleanNumber(old_price) : null, cleanNumber(stock), image, featured ? 1 : 0
  );
  res.redirect('/admin/products');
});

router.get('/products/:id/edit', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.redirect('/admin/products');
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/product-form', { title: 'تعديل منتج', layout: 'admin', product, categories, error: null, upload: req.query.upload });
});

router.post('/products/:id/edit', upload.single('image'), handleUploadError, (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.redirect('/admin/products');

  const { name, category_id, description, price, old_price, stock, featured, active } = req.body;
  let error = null;
  if (!name || price === '' || price === undefined || stock === '' || stock === undefined) {
    error = 'الاسم والسعر والمخزون حقول مطلوبة';
  } else if (name.length < 2 || name.length > 200) {
    error = 'اسم المنتج غير صالح';
  } else if (cleanNumber(price) <= 0 || cleanNumber(stock) < 0) {
    error = 'السعر أو المخزون غير صالح';
  }

  const image = req.file ? '/uploads/' + req.file.filename : (req.body.image_url || existing.image);
  if (error) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('admin/product-form', { title: 'تعديل منتج', layout: 'admin', product: existing, categories, error });
  }

  db.prepare(
    'UPDATE products SET name=?, slug=?, category_id=?, description=?, price=?, old_price=?, stock=?, image=?, featured=?, active=? WHERE id=?'
  ).run(
    name, slugify(name), category_id || null, description || '', cleanNumber(price),
    old_price ? cleanNumber(old_price) : null, cleanNumber(stock), image, featured ? 1 : 0, active ? 1 : 0, id
  );
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.redirect('/admin/products');
});

/* ---------- الفئات ---------- */
router.get('/categories', (req, res) => {
  const categories = db.prepare(
    'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY id'
  ).all();
  res.render('admin/categories', { title: 'الفئات', layout: 'admin', categories, error: null });
});

router.post('/categories', (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    const categories = db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY id').all();
    return res.render('admin/categories', { title: 'الفئات', layout: 'admin', categories, error: 'اسم الفئة مطلوب' });
  }
  db.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)')
    .run(name, slugify(name), description || '');
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin/categories');
});

/* ---------- الطلبات ---------- */
router.get('/orders', (req, res) => {
  const status = req.query.status || '';
  const orders = status
    ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.render('admin/orders', { title: 'الطلبات', layout: 'admin', orders, status });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.redirect('/admin/orders');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('admin/order-detail', { title: 'طلب #' + order.id, layout: 'admin', order, items });
});

router.post('/orders/:id/status', (req, res) => {
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.redirect('/admin/orders/' + req.params.id);
});

router.post('/orders/:id/delete', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.redirect('/admin/orders');

  const restorable = ['new', 'processing', 'cancelled'];
  if (restorable.includes(order.status)) {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
    for (const it of items) {
      if (it.product_id) restoreStock.run(it.qty, it.product_id);
    }
  }
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.redirect('/admin/orders');
});

/* ---------- العملاء ---------- */
router.get('/customers', (req, res) => {
  const customers = db.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
     (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.user_id = u.id AND o.status != 'cancelled') AS total_spent
     FROM users u WHERE u.role = 'customer' ORDER BY u.created_at DESC`
  ).all();
  res.render('admin/customers', { title: 'العملاء', layout: 'admin', customers });
});

router.post('/customers/:id/ban', (req, res) => {
  db.prepare("UPDATE users SET banned = CASE banned WHEN 1 THEN 0 ELSE 1 END WHERE id = ? AND role = 'customer'").run(req.params.id);
  res.redirect('/admin/customers');
});

/* ---------- الرسائل ---------- */
router.get('/messages', (req, res) => {
  const messages = db.prepare('SELECT * FROM messages ORDER BY created_at DESC').all();
  res.render('admin/messages', { title: 'الرسائل', layout: 'admin', messages });
});

router.get('/messages/:id', (req, res) => {
  db.prepare('UPDATE messages SET read = 1 WHERE id = ?').run(req.params.id);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!message) return res.redirect('/admin/messages');
  res.render('admin/message-detail', { title: 'رسالة', layout: 'admin', message });
});

router.post('/messages/:id/delete', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.redirect('/admin/messages');
});

/* ---------- البانرات ---------- */
router.get('/banners', (req, res) => {
  const banners = db.prepare('SELECT * FROM banners ORDER BY sort_order, id').all();
  res.render('admin/banners', { title: 'البانرات', layout: 'admin', banners, error: null, upload: req.query.upload });
});

router.post('/banners', upload.single('image'), handleUploadError, (req, res) => {
  const { title, subtitle, link, sort_order } = req.body;
  if (!title) {
    const banners = db.prepare('SELECT * FROM banners ORDER BY sort_order, id').all();
    return res.render('admin/banners', { title: 'البانرات', layout: 'admin', banners, error: 'عنوان البانر مطلوب' });
  }
  const image = req.file ? '/uploads/' + req.file.filename : '';
  db.prepare('INSERT INTO banners (title, subtitle, image, link, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(title, subtitle || '', image, link || '', cleanNumber(sort_order));
  res.redirect('/admin/banners');
});

router.post('/banners/:id/delete', (req, res) => {
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  res.redirect('/admin/banners');
});

router.post('/banners/:id/toggle', (req, res) => {
  db.prepare('UPDATE banners SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id);
  res.redirect('/admin/banners');
});

/* ---------- الصفحات ---------- */
router.get('/pages', (req, res) => {
  const pages = db.prepare('SELECT * FROM pages ORDER BY id').all();
  res.render('admin/pages', { title: 'الصفحات', layout: 'admin', pages });
});

router.get('/pages/new', (req, res) => {
  res.render('admin/page-form', { title: 'صفحة جديدة', layout: 'admin', page: null, error: null });
});

router.post('/pages/new', (req, res) => {
  const { slug, title, content, published } = req.body;
  if (!slug || !title) {
    return res.render('admin/page-form', { title: 'صفحة جديدة', layout: 'admin', page: null, error: 'الرابط والعنوان مطلوبان' });
  }
  try {
    db.prepare('INSERT INTO pages (slug, title, content, published) VALUES (?, ?, ?, ?)')
      .run(slugify(slug), title, content || '', published ? 1 : 0);
  } catch (e) {
    return res.render('admin/page-form', { title: 'صفحة جديدة', layout: 'admin', page: null, error: 'هذا الرابط مستخدم مسبقاً' });
  }
  res.redirect('/admin/pages');
});

router.get('/pages/:id/edit', (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.redirect('/admin/pages');
  res.render('admin/page-form', { title: 'تعديل صفحة', layout: 'admin', page, error: null });
});

router.post('/pages/:id/edit', (req, res) => {
  const { slug, title, content, published } = req.body;
  try {
    db.prepare('UPDATE pages SET slug=?, title=?, content=?, published=? WHERE id=?')
      .run(slugify(slug), title, content || '', published ? 1 : 0, req.params.id);
  } catch (e) {
    const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
    return res.render('admin/page-form', { title: 'تعديل صفحة', layout: 'admin', page, error: 'هذا الرابط مستخدم مسبقاً' });
  }
  res.redirect('/admin/pages');
});

router.post('/pages/:id/delete', (req, res) => {
  db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
  res.redirect('/admin/pages');
});

/* ---------- الإعدادات ---------- */
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
  res.render('admin/settings', { title: 'الإعدادات', layout: 'admin', s, saved: !!req.query.saved });
});

router.post('/settings', (req, res) => {
  const allowed = [
    'site_name', 'site_tagline', 'site_phone', 'site_email', 'site_address', 'currency',
    'shipping_fee', 'free_shipping_over', 'hero_title', 'hero_subtitle', 'about_text',
    'fb_url', 'insta_url', 'tw_url',
  ];
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    const value = String(req.body[key]).trim();
    if (key === 'shipping_fee' || key === 'free_shipping_over') {
      upsert.run(key, String(cleanNumber(value)));
    } else if (value.length > 500) {
      continue;
    } else {
      upsert.run(key, value);
    }
  }
  res.redirect('/admin/settings?saved=1');
});

/* ---------- الحساب ---------- */
router.get('/profile', (req, res) => {
  res.render('admin/profile', { title: 'الملف الشخصي', layout: 'admin', success: null, error: null });
});

router.post('/profile', (req, res) => {
  const { name, current_password, new_password } = req.body;
  let error = null;

  if (new_password && new_password.length < 6) error = 'كلمة المرور الجديدة قصيرة جداً';
  else if (new_password && new_password.length > 128) error = 'كلمة المرور الجديدة طويلة جداً';
  if (name && (name.length < 2 || name.length > 100)) error = 'الاسم غير صالح';
  if (!error && current_password) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    const { verifyPassword, hashPassword } = require('../db');
    if (!verifyPassword(current_password, user.password_hash)) error = 'كلمة المرور الحالية غير صحيحة';
    else db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), user.id);
  }
  if (!error && name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.session.user.id);
    req.session.user.name = name;
  }
  res.render('admin/profile', { title: 'الملف الشخصي', layout: 'admin', success: error ? null : 'تم الحفظ بنجاح', error });
});

module.exports = router;
