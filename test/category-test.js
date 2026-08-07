const http = require('http');
const app = require('../server');
const db = require('../db');

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!cond) failures++;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function multipart(fields, file) {
  const boundary = '----testboundary' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
  }
  if (file) {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="cat.png"\r\nContent-Type: image/png\r\n\r\n'));
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

(async () => {
  const server = app.listen(0, async () => {
    try {
      base = 'http://127.0.0.1:' + server.address().port;

      const login = await req('/admin/login', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:' + server.address().port, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: { email: 'admin@store.com', password: 'admin123' },
      });
      cookie = (login.headers['set-cookie'] || [''])[0].split(';')[0];
      check('admin login', !!cookie && login.status === 302);

      const list = await req('/admin/categories');
      check('categories page has edit buttons', list.text.includes('/admin/categories/1/edit'));
      check('categories page has image column', list.text.includes('الصورة'));

      const form = await req('/admin/categories/1/edit');
      check('edit category page renders', form.status === 200 && form.text.includes('تعديل فئة'));

      await req('/admin/categories/1/edit', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:' + server.address().port },
        body: { name: 'رجالي', description: 'أزياء رجالية عصرية', remove_image: 'on' },
      });
      const home1 = await req('/');
      check('category with no image shows no img', !home1.text.includes('alt="رجالي"'));

      const mb = multipart({ name: 'رجالي', description: 'أزياء رجالية عصرية' }, PNG);
      const up = await req('/admin/categories/1/edit', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:' + server.address().port, 'Content-Type': 'multipart/form-data; boundary=' + mb.boundary },
        body: mb.body,
      });
      check('image upload accepted', up.status === 302);

      const home2 = await req('/');
      check('category with image shows img', home2.text.includes('alt="رجالي"') && home2.text.includes('/uploads/'));

      await db.run('UPDATE categories SET image = ? WHERE id = 1', ['']);
      console.log(failures ? '\n' + failures + ' FAILURES' : '\nALL TESTS PASSED');
      server.close(() => process.exit(failures ? 1 : 0));
    } catch (e) { console.error(e); process.exit(1); }
  });
})();
