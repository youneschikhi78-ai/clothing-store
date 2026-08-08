const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toEnglishDigits(value) {
  let s = String(value);
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  return s;
}

function clean(value, maxLength) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  s = s.replace(/[\u0000-\u001F\u007F]/g, '');
  s = s.replace(/<[^>]*>/g, '');
  s = toEnglishDigits(s);
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
  const digits = toEnglishDigits(phone || '').replace(/[^0-9]/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

const ATTEMPTS = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_KEY = 5;
const MAX_ATTEMPTS_PER_IP = 20;
const LOCK_MS_SHORT = 5 * 60 * 1000;
const LOCK_MS_LONG = 15 * 60 * 1000;

function loginLimiter(req, res, next) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const ip = req.ip || 'unknown';
  const now = Date.now();

  const getRec = (key) => {
    let rec = ATTEMPTS.get(key);
    if (!rec || (rec.lockedUntil <= now && now - rec.firstAt > WINDOW_MS)) {
      rec = { count: 0, firstAt: now, lockedUntil: 0, lockStage: rec ? rec.lockStage : 0 };
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

  const lockIfExceeded = (rec, max) => {
    rec.count++;
    if (rec.count > max && rec.lockedUntil <= now) {
      const duration = (rec.lockStage || 0) === 0 ? LOCK_MS_SHORT : LOCK_MS_LONG;
      rec.lockedUntil = now + duration;
      rec.lockStage = (rec.lockStage || 0) + 1;
      if (!req.rateLock) req.rateLock = Math.ceil(duration / 60000);
    }
  };
  lockIfExceeded(recEmail, MAX_ATTEMPTS_PER_KEY);
  lockIfExceeded(recIp, MAX_ATTEMPTS_PER_IP);

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
  if (!origin || origin === 'null') return next();

  let o;
  try { o = new URL(origin); } catch (e) { return res.status(403).send('طلب مرفوض'); }

  const originHost = o.hostname.toLowerCase().replace(/\.$/, '');
  const reqHostname = (req.hostname || '').toLowerCase().replace(/\.$/, '');
  if (originHost !== reqHostname) {
    return res.status(403).send('طلب مرفوض: مصدر غير مصرح به');
  }

  if (o.port) {
    const hostHeader = String(req.headers.host || '');
    let hostPort = '';
    if (hostHeader.includes('[')) {
      const m = hostHeader.match(/]:(\d+)/);
      hostPort = m ? m[1] : '';
    } else {
      const idx = hostHeader.lastIndexOf(':');
      hostPort = idx === -1 ? '' : hostHeader.slice(idx + 1);
    }
    if (hostPort && o.port !== hostPort) {
      return res.status(403).send('طلب مرفوض: مصدر غير مصرح به');
    }
  }
  next();
}

function cleanNumber(value) {
  const n = parseFloat(toEnglishDigits(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  clean,
  sanitizeBody,
  isValidEmail,
  isValidPhone,
  cleanNumber,
  toEnglishDigits,
  loginLimiter,
  resetLoginAttempts,
  csrfOriginCheck,
};
