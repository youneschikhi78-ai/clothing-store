const http = require('http');
const app = require('../server');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const BIG = Buffer.alloc(4 * 1024 * 1024 + 100, 0);

function multipart(fields, file, fileCtype) {
  const boundary = '----testboundary' + Date.now();
  const parts = [Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="name"\r\n\r\n' + (fields.name || 'x') + '\r\n')];
  if (fields.extra) {
    for (const [k, v] of Object.entries(fields.extra)) {
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
    }
  }
  if (file) {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="t.bin"\r\nContent-Type: ' + (fileCtype || 'image/png') + '\r\n\r\n'));
    parts.push(file);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  return { body: Buffer.concat(parts), boundary };
}

let base, cookie;
function req(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + path);
    const headers = Object.assign({}, opts.headers);
    if (cookie) headers.Cookie = cookie;
    if (opts.follow) headers['X-No-Follow'] = '1';
    if (opts.body && typeof opts.body === 'object' && !Buffer.isBuffer(opts.body)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = new URLSearchParams(opts.body).toString();
    }
    const r = http.request(u, { method: opts.method || 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function uploadCase(label, url, file, ctype, opts = {}) {
  const name = opts.name || (label + ' ' + Date.now());
  const extra = Object.assign({}, opts.extra || {});
  if (opts.isProduct) Object.assign(extra, { price: '50', stock: '10' });
  const mb = multipart({ name, extra }, file, ctype);
  const r = await req(url, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:' + base.replace('http://127.0.0.1:', ''), 'Content-Type': 'multipart/form-data; boundary=' + mb.boundary },
    body: mb.body,
  });
  const loc = r.headers.location || '';
  let followed = null;
  if (r.status === 302 && loc) {
    followed = await req(loc);
  }
  const ok = r.status === 302 && followed && followed.status === 200;
  console.log((ok ? 'PASS' : 'FAIL') + ' - ' + label + ' -> POST ' + r.status + (loc ? ' -> GET ' + loc + ' -> ' + (followed ? followed.status : '?') : ''));
  return ok;
}

(async () => {
  const server = app.listen(0, async () => {
    try {
      base = 'http://127.0.0.1:' + server.address().port;
      const login = await req('/admin/login', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: { email: 'admin@store.com', password: 'admin123' },
      });
      cookie = (login.headers['set-cookie'] || [''])[0].split(';')[0];

      const results = [];
      const stamp = Date.now();
      results.push(await uploadCase('product new valid', '/admin/products/new', PNG, 'image/png', { isProduct: true, name: 'منتج اختبار ' + stamp }));
      results.push(await uploadCase('product new oversized', '/admin/products/new', BIG, 'image/png', { isProduct: true, name: 'منتج ضخم ' + stamp }));
      results.push(await uploadCase('product new wrong-format', '/admin/products/new', PNG, 'text/plain', { isProduct: true, name: 'منتج صيغة ' + stamp }));
      results.push(await uploadCase('product edit valid', '/admin/products/1/edit', PNG, 'image/png', { isProduct: true, name: 'قميص قطني رجالي' }));
      results.push(await uploadCase('banner valid', '/admin/banners', PNG, 'image/png', { name: 'بانر ' + stamp, extra: { title: 'بانر ' + stamp } }));
      results.push(await uploadCase('category create valid', '/admin/categories', PNG, 'image/png', { name: 'فئة اختبار ' + stamp }));
      results.push(await uploadCase('category edit valid', '/admin/categories/1/edit', PNG, 'image/png', { name: 'رجالي' }));

      server.close(() => {
        console.log(results.every(Boolean) ? '\nALL UPLOAD FLOWS OK' : '\nSOME UPLOAD FLOWS FAILED');
        process.exit(results.every(Boolean) ? 0 : 1);
      });
    } catch (e) { console.error(e); process.exit(1); }
  });
})();
