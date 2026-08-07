const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ quiet: true });

const USE_PG = !!process.env.DATABASE_URL;

let pool = null;
let sqlite = null;

if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  });
} else {
  const { DatabaseSync } = require('node:sqlite');
  sqlite = new DatabaseSync(path.join(__dirname, 'store.db'));
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
}

function toPgSql(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

async function all(sql, params = []) {
  if (pool) {
    const r = await pool.query(toPgSql(sql), params);
    return r.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

async function get(sql, params = []) {
  if (pool) {
    const r = await pool.query(toPgSql(sql), params);
    return r.rows[0];
  }
  return sqlite.prepare(sql).get(...params);
}

async function run(sql, params = []) {
  if (pool) {
    let s = sql;
    if (/^\s*INSERT/i.test(s) && !/RETURNING/i.test(s)) s += ' RETURNING id';
    const r = await pool.query(toPgSql(s), params);
    return { lastInsertRowid: r.rows.length ? r.rows[0].id : null, changes: r.rowCount };
  }
  const info = sqlite.prepare(sql).run(...params);
  return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
}

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  price DOUBLE PRECISION NOT NULL,
  old_price DOUBLE PRECISION DEFAULT NULL,
  image TEXT DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT DEFAULT '',
  total DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS banners (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  image TEXT DEFAULT '',
  link TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT DEFAULT '',
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
`;

const SQLITE_SCHEMA = `
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
`;

async function initSchema() {
  if (pool) {
    await pool.query(PG_SCHEMA);
  } else {
    sqlite.exec(SQLITE_SCHEMA);
    const userCols = sqlite.prepare('PRAGMA table_info(users)').all();
    if (!userCols.some(c => c.name === 'banned')) {
      sqlite.exec('ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0');
      console.log('تمت ترقية قاعدة البيانات (عمود banned)');
    }
    const catCols = sqlite.prepare('PRAGMA table_info(categories)').all();
    if (!catCols.some(c => c.name === 'image')) {
      sqlite.exec("ALTER TABLE categories ADD COLUMN image TEXT DEFAULT ''");
      console.log('تمت ترقية قاعدة البيانات (عمود image للفئات)');
    }
  }
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

async function seed() {
  const userCount = await get('SELECT COUNT(*) AS c FROM users');
  if (userCount.c === 0) {
    await run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      ['مدير المتجر', 'admin@store.com', hashPassword('admin123'), 'admin']);
    console.log('تم إنشاء حساب المدير: admin@store.com / admin123');
  }

  const catCount = await get('SELECT COUNT(*) AS c FROM categories');
  if (catCount.c === 0) {
    const cats = [
      ['رجالي', 'men', 'أزياء رجالية عصرية', ''],
      ['نسائي', 'women', 'أزياء نسائية راقية', ''],
      ['أطفال', 'kids', 'ملابس مريحة للأطفال', ''],
      ['أحذية', 'shoes', 'أحذية بجميع المقاسات', ''],
      ['إكسسوارات', 'accessories', 'أكسسوارات وإضافات مميزة', ''],
    ];
    for (const c of cats) {
      await run('INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)', c);
    }

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
    for (const [name, cat, price, old, stock, feat] of products) {
      await run(
        'INSERT INTO products (name, category_id, description, price, old_price, stock, featured, active, slug) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
        [name, cat, `تشكيلة ${name} عالية الجودة من متجرنا، متوفرة بمقاسات وألوان متعددة.`, price, old, stock, feat, slugify(name)]
      );
    }
    console.log('تم إنشاء البيانات التجريبية (5 فئات، 12 منتج)');
  }

  const setCount = await get('SELECT COUNT(*) AS c FROM settings');
  if (setCount.c === 0) {
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
    for (const [k, v] of Object.entries(settings)) {
      await run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
  }

  const banCount = await get('SELECT COUNT(*) AS c FROM banners');
  if (banCount.c === 0) {
    await run('INSERT INTO banners (title, subtitle, image, link, active, sort_order) VALUES (?, ?, ?, ?, 1, ?)',
      ['خصومات تصل إلى 50%', 'على جميع التشكيلات الصيفية', '', '/products', 0]);
    await run('INSERT INTO banners (title, subtitle, image, link, active, sort_order) VALUES (?, ?, ?, ?, 1, ?)',
      ['تشكيلة جديدة', 'أحدث ملابس الموضة وصلت', '', '/products', 1]);
  }

  const pageCount = await get('SELECT COUNT(*) AS c FROM pages');
  if (pageCount.c === 0) {
    const pages = [
      ['about', 'من نحن', 'متجر موضة ستايل بدأ عام 2020 بهدف تقديم أفضل الملابس لعملائنا. نحن نهتم بالجودة أولاً ونوفر تجربة تسوق سهلة وممتعة.'],
      ['contact', 'اتصل بنا', 'يمكنك التواصل معنا عبر الهاتف أو البريد الإلكتروني أو من خلال نموذج التواصل في الموقع.'],
      ['shipping', 'الشحن والتوصيل', 'نقوم بالتوصيل لجميع المدن خلال 3-5 أيام عمل. الشحن مجاني للطلبات فوق الحد المحدد.'],
      ['returns', 'سياسة الإرجاع', 'يمكنك إرجاع المنتج خلال 14 يوماً من الاستلام بشرط أن يكون بحالته الأصلية مع الفاتورة.'],
    ];
    for (const [slug, title, content] of pages) {
      await run('INSERT INTO pages (slug, title, content, published) VALUES (?, ?, ?, 1)', [slug, title, content]);
    }
  }
  console.log('قاعدة البيانات جاهزة');
}

async function close() {
  if (pool) await pool.end();
  if (sqlite) sqlite.close();
}

module.exports = {
  all, get, run, initSchema, seed, close,
  hashPassword, verifyPassword, slugify,
  USE_PG,
};
