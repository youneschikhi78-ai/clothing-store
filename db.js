const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const db = new DatabaseSync(path.join(__dirname, 'store.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  price REAL NOT NULL,
  old_price REAL DEFAULT NULL,
  image TEXT DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT DEFAULT '',
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  price REAL NOT NULL,
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  image TEXT DEFAULT '',
  link TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT DEFAULT '',
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const userCols = db.prepare('PRAGMA table_info(users)').all();
if (!userCols.some(c => c.name === 'banned')) {
  db.exec("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0");
  console.log('✓ تمت ترقية قاعدة البيانات (عمود banned)');
}

const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const SCRYPT_LEGACY = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT).toString('hex');
  return `scrypt$${SCRYPT.N}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  const parts = stored.split('$');
  let N, salt, hash;
  let opts;

  if (parts.length === 4 && parts[0] === 'scrypt') {
    N = parseInt(parts[1], 10) || SCRYPT.N;
    salt = parts[2];
    hash = parts[3];
    opts = { r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
  } else if (!stored.includes('$')) {
    const idx = stored.lastIndexOf(':');
    if (idx <= 0) return false;
    salt = stored.slice(0, idx);
    hash = stored.slice(idx + 1);
    N = SCRYPT_LEGACY.N;
    opts = SCRYPT_LEGACY;
  } else {
    return false;
  }

  if (!/^[0-9a-f]{128}$/.test(hash)) return false;
  const candidate = crypto.scryptSync(password, salt, 64, { ...opts, N }).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function slugify(text) {
  const arabic = 'أبتثجحخدذرزسشصضطظعغفقكلمنهويإآىة';
  return text.toString().trim().toLowerCase()
    .replace(/[أإآ]/g, 'a')
    .replace(/[ؤئي]/g, 'y')
    .replace(/ة/g, 'h')
    .replace(/ى/g, 'y')
    .replace(/[\s_-]+/g, '-')
    .replace(/[^\w\u0600-\u06FF-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('مدير المتجر', 'admin@store.com', hashPassword('admin123'), 'admin');
    console.log('✓ تم إنشاء حساب المدير: admin@store.com / admin123');
  }

  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (catCount === 0) {
    const cats = [
      ['رجالي', 'men', 'أزياء رجالية عصرية', ''],
      ['نسائي', 'women', 'أزياء نسائية راقية', ''],
      ['أطفال', 'kids', 'ملابس مريحة للأطفال', ''],
      ['أحذية', 'shoes', 'أحذية بجميع المقاسات', ''],
      ['إكسسوارات', 'accessories', 'أكسسوارات وإضافات مميزة', ''],
    ];
    const insCat = db.prepare('INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)');
    for (const c of cats) insCat.run(...c);

    const products = [
      ['قميص قطني رجالي', 1, 120, 160, 30, 1],
      ['بنطال جينز كلاسيكي', 1, 250, 320, 25, 1],
      ['فستان سهرة أنيق', 2, 450, 550, 15, 1],
      ['بلوزة نسائية صيفية', 2, 180, 220, 40, 1],
      ['طقم أطفال كامل', 3, 200, 260, 20, 1],
      ['حذاء رياضي', 4, 350, 420, 18, 1],
      ['حقيبة يد جلدية', 5, 300, 380, 12, 1],
      ['ساعة عصرية', 5, 220, 280, 22, 1],
      ['تيشيرت صيفي', 1, 90, 120, 50, 0],
      ['تنورة نسائية', 2, 140, 180, 33, 0],
      ['حذاء جلد رسمي', 4, 400, 500, 10, 0],
      ['وشاح حريري', 5, 80, 110, 45, 0],
    ];
    const insP = db.prepare(
      'INSERT INTO products (name, category_id, description, price, old_price, stock, featured, active, slug) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
    );
    for (const [name, cat, price, old, stock, feat] of products) {
      insP.run(name, cat, `تشكيلة ${name} عالية الجودة من متجرنا، متوفرة بمقاسات وألوان متعددة.`, price, old, stock, feat, slugify(name));
    }
    console.log('✓ تم إنشاء البيانات التجريبية (5 فئات، 12 منتج)');
  }

  const setCount = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  if (setCount === 0) {
    const settings = {
      site_name: 'موضة ستايل',
      site_tagline: 'أحدث صيحات الموضة بأسعار تناسب الجميع',
      site_phone: '0123456789',
      site_email: 'info@store.com',
      site_address: 'القاهرة، مصر',
      currency: 'ج.م',
      shipping_fee: '50',
      free_shipping_over: '1000',
      hero_title: 'تشكيلات موضة 2026',
      hero_subtitle: 'تصفح أحدث مجموعات الملابس واختر ما يناسب ذوقك',
      hero_image: '',
      about_text: 'متجر موضة ستايل هو وجهتك الأولى لشراء أحدث صيحات الموضة. نقدم لك ملابس عالية الجودة بأسعار منافسة مع توصيل سريع لجميع المدن.',
      fb_url: '#',
      insta_url: '#',
      tw_url: '#',
    };
    const insS = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(settings)) insS.run(k, v);
  }

  const banCount = db.prepare('SELECT COUNT(*) AS c FROM banners').get().c;
  if (banCount === 0) {
    const insB = db.prepare('INSERT INTO banners (title, subtitle, image, link, active, sort_order) VALUES (?, ?, ?, ?, 1, ?)');
    insB.run('خصومات تصل إلى 50%', 'على جميع التشكيلات الصيفية', '', '/products', 0);
    insB.run('تشكيلة جديدة', 'أحدث ملابس الموضة وصلت', '', '/products', 1);
  }

  const pageCount = db.prepare('SELECT COUNT(*) AS c FROM pages').get().c;
  if (pageCount === 0) {
    const insPg = db.prepare('INSERT INTO pages (slug, title, content, published) VALUES (?, ?, ?, 1)');
    insPg.run('about', 'من نحن', 'متجر موضة ستايل بدأ عام 2020 بهدف تقديم أفضل الملابس لعملائنا. نحن نهتم بالجودة أولاً ونوفر تجربة تسوق سهلة وممتعة.');
    insPg.run('contact', 'اتصل بنا', 'يمكنك التواصل معنا عبر الهاتف أو البريد الإلكتروني أو من خلال نموذج التواصل في الموقع.');
    insPg.run('shipping', 'الشحن والتوصيل', 'نقوم بالتوصيل لجميع المدن خلال 3-5 أيام عمل. الشحن مجاني للطلبات فوق الحد المحدد.');
    insPg.run('returns', 'سياسة الإرجاع', 'يمكنك إرجاع المنتج خلال 14 يوماً من الاستلام بشرط أن يكون بحالته الأصلية مع الفاتورة.');
  }
  console.log('✓ قاعدة البيانات جاهزة');
}

module.exports = { db, hashPassword, verifyPassword, slugify, seed };
