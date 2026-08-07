const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { slugify, verifyPassword, hashPassword } = db;
const { isAdmin } = require('../middleware/auth');
const { cleanNumber } = require('../middleware/security');

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const cloudinary = require('cloudinary').v2;
const cloudConfigured = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (cloudConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/image\/(png|jpe?g|gif|webp|svg)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('صيغة الصورة غير مدعومة'));
  },
});

function handleUploadError(err, req, res, next) {
  if (err) {
    const fallback = (req.originalUrl || req.url || '/admin/products').split('?')[0];
    if (err.code === 'LIMIT_FILE_SIZE') return res.redirect(fallback + '?upload=size');
    return res.redirect(fallback + '?upload=format');
  }
  next();
}

async function storeImage(req, res, next) {
  if (!req.file) return next();
  try {
    if (cloudConfigured) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: 'clothing-store' }, (err, r) => (err ? reject(err) : resolve(r)));
        stream.end(req.file.buffer);
      });
      req.file.url = result.secure_url;
    } else {
      const dir = path.join(__dirname, '..', 'public', 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(req.file.originalname).toLowerCase();
      const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
      fs.writeFileSync(path.join(dir, filename), req.file.buffer);
      req.file.url = '/uploads/' + filename;
    }
    next();
  } catch (e) { next(e); }
}

const uploadImage = [upload.single('image'), storeImage, handleUploadError];

router.use(isAdmin);
router.use((req, res, next) => {
  res.locals.adminUser = req.session.user;
  res.locals.adminPath = req.path;
  next();
});

async function getStats() {
  return {
    products: (await db.get('SELECT COUNT(*) c FROM products')).c,
    orders: (await db.get('SELECT COUNT(*) c FROM orders')).c,
    newOrders: (await db.get("SELECT COUNT(*) c FROM orders WHERE status = 'new'")).c,
    customers: (await db.get("SELECT COUNT(*) c FROM users WHERE role = 'customer'")).c,
    unreadMessages: (await db.get('SELECT COUNT(*) c FROM messages WHERE read = 0')).c,
    revenue: (await db.get("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status = 'delivered'")).t,
    lowStock: (await db.get('SELECT COUNT(*) c FROM products WHERE stock <= 5')).c,
  };
}

router.get('/', ah(async (req, res) => {
  const stats = await getStats();
  const recentOrders = await db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8');
  const recentMessages = await db.all('SELECT * FROM messages ORDER BY created_at DESC LIMIT 5');
  const topProducts = await db.all(
    `SELECT oi.product_name, SUM(oi.qty) qty, SUM(oi.price * oi.qty) revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'delivered'
     GROUP BY oi.product_id, oi.product_name
     ORDER BY qty DESC LIMIT 5`
  );

  res.render('admin/dashboard', { title: 'لوحة التحكم', layout: 'admin', stats, recentOrders, recentMessages, topProducts });
}));

/* ---------- المنتجات ---------- */
router.get('/products', ah(async (req, res) => {
  const products = await db.all(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.created_at DESC'
  );
  res.render('admin/products', { title: 'المنتجات', layout: 'admin', products });
}));

router.get('/products/new', ah(async (req, res) => {
  const categories = await db.all('SELECT * FROM categories ORDER BY name');
  res.render('admin/product-form', { title: 'منتج جديد', layout: 'admin', product: null, categories, error: null, upload: req.query.upload });
}));

router.post('/products/new', uploadImage, ah(async (req, res) => {
  const { name, category_id, description, price, old_price, stock, featured } = req.body;
  let error = null;
  if (!name || price === '' || price === undefined || stock === '' || stock === undefined) {
    error = 'الاسم والسعر والمخزون حقول مطلوبة';
  } else if (name.length < 2 || name.length > 200) {
    error = 'اسم المنتج غير صالح';
  } else if (cleanNumber(price) <= 0 || cleanNumber(stock) < 0) {
    error = 'السعر أو المخزون غير صالح';
  }

  const image = req.file ? req.file.url : (req.body.image_url || '');
  if (error) {
    const categories = await db.all('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'منتج جديد', layout: 'admin', product: null, categories, error });
  }

  await db.run(
    'INSERT INTO products (name, slug, category_id, description, price, old_price, stock, image, featured, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [name, slugify(name), category_id || null, description || '', cleanNumber(price),
      old_price ? cleanNumber(old_price) : null, cleanNumber(stock), image, featured ? 1 : 0]
  );
  res.redirect('/admin/products');
}));

