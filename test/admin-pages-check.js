const http = require('http');
const app = require('../server');

const s = app.listen(0, () => {
  const port = s.address().port;
  const base = 'http://127.0.0.1:' + port;

  const get = (path, cookie) => new Promise((resolve, reject) => {
    http.get(base + path, { headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });

  const post = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request(base + path, { method: 'POST', headers }, (res) => {
      const ck = (res.headers['set-cookie'] || [''])[0].split(';')[0];
      resolve(ck);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  (async () => {
    try {
      const cookie = await post('/admin/login', 'email=admin%40store.com&password=admin123', {
        Origin: base, 'Content-Type': 'application/x-www-form-urlencoded',
      });

      const pages = ['/admin', '/admin/orders', '/admin/products', '/admin/categories', '/admin/customers', '/admin/messages', '/admin/pages', '/admin/banners', '/admin/settings', '/admin/profile'];
      for (const p of pages) {
        const r = await get(p, cookie);
        console.log(`${r.status} ${p}`);
      }
      const od = await get('/admin/orders/1', cookie);
      console.log(`${od.status} /admin/orders/1 (تفاصيل الطلب)`);
      s.close(() => process.exit(0));
    } catch (e) {
      console.error('ERROR:', e.message);
      s.close(() => process.exit(1));
    }
  })();
});
