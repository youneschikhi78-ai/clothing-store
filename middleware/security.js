function clean(value, maxLength) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  s = s.replace(/[\u0000-\u001F\u007F]/g, '');
  s = s.replace(/<[^>]*>/g, '');
  s = s.trim();
  if (maxLength && s.length > maxLength) s = s.slice(0, maxLength);
  return s;
}

const FIELD_LIMITS = {
  name: 100,
  email: 120,
  password: 128,
  confirm: 128,
  subject: 120,
  city: 60,
  address: 300,
  phone: 20,
  notes: 500,
  message: 2000,
  current_password: 128,
  new_password: 128,
  title: 200,
  slug: 120,
  subtitle: 300,
  link: 300,
  description: 5000,
  content: 20000,
  site_name: 100,
  site_tagline: 200,
  site_phone: 40,
  site_email: 120,
  site_address: 200,
  currency: 20,
  shipping_fee: 20,
  free_shipping_over: 20,
  hero_title: 200,
  hero_subtitle: 300,
  about_text: 5000,
  fb_url: 300,
  insta_url: 300,
  tw_url: 300,
};

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      const v = req.body[key];
      if (typeof v === 'string') {
        req.body[key] = clean(v, FIELD_LIMITS[key] || 5000);
      }
    }
  }
  next();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isValidPhone(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

const ATTEMPTS = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_KEY = 5;
const MAX_ATTEMPTS_PER_IP = 20;
const LOCK_MS = 15 * 60 * 1000;

function loginLimiter(req, res, next) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const ip = req.ip || 'unknown';
  const now = Date.now();

  const getRec = (key) => {
    let rec = ATTEMPTS.get(key);
    if (!rec || now - rec.firstAt > WINDOW_MS) {
      rec = { count: 0, firstAt: now, lockedUntil: 0 };
      ATTEMPTS.set(key, rec);
    }
    return rec;
  };

  const recEmail = getRec(ip + '|' + email);
  const recIp = getRec('ip|' + ip);

  const remaining = (rec) => Math.ceil((rec.lockedUntil - now) / 60000);

  if (recEmail.lockedUntil > now) {
    req.rateLock = remaining(recEmail);
    return next();
  }
  if (recIp.lockedUntil > now) {
    req.rateLock = remaining(recIp);
    return next();
  }

  recEmail.count++;
  recIp.count++;
  if (recEmail.count > MAX_ATTEMPTS_PER_KEY && !recEmail.lockedUntil) recEmail.lockedUntil = now + LOCK_MS;
  if (recIp.count > MAX_ATTEMPTS_PER_IP && !recIp.lockedUntil) recIp.lockedUntil = now + LOCK_MS;

  res.locals.loginKeys = [ip + '|' + email, 'ip|' + ip];
  next();
}

function resetLoginAttempts(res) {
  for (const key of res.locals.loginKeys || []) ATTEMPTS.delete(key);
}

function csrfOriginCheck(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    return next();
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== (req.headers.host || '')) {
        return res.status(403).send('طلب مرفوض: مصدر غير مصرح به');
      }
    } catch (e) {
      return res.status(403).send('طلب مرفوض');
    }
  }
  next();
}

function cleanNumber(value) {
  const n = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  clean,
  sanitizeBody,
  isValidEmail,
  isValidPhone,
  cleanNumber,
  loginLimiter,
  resetLoginAttempts,
  csrfOriginCheck,
};
