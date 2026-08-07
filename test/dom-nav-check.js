const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const app = require('../server');

const js = fs.readFileSync(path.join(__dirname, '../public/js/main.js'), 'utf8');

function getHTML(base, pathname, cookie) {
  return new Promise((resolve, reject) => {
    http.get(base + pathname, { headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function postLogin(base) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + '/admin/login', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => {
      const ck = (res.headers['set-cookie'] || [''])[0].split(';')[0];
      resolve(ck);
    });
    req.on('error', reject);
    req.write('email=admin%40store.com&password=admin123');
    req.end();
  });
}

function setup(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(js);
  return { window, document: window.document };
}

const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

(async () => {
  const server = app.listen(0, async () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
      const cookie = await postLogin(base);

      const adminHtml = await getHTML(base, '/admin', cookie);
      const a = setup(adminHtml);
      const sidebar = a.document.getElementById('adminSidebar');
      const adminToggle = a.document.querySelector('[data-admin-toggle]');
      console.log('admin: toggle+sidebar exist:', !!sidebar && !!adminToggle);

      click(a.window, adminToggle);
      console.log('admin: sidebar opens:', sidebar.classList.contains('open'));

      click(a.window, adminToggle);
      console.log('admin: sidebar closes on toggle:', !sidebar.classList.contains('open'));

      click(a.window, adminToggle);
      click(a.window, a.document.body);
      console.log('admin: sidebar closes on outside click:', !sidebar.classList.contains('open'));

      const homeHtml = await getHTML(base, '/', cookie);
      const h = setup(homeHtml);
      const nav = h.document.getElementById('mainNav');
      const navToggle = h.document.querySelector('[data-nav-toggle]');
      const drop = h.document.getElementById('userDrop');
      const dropToggle = h.document.querySelector('[data-toggle-dropdown]');
      console.log('store: nav-toggle + userDrop exist:', !!navToggle && !!nav && !!drop && !!dropToggle);

      click(h.window, navToggle);
      console.log('store: mainNav opens:', nav.classList.contains('open'));

      click(h.window, navToggle);
      console.log('store: mainNav closes:', !nav.classList.contains('open'));

      click(h.window, dropToggle);
      console.log('store: user dropdown opens:', drop.classList.contains('open'));

      click(h.window, a.window ? h.document.body : h.document.body);
      console.log('store: dropdown closes on outside click:', !drop.classList.contains('open'));

      console.log(process.exitCode !== 0 ? '' : 'ALL DOM CHECKS DONE');
      server.close(() => process.exit(0));
    } catch (e) {
      console.error('ERROR:', e.message);
      server.close(() => process.exit(1));
    }
  });
})();
