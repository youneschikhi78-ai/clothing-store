const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config({ quiet: true });
const db = require('./db');
const { verifyPassword } = require('./db');
const { sanitizeBody, isValidEmail, loginLimiter, resetLoginAttempts, csrfOriginCheck } = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3000;

const ready = db.initSchema().then(() => db.seed());

app.use(async (req, res, next) => {
  try { await ready; next(); } catch (e) { next(e); }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.use(csrfOriginCheck);
app.use(sanitizeBody);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/__ip', (req, res) => {
  res.json({ ip: req.ip, xff: req.headers['x-forwarded-for'] || null, remote: req.socket && req.socket.remoteAddress });
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'clothing-store-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: app.get('env') === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use((req, res, next) => {
  res.locals.layout = 'store';
  next();
});

app.use('/', require('./routes/store'));
app.use('/', require('./routes/auth'));

/* ---- دخول المدير ---- */
app.get('/admin/login', (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') return res.redirect('/admin');
  res.render('admin/login', { title: 'دخول المدير', layout: 'admin', error: null });
});

app.post('/admin/login', loginLimiter, async (req, res, next) => {
  if (req.rateLock) {
    return res.render('admin/login', {
      title: 'دخول المدير',
      layout: 'admin',
      error: `محاولات دخول كثيرة. جرب مرة أخرى بعد ${req.rateLock} دقيقة.`,
    });
  }

  const { email, password } = req.body;
  let user;
  try {
    user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  } catch (e) { return next(e); }
  const error = !user || user.role !== 'admin' || !verifyPassword(password, user.password_hash)
    ? 'بيانات الدخول غير صحيحة أو لا تملك صلاحية المدير'
    : null;

  if (error) return res.render('admin/login', { title: 'دخول المدير', layout: 'admin', error });

  resetLoginAttempts(res);
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect('/admin');
});

app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('store/404', { title: 'غير موجود', layout: 'store' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[Error]', req.method, req.originalUrl, '-', err.message);
  res.status(500).render('store/500', {
    title: 'خطأ في الخادم',
    layout: 'store',
  });
});

if (require.main === module) {
  ready.then(() => {
    app.listen(PORT, () => {
      console.log('\nالمتجر يعمل الآن');
      console.log('  المتجر:   http://localhost:' + PORT);
      console.log('  لوحة التحكم: http://localhost:' + PORT + '/admin/login');
      console.log('  بيانات المدير: admin@store.com / admin123');
      console.log('  قاعدة البيانات: ' + (db.USE_PG ? 'PostgreSQL (Supabase)' : 'SQLite محلي') + '\n');
    });
  }).catch((e) => {
    console.error('فشل تهيئة قاعدة البيانات:', e.message);
    process.exit(1);
  });
}

module.exports = app;
