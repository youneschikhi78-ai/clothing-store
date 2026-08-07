const express = require('express');
const router = express.Router();
const { db, slugify } = require('../db');
const { isLoggedIn } = require('../middleware/auth');

function settings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
}

function cartInfo(req) {
  const items = req.session.cart || [];
  let count = 0, total = 0;
  for (const it of items) { count += it.qty; total += it.price * it.qty; }
  return { items, count, total };
}

router.use((req, res, next) => {
  if (req.session.user) {
    const u = db.prepare('SELECT banned FROM users WHERE id = ?').get(req.session.user.id);
    if (u && u.banned) {
      return req.session.destroy(() => res.redirect('/login?banned=1'));
    }
  }
  const s = settings();
  const cats = db.prepare('SELECT * FROM categories ORDER BY id').all();
  const c = cartInfo(req);
  res.locals.site = s;
  res.locals.cats = cats;
  res.locals.cartCount = c.count;
  res.locals.user = req.session.user || null;
  next();
});

router.get('/', (req, res) => {
  const banners = db.prepare('SELECT * FROM banners WHERE active = 1 ORDER BY sort_order, id').all();
  const featured = db.prepare(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 AND p.featured = 1 ORDER BY p.created_at DESC LIMIT 8'
  ).all();
  const newest = db.prepare(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 ORDER BY p.created_at DESC LIMIT 8'
  ).all();
  const cats = db.prepare('SELECT * FROM categories ORDER BY id').all();

  res.render('store/home', {
    title: res.locals.site.site_name,
    layout: 'store',
    banners,
    featured,
    newest,
    cats,
  });
});

router.get('/products', (req, res) => {
  const { cat, q } = req.query;
  let sql = 'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1';
  const params = [];

  if (cat) {
    sql += ' AND (c.slug = ? OR c.id = ?)';
    params.push(cat, cat);
  }
  if (q) {
    sql += ' AND p.name LIKE ?';
    params.push('%' + q + '%');
  }
  sql += ' ORDER BY p.created_at DESC';

  const products = db.prepare(sql).all(...params);
  const currentCat = cat ? db.prepare('SELECT * FROM categories WHERE slug = ? OR id = ?').get(cat, cat) : null;

  res.render('store/products', {
    title: currentCat ? currentCat.name : (q ? 'نتائج البحث' : 'جميع المنتجات'),
    layout: 'store',
    products,
    currentCat,
    q: q || '',
  });
});

router.get('/product/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const product = db.prepare(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.active = 1'
  ).get(id);

  if (!product) return res.status(404).render('store/404', { title: 'غير موجود', layout: 'store' });

  const related = db.prepare(
    'SELECT * FROM products WHERE category_id = ? AND id != ? AND active = 1 LIMIT 4'
  ).all(product.category_id, product.id);

  res.render('store/product', { title: product.name, layout: 'store', product, related });
});

router.post('/cart/add', (req, res) => {
  const id = parseInt(req.body.id, 10);
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const product = db.prepare('SELECT id, name, price, image, stock FROM products WHERE id = ? AND active = 1').get(id);
  if (!product) return res.redirect('/products');

  if (!req.session.cart) req.session.cart = [];
  const items = req.session.cart;
  const existing = items.find(i => i.id === product.id);
  if (existing) existing.qty = Math.min(product.stock || 999, existing.qty + qty);
  else items.push({ id: product.id, name: product.name, price: product.price, image: product.image, qty: Math.min(product.stock || 999, qty) });

  res.redirect(req.get('Referer') || '/cart');
});

router.post('/cart/update', (req, res) => {
  const id = parseInt(req.body.id, 10);
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const items = req.session.cart || [];
  const item = items.find(i => i.id === id);
  if (item) item.qty = qty;
  req.session.cart = items;
  res.redirect('/cart');
});