router.get('/products/:id/edit', ah(async (req, res) => {
  const product = await db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.redirect('/admin/products');
  const categories = await db.all('SELECT * FROM categories ORDER BY name');
  res.render('admin/product-form', { title: 'تعديل منتج', layout: 'admin', product, categories, error: null, upload: req.query.upload });
}));

router.post('/products/:id/edit', uploadImage, ah(async (req, res) => {
  const id = req.params.id;
  const existing = await db.get('SELECT * FROM products WHERE id = ?', [id]);
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

  const image = req.file ? req.file.url : (req.body.image_url || existing.image);
  if (error) {
    const categories = await db.all('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'تعديل منتج', layout: 'admin', product: existing, categories, error });
  }

  await db.run(
    'UPDATE products SET name=?, slug=?, category_id=?, description=?, price=?, old_price=?, stock=?, image=?, featured=?, active=? WHERE id=?',
    [name, slugify(name), category_id || null, description || '', cleanNumber(price),
      old_price ? cleanNumber(old_price) : null, cleanNumber(stock), image, featured ? 1 : 0, active ? 1 : 0, id]
  );
  res.redirect('/admin/products');
}));

router.post('/products/:id/delete', ah(async (req, res) => {
  await db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.redirect('/admin/products');
}));

/* ---------- الفئات ---------- */
router.get('/categories', ah(async (req, res) => {
  const categories = await db.all(
    'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY id'
  );
  res.render('admin/categories', { title: 'الفئات', layout: 'admin', categories, error: null, upload: req.query.upload });
}));

router.post('/categories', uploadImage, ah(async (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    const categories = await db.all(
      'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY id'
    );
    return res.render('admin/categories', { title: 'الفئات', layout: 'admin', categories, error: 'اسم الفئة مطلوب' });
  }
  const image = req.file ? req.file.url : '';
  await db.run('INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)',
    [name, slugify(name), description || '', image]);
  res.redirect('/admin/categories');
}));

router.get('/categories/:id/edit', ah(async (req, res) => {
  const category = await db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!category) return res.redirect('/admin/categories');
  res.render('admin/category-form', { title: 'تعديل فئة', layout: 'admin', category, error: null, upload: req.query.upload });
}));

router.post('/categories/:id/edit', uploadImage, ah(async (req, res) => {
  const id = req.params.id;
  const existing = await db.get('SELECT * FROM categories WHERE id = ?', [id]);
  if (!existing) return res.redirect('/admin/categories');

  const { name, description, remove_image } = req.body;
  if (!name) {
    return res.render('admin/category-form', { title: 'تعديل فئة', layout: 'admin', category: existing, error: 'اسم الفئة مطلوب' });
  }

  let image = existing.image || '';
  if (remove_image) image = '';
  if (req.file) image = req.file.url;

  await db.run('UPDATE categories SET name=?, slug=?, description=?, image=? WHERE id=?',
    [name, slugify(name), description || '', image, id]);
  res.redirect('/admin/categories');
}));

router.post('/categories/:id/delete', ah(async (req, res) => {
  await db.run('DELETE FROM categories WHERE id = ?', [req.params.id]);
  res.redirect('/admin/categories');
}));

/* ---------- الطلبات ---------- */
router.get('/orders', ah(async (req, res) => {
  const status = req.query.status || '';
  const orders = status
    ? await db.all('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC', [status])
    : await db.all('SELECT * FROM orders ORDER BY created_at DESC');
  res.render('admin/orders', { title: 'الطلبات', layout: 'admin', orders, status });
}));

router.get('/orders/:id', ah(async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  res.render('admin/order-detail', { title: 'طلب #' + order.id, layout: 'admin', order, items });
}));

router.post('/orders/:id/status', ah(async (req, res) => {
  await db.run('UPDATE orders SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  res.redirect('/admin/orders/' + req.params.id);
}));

router.post('/orders/:id/delete', ah(async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.redirect('/admin/orders');

  const restorable = ['new', 'processing', 'cancelled'];
  if (restorable.includes(order.status)) {
    const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    for (const it of items) {
      if (it.product_id) await db.run('UPDATE products SET stock = stock + ? WHERE id = ?', [it.qty, it.product_id]);
    }
  }
  await db.run('DELETE FROM orders WHERE id = ?', [req.params.id]);
  res.redirect('/admin/orders');
}));

