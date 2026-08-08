const express = require('express');
const router = express.Router();
const db = require('../db');
const { slugify } = db;
const { isLoggedIn } = require('../middleware/auth');
const { isValidEmail, isValidPhone, cleanNumber } = require('../middleware/security');

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function settings() {
  const rows = await db.all('SELECT key, value FROM settings');
  return rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
}

function cartInfo(req) {
  const items = req.session.cart || [];
  let count = 0, total = 0;
  for (const it of items) { count += it.qty; total += it.price * it.qty; }
  return { items, count, total };
}

router.use(ah(async (req, res, next) => {
  if (req.session.user) {
    const u = await db.get('SELECT banned FROM users WHERE id = ?', [req.session.user.id]);
    if (u && u.banned) {
      return req.session.destroy(() => res.redirect('/login?banned=1'));
    }
  }
  const s = await settings();
  const cats = await db.all('SELECT * FROM categories ORDER BY id');
  const c = cartInfo(req);
  res.locals.site = s;
  res.locals.cats = cats;
  res.locals.cartCount = c.count;
  res.locals.user = req.session.user || null;
  next();
}));

router.get('/', ah(async (req, res) => {
  const banners = await db.all('SELECT * FROM banners WHERE active = 1 ORDER BY sort_order, id');
  const featured = await db.all(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 AND p.featured = 1 ORDER BY p.created_at DESC LIMIT 8'
  );
  const newest = await db.all(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 ORDER BY p.created_at DESC LIMIT 8'
  );
  const cats = await db.all('SELECT * FROM categories ORDER BY id');

  res.render('store/home', {
    title: res.locals.site.site_name,
    layout: 'store',
    banners,
    featured,
    newest,
    cats,
  });
}));

router.get('/products', ah(async (req, res) => {
  const { cat, q } = req.query;
  const catNum = cat && /^\d+$/.test(cat) ? parseInt(cat, 10) : null;
  let sql = 'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1';
  const params = [];

  if (cat) {
    if (catNum !== null) {
      sql += ' AND (c.slug = ? OR c.id = ?)';
      params.push(cat, catNum);
    } else {
      sql += ' AND c.slug = ?';
      params.push(cat);
    }
  }
  if (q) {
    sql += ' AND p.name LIKE ?';
    params.push('%' + q + '%');
  }
  sql += ' ORDER BY p.created_at DESC';

  const products = await db.all(sql, params);
  const currentCat = cat
    ? (catNum !== null
        ? await db.get('SELECT * FROM categories WHERE slug = ? OR id = ?', [cat, catNum])
        : await db.get('SELECT * FROM categories WHERE slug = ?', [cat]))
    : null;

  res.render('store/products', {
    title: currentCat ? currentCat.name : (q ? 'نتائج البحث' : 'جميع المنتجات'),
    layout: 'store',
    products,
    currentCat,
    q: q || '',
  });
}));

router.get('/product/:id', ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const product = await db.get(
    'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.active = 1',
    [id]
  );

  if (!product) return res.status(404).render('store/404', { title: 'غير موجود', layout: 'store' });

  const related = await db.all(
    'SELECT * FROM products WHERE category_id = ? AND id != ? AND active = 1 LIMIT 4',
    [product.category_id, product.id]
  );

  res.render('store/product', { title: product.name, layout: 'store', product, related });
}));

router.post('/cart/add', ah(async (req, res) => {
  const id = parseInt(req.body.id, 10);
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const product = await db.get('SELECT id, name, price, image, stock FROM products WHERE id = ? AND active = 1', [id]);
  if (!product) return res.redirect('/products');

  if (!req.session.cart) req.session.cart = [];
  const items = req.session.cart;
  const existing = items.find(i => i.id === product.id);
  if (existing) existing.qty = Math.min(product.stock || 999, existing.qty + qty);
  else items.push({ id: product.id, name: product.name, price: product.price, image: product.image, qty: Math.min(product.stock || 999, qty) });

  res.redirect(req.get('Referer') || '/cart');
}));

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

router.get('/checkout', isLoggedIn, ah(async (req, res) => {
  const c = cartInfo(req);
  if (c.items.length === 0) return res.redirect('/cart');
  const zones = await db.all('SELECT * FROM delivery_zones WHERE active = 1 ORDER BY sort_order, id');
  let shippingCost = null;
  let freeOver = 0;
  if (zones.length === 0) {
    const shipping = parseFloat(res.locals.site.shipping_fee) || 0;
    freeOver = parseFloat(res.locals.site.free_shipping_over) || 0;
    shippingCost = (c.total >= freeOver && freeOver > 0) ? 0 : shipping;
  }
  res.render('store/checkout', {
    title: 'إتمام الطلب',
    layout: 'store',
    cart: c,
    zones,
    shippingCost,
    freeOver,
    selectedCity: '',
    error: null,
  });
}));

