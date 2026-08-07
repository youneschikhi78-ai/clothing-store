const http = require('http');
const app = require('../server');

const s = app.listen(0, () => {
  const port = s.address().port;
  const opts = {
    host: '127.0.0.1', port, path: '/admin/login', method: 'POST',
    headers: { Origin: 'http://127.0.0.1:' + port, 'Content-Type': 'application/x-www-form-urlencoded' },
  };
  const r = http.request(opts, (res) => {
    const ck = (res.headers['set-cookie'] || [''])[0].split(';')[0];
    http.get({ host: '127.0.0.1', port, path: '/', headers: { Cookie: ck } }, (res2) => {
      let d = '';
      res2.on('data', (c) => (d += c));
      res2.on('end', () => {
        console.log('has toggle btn:', d.includes('data-toggle-dropdown'));
        console.log('has userDrop:', d.includes('id="userDrop"'));
        console.log('has admin link:', d.includes('/admin') && d.includes('لوحة التحكم'));
        console.log('has logout:', d.includes('/logout'));
        console.log('has orders:', d.includes('/orders'));
        s.close(() => process.exit(0));
      });
    });
  });
  r.write('email=admin%40store.com&password=admin123');
  r.end();
});