/* ---------- العملاء ---------- */
router.get('/customers', ah(async (req, res) => {
  const customers = await db.all(
    `SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
     (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.user_id = u.id AND o.status != 'cancelled') AS total_spent
     FROM users u WHERE u.role = 'customer' ORDER BY u.created_at DESC`
  );
  res.render('admin/customers', { title: 'العملاء', layout: 'admin', customers });
}));

router.post('/customers/:id/ban', ah(async (req, res) => {
  await db.run("UPDATE users SET banned = CASE banned WHEN 1 THEN 0 ELSE 1 END WHERE id = ? AND role = 'customer'", [req.params.id]);
  res.redirect('/admin/customers');
}));

/* ---------- الرسائل ---------- */
router.get('/messages', ah(async (req, res) => {
  const messages = await db.all('SELECT * FROM messages ORDER BY created_at DESC');
  res.render('admin/messages', { title: 'الرسائل', layout: 'admin', messages });
}));

router.get('/messages/:id', ah(async (req, res) => {
  await db.run('UPDATE messages SET read = 1 WHERE id = ?', [req.params.id]);
  const message = await db.get('SELECT * FROM messages WHERE id = ?', [req.params.id]);
  if (!message) return res.redirect('/admin/messages');
  res.render('admin/message-detail', { title: 'رسالة', layout: 'admin', message });
}));

router.post('/messages/:id/delete', ah(async (req, res) => {
  await db.run('DELETE FROM messages WHERE id = ?', [req.params.id]);
  res.redirect('/admin/messages');
}));

/* ---------- البانرات ---------- */
router.get('/banners', ah(async (req, res) => {
  const banners = await db.all('SELECT * FROM banners ORDER BY sort_order, id');
  res.render('admin/banners', { title: 'البانرات', layout: 'admin', banners, error: null, upload: req.query.upload });
}));

router.post('/banners', uploadImage, ah(async (req, res) => {
  const { title, subtitle, link, sort_order } = req.body;
  if (!title) {
    const banners = await db.all('SELECT * FROM banners ORDER BY sort_order, id');
    return res.render('admin/banners', { title: 'البانرات', layout: 'admin', banners, error: 'عنوان البانر مطلوب' });
  }
  const image = req.file ? req.file.url : '';
  await db.run('INSERT INTO banners (title, subtitle, image, link, sort_order) VALUES (?, ?, ?, ?, ?)',
    [title, subtitle || '', image, link || '', cleanNumber(sort_order)]);
  res.redirect('/admin/banners');
}));

router.post('/banners/:id/delete', ah(async (req, res) => {
  await db.run('DELETE FROM banners WHERE id = ?', [req.params.id]);
  res.redirect('/admin/banners');
}));

