const http = require('http');
const app = require('../server');

const server = http.createServer(app);
let base;
let failures = 0;

function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!cond) failures++;
}

function req(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + path);
    const headers = Object.assign({}, opts.headers);
    if (opts.body && typeof opts.body === 'object') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = new URLSearchParams(opts.body).toString();
    }
    const r = http.request(u, {
      method: opts.method || 'GET',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

(async () => {
  await new Promise((res) => server.listen(0, res));
  base = 'http://127.0.0.1:' + server.address().port;

  const health = await req('/health');
  check('/health -> 200', health.status === 200);

  const home = await req('/');
  check('helmet CSP header', !!home.headers['content-security-policy']);
  check('x-powered-by hidden', !home.headers['x-powered-by']);
  check('helmet X-Content-Type-Options', home.headers['x-content-type-options'] === 'nosniff');
  check('home page renders', /clothing|متجر|store/i.test(home.text));

  const banned = await req('/no-such-page-xyz');
  check('404 -> 404', banned.status === 404);

  const csrf = await req('/admin/login', {
    method: 'POST',
    headers: { Origin: 'https://evil.example.com', Host: '127.0.0.1:' + server.address().port, Cookie: '' },
    body: { email: 'x@x.com', password: 'bad' },
  });
  check('cross-origin POST blocked -> 403', csrf.status === 403);

  const login = await req('/admin/login', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:' + server.address().port },
    body: { email: 'admin@store.com', password: 'admin123' },
  });
  check('admin login works', login.status === 302 && (login.headers.location || '').indexOf('/admin') === 0);

  const reg = await req('/register', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:' + server.address().port },
    body: { name: 'a', email: 'not-an-email', password: '123', confirm: '123' },
  });
  check('invalid register rejected', reg.status === 200 && /قصير|غير صالح|مطلوب/.test(reg.text));

  let locked = false;
  for (let i = 0; i < 7; i++) {
    const r = await req('/admin/login', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:' + server.address().port },
      body: { email: 'attack@test.com', password: 'wrong-' + i },
    });
    if (r.status === 429 || /محاولات دخول كثيرة|بعد/.test(r.text)) locked = true;
  }
  check('brute-force lockout triggered', locked);

  server.close(() => {
    console.log(failures ? '\n' + failures + ' FAILURES' : '\nALL TESTS PASSED');
    process.exit(failures ? 1 : 0);
  });
})().catch((e) => { console.error(e); process.exit(1); });
