const http = require('http');
const app = require('../server');

function req(host, origin) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: '/admin/login',
      method: 'POST',
      headers: {
        Host: host,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(origin !== undefined ? { Origin: origin } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(res.statusCode + ' | ' + (origin !== undefined ? 'Origin=' + origin + ' ' : 'no-Origin ') + 'Host=' + host + ' | ' + data.trim().slice(0, 60)));
    });
    r.on('error', reject);
    r.write('email=admin%40store.com&password=admin123');
    r.end();
  });
}

const cases = [
  ['localhost:3000', 'http://localhost:3000'],
  ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ['localhost:3000', undefined],
  ['localhost:3000', 'null'],
  ['localhost:3000', 'http://evil.example.com'],
  ['127.0.0.1:3000', 'http://localhost:3000'],
  ['localhost', 'http://localhost:3000'],
  ['LOCALHOST:3000', 'http://localhost:3000'],
];

let server;
server = app.listen(0, async () => {
  PORT = server.address().port;
  for (const [host, origin] of cases) {
    try { console.log(await req(host, origin)); }
    catch (e) { console.log('ERR', host, origin, e.message); }
  }
  server.close(() => process.exit(0));
});