router.post('/checkout', isLoggedIn, ah(async (req, res) => {
  const c = cartInfo(req);
  if (c.items.length === 0) return res.redirect('/cart');

  const { name, phone, city, address, notes } = req.body;
  let error = null;
  if (!name || !phone || !city || !address) error = 'يرجى ملء جميع الحقول المطلوبة';
  else if (name.length < 2 || name.length > 100) error = 'الاسم غير صالح';
  else if (!isValidPhone(phone)) error = 'رقم الهاتف غير صالح';
  else if (city.length < 2 || city.length > 60) error = 'المدينة غير صالحة';
  else if (address.length < 5 || address.length > 300) error = 'العنوان غير صالح';

  const zones = await db.all('SELECT * FROM delivery_zones WHERE active = 1 ORDER BY sort_order, id');
  const zoneMode = zones.length > 0;
  let shippingCost = 0;
  let zoneMatched = false;
  if (zoneMode) {
    const zone = zones.find(z => z.name === city);
    if (!zone) error = 'يرجى اختيار الولاية من القائمة';
    else { zoneMatched = true; shippingCost = zone.price; }
  } else {
    const shipping = parseFloat(res.locals.site.shipping_fee) || 0;
    const freeOver = parseFloat(res.locals.site.free_shipping_over) || 0;
    shippingCost = (c.total >= freeOver && freeOver > 0) ? 0 : shipping;
  }
  const total = c.total + shippingCost;

  if (error) {
    return res.render('store/checkout', {
      title: 'إتمام الطلب',
      layout: 'store',
      cart: c,
      zones,
      shippingCost: zoneMode ? (zoneMatched ? shippingCost : null) : shippingCost,
      freeOver: zoneMode ? 0 : (parseFloat(res.locals.site.free_shipping_over) || 0),
      selectedCity: city || '',
      error,
    });
  }

  const info = await db.run(
    'INSERT INTO orders (user_id, name, phone, city, address, notes, total, shipping) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.session.user.id, name, phone, city, address, notes || '', total, shippingCost]
  );

  const orderId = info.lastInsertRowid;
  for (const it of c.items) {
    await db.run('INSERT INTO order_items (order_id, product_id, product_name, price, qty) VALUES (?, ?, ?, ?, ?)',
      [orderId, it.id, it.name, it.price, it.qty]);
    await db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [it.qty, it.id]);
  }

  req.session.cart = [];
  res.redirect('/order/' + orderId + '/success');
}));

router.get('/order/:id/success', isLoggedIn, ah(async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  if (!order) return res.redirect('/');
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  res.render('store/order-success', { title: 'تم الطلب بنجاح', layout: 'store', order, items });
}));

router.get('/orders', isLoggedIn, ah(async (req, res) => {
  const orders = await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id]);
  const statuses = {
    new: 'جديد', processing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي',
  };
  res.render('store/my-orders', { title: 'طلباتي', layout: 'store', orders, statuses });
}));

router.get('/order/:id', isLoggedIn, ah(async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  if (!order) return res.redirect('/orders');
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  res.render('store/order-detail', { title: 'تفاصيل الطلب', layout: 'store', order, items });
}));

router.get('/page/:slug', ah(async (req, res) => {
  const page = await db.get('SELECT * FROM pages WHERE slug = ? AND published = 1', [req.params.slug]);
  if (!page) return res.status(404).render('store/404', { title: 'غير موجود', layout: 'store' });
  res.render('store/page', { title: page.title, layout: 'store', page });
}));

router.get('/contact', (req, res) => {
  res.render('store/contact', { title: 'اتصل بنا', layout: 'store', success: null, error: null });
});

router.post('/contact', ah(async (req, res) => {
  const { name, email, subject, message } = req.body;
  let error = null;
  if (!name || !email || !message) error = 'يرجى ملء جميع الحقول المطلوبة';
  else if (!isValidEmail(email)) error = 'البريد الإلكتروني غير صالح';
  else if (name.length < 2 || name.length > 100) error = 'الاسم غير صالح';
  else if (message.length < 2 || message.length > 2000) error = 'الرسالة طويلة جداً';

  if (error) {
    return res.render('store/contact', { title: 'اتصل بنا', layout: 'store', success: null, error });
  }
  await db.run('INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
    [name, email, subject || '', message]);
  res.render('store/contact', { title: 'اتصل بنا', layout: 'store', success: 'تم إرسال رسالتك بنجاح، سنتواصل معك قريباً.', error: null });
}));

module.exports = router;