router.post('/cart/remove', (req, res) => {
  const id = parseInt(req.body.id, 10);
  req.session.cart = (req.session.cart || []).filter(i => i.id !== id);
  res.redirect('/cart');
});

router.get('/cart', (req, res) => {
  const c = cartInfo(req);
  res.render('store/cart', { title: 'سلة التسوق', layout: 'store', cart: c });
});

router.get('/checkout', isLoggedIn, (req, res) => {
  const c = cartInfo(req);
  if (c.items.length === 0) return res.redirect('/cart');
  const shipping = parseFloat(res.locals.site.shipping_fee) || 0;
  const freeOver = parseFloat(res.locals.site.free_shipping_over) || 0;
  const shippingCost = (c.total >= freeOver && freeOver > 0) ? 0 : shipping;
  res.render('store/checkout', {
    title: 'إتمام الطلب',
    layout: 'store',
    cart: c,
    shippingCost,
    error: null,
  });
});

router.post('/checkout', isLoggedIn, (req, res) => {
  const c = cartInfo(req);
  if (c.items.length === 0) return res.redirect('/cart');

  const { name, phone, city, address, notes } = req.body;
  let error = null;
  if (!name || !phone || !city || !address) error = 'يرجى ملء جميع الحقول المطلوبة';
  else if (!/^\d{6,}$/.test(phone.replace(/[^0-9]/g, ''))) error = 'رقم الهاتف غير صالح';

  const shipping = parseFloat(res.locals.site.shipping_fee) || 0;
  const freeOver = parseFloat(res.locals.site.free_shipping_over) || 0;
  const shippingCost = (c.total >= freeOver && freeOver > 0) ? 0 : shipping;
  const total = c.total + shippingCost;

  if (error) {
    return res.render('store/checkout', {
      title: 'إتمام الطلب',
      layout: 'store',
      cart: c,
      shippingCost,
      error,
    });
  }

  const info = db.prepare(
    'INSERT INTO orders (user_id, name, phone, city, address, notes, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.session.user.id, name, phone, city, address, notes || '', total);

  const orderId = info.lastInsertRowid;
  const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, qty) VALUES (?, ?, ?, ?, ?)');
  const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  for (const it of c.items) {
    insItem.run(orderId, it.id, it.name, it.price, it.qty);
    decStock.run(it.qty, it.id);
  }

  req.session.cart = [];
  res.redirect('/order/' + orderId + '/success');
});

router.get('/order/:id/success', isLoggedIn, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!order) return res.redirect('/');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('store/order-success', { title: 'تم الطلب بنجاح', layout: 'store', order, items });
});

router.get('/orders', isLoggedIn, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  const statuses = {
    new: 'جديد', processing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي',
  };
  res.render('store/my-orders', { title: 'طلباتي', layout: 'store', orders, statuses });
});

router.get('/order/:id', isLoggedIn, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!order) return res.redirect('/orders');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('store/order-detail', { title: 'تفاصيل الطلب', layout: 'store', order, items });
});

router.get('/page/:slug', (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!page) return res.status(404).render('store/404', { title: 'غير موجود', layout: 'store' });
  res.render('store/page', { title: page.title, layout: 'store', page });
});

router.get('/contact', (req, res) => {
  res.render('store/contact', { title: 'اتصل بنا', layout: 'store', success: null, error: null });
});

router.post('/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  let error = null;
  if (!name || !email || !message) error = 'يرجى ملء جميع الحقول المطلوبة';
  else if (!/^\S+@\S+\.\S+$/.test(email)) error = 'البريد الإلكتروني غير صالح';

  if (error) {
    return res.render('store/contact', { title: 'اتصل بنا', layout: 'store', success: null, error });
  }
  db.prepare('INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)')
    .run(name, email, subject || '', message);
  res.render('store/contact', { title: 'اتصل بنا', layout: 'store', success: 'تم إرسال رسالتك بنجاح، سنتواصل معك قريباً.', error: null });
});

module.exports = router;
