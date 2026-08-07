const express = require('express');
const session = require('express-session');
const path = require('path');
const { seed } = require('./db');
const { verifyPassword, db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

seed();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'clothing-store-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
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

app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const error = !user || user.role !== 'admin' || !verifyPassword(password, user.password_hash)
    ? 'بيانات الدخول غير صحيحة أو لا تملك صلاحية المدير'
    : null;

  if (error) return res.render('admin/login', { title: 'دخول المدير', layout: 'admin', error });

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect('/admin');
});

app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('store/404', { title: 'غير موجود', layout: 'store' });
});

app.listen(PORT, () => {
  console.log('\n✓ المتجر يعمل الآن');
  console.log('  المتجر:   http://localhost:' + PORT);
  console.log('  لوحة التحكم: http://localhost:' + PORT + '/admin/login');
  console.log('  بيانات المدير: admin@store.com / admin123\n');
});