router.post('/banners/:id/toggle', ah(async (req, res) => {
  await db.run('UPDATE banners SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [req.params.id]);
  res.redirect('/admin/banners');
}));

/* ---------- مناطق التوصيل ---------- */
router.get('/zones', ah(async (req, res) => {
  const zones = await db.all('SELECT * FROM delivery_zones ORDER BY sort_order, id');
  res.render('admin/zones', { title: 'مناطق التوصيل', layout: 'admin', zones, error: null });
}));

router.post('/zones', ah(async (req, res) => {
  const { name, price, sort_order } = req.body;
  if (!name) {
    const zones = await db.all('SELECT * FROM delivery_zones ORDER BY sort_order, id');
    return res.render('admin/zones', { title: 'مناطق التوصيل', layout: 'admin', zones, error: 'اسم الولاية مطلوب' });
  }
  await db.run('INSERT INTO delivery_zones (name, price, sort_order) VALUES (?, ?, ?)',
    [String(name).trim(), cleanNumber(price), cleanNumber(sort_order)]);
  res.redirect('/admin/zones');
}));

router.post('/zones/:id/edit', ah(async (req, res) => {
  const { name, price, active, sort_order } = req.body;
  if (!name) {
    const zones = await db.all('SELECT * FROM delivery_zones ORDER BY sort_order, id');
    return res.render('admin/zones', { title: 'مناطق التوصيل', layout: 'admin', zones, error: 'اسم الولاية مطلوب' });
  }
  await db.run('UPDATE delivery_zones SET name=?, price=?, active=?, sort_order=? WHERE id=?',
    [String(name).trim(), cleanNumber(price), active ? 1 : 0, cleanNumber(sort_order), req.params.id]);
  res.redirect('/admin/zones');
}));

router.post('/zones/:id/toggle', ah(async (req, res) => {
  await db.run('UPDATE delivery_zones SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [req.params.id]);
  res.redirect('/admin/zones');
}));

router.post('/zones/:id/delete', ah(async (req, res) => {
  await db.run('DELETE FROM delivery_zones WHERE id = ?', [req.params.id]);
  res.redirect('/admin/zones');
}));

/* ---------- الصفحات ---------- */
router.get('/pages', ah(async (req, res) => {
  const pages = await db.all('SELECT * FROM pages ORDER BY id');
  res.render('admin/pages', { title: 'الصفحات', layout: 'admin', pages });
}));

router.get('/pages/new', (req, res) => {
  res.render('admin/page-form', { title: 'صفحة جديدة', layout: 'admin', page: null, error: null });
});

router.post('/pages/new', ah(async (req, res) => {
  const { slug, title, content, published } = req.body;
  if (!slug || !title) {
    return res.render('admin/page-form', { title: 'صفحة جديدة', layout: 'admin', page: null, error: 'الرابط والعنوان مطلوبان' });
  }
  try {
    await db.run('INSERT INTO pages (slug, title, content, published) VALUES (?, ?, ?, ?)',
      [slugify(slug), title, content || '', published ? 1 : 0]);
  } catch (e) {
    return res.render('admin/page-form', { title: 'صفحة جديدة', layout: 'admin', page: null, error: 'هذا الرابط مستخدم مسبقاً' });
  }
  res.redirect('/admin/pages');
}));

router.get('/pages/:id/edit', ah(async (req, res) => {
  const page = await db.get('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.redirect('/admin/pages');
  res.render('admin/page-form', { title: 'تعديل صفحة', layout: 'admin', page, error: null });
}));

router.post('/pages/:id/edit', ah(async (req, res) => {
  const { slug, title, content, published } = req.body;
  try {
    await db.run('UPDATE pages SET slug=?, title=?, content=?, published=? WHERE id=?',
      [slugify(slug), title, content || '', published ? 1 : 0, req.params.id]);
  } catch (e) {
    const page = await db.get('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    return res.render('admin/page-form', { title: 'تعديل صفحة', layout: 'admin', page, error: 'هذا الرابط مستخدم مسبقاً' });
  }
  res.redirect('/admin/pages');
}));

router.post('/pages/:id/delete', ah(async (req, res) => {
  await db.run('DELETE FROM pages WHERE id = ?', [req.params.id]);
  res.redirect('/admin/pages');
}));

/* ---------- الإعدادات ---------- */
router.get('/settings', ah(async (req, res) => {
  const rows = await db.all('SELECT key, value FROM settings');
  const s = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
  res.render('admin/settings', { title: 'الإعدادات', layout: 'admin', s, saved: !!req.query.saved });
}));

router.post('/settings', ah(async (req, res) => {
  const allowed = [
    'site_name', 'site_tagline', 'site_phone', 'site_email', 'site_address', 'currency',
    'shipping_fee', 'free_shipping_over', 'hero_title', 'hero_subtitle', 'about_text',
    'fb_url', 'insta_url', 'tw_url',
  ];
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    const value = String(req.body[key]).trim();
    if (key === 'shipping_fee' || key === 'free_shipping_over') {
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, String(cleanNumber(value))]);
    } else if (value.length > 500) {
      continue;
    } else {
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]);
    }
  }
  res.redirect('/admin/settings?saved=1');
}));

/* ---------- الحساب ---------- */
router.get('/profile', (req, res) => {
  res.render('admin/profile', { title: 'الملف الشخصي', layout: 'admin', success: null, error: null });
});

router.post('/profile', ah(async (req, res) => {
  const { name, current_password, new_password } = req.body;
  let error = null;

  if (new_password && new_password.length < 6) error = 'كلمة المرور الجديدة قصيرة جداً';
  else if (new_password && new_password.length > 128) error = 'كلمة المرور الجديدة طويلة جداً';
  if (name && (name.length < 2 || name.length > 100)) error = 'الاسم غير صالح';
  if (!error && current_password) {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    if (!verifyPassword(current_password, user.password_hash)) error = 'كلمة المرور الحالية غير صحيحة';
    else await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(new_password), user.id]);
  }
  if (!error && name) {
    await db.run('UPDATE users SET name = ? WHERE id = ?', [name, req.session.user.id]);
    req.session.user.name = name;
  }
  res.render('admin/profile', { title: 'الملف الشخصي', layout: 'admin', success: error ? null : 'تم الحفظ بنجاح', error });
}));

module.exports = router;
