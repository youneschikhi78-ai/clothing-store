const http = require('http');
const app = require('../server');

const s = app.listen(0, () => {
  const port = s.address().port;
  const base = 'http://127.0.0.1:' + port;
  const login = http.request(base + '/admin/login', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' },
  }, (res) => {
    const ck = (res.headers['set-cookie'] || [''])[0].split(';')[0];
    http.get(base + '/admin', { headers: { Cookie: ck } }, (res2) => {
      let d = '';
      res2.on('data', (c) => (d += c));
      res2.on('end', () => {
        console.log('admin page 200:', res2.statusCode === 200);
        console.log('admin sidebar id:', d.includes('id="adminSidebar"'));
        console.log('admin toggle btn:', d.includes('data-admin-toggle'));
        console.log('topbar toggle:', d.includes('data-admin-toggle'));
        s.close(() => process.exit(0));
      });
    });
  });
  login.write('email=admin%40store.com&password=admin123');
  login.end();
});
