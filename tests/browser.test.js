// Real-browser smoke test (headless Chrome via puppeteer-core). Usage: node tests/browser.test.js
const puppeteer = require('puppeteer-core'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const u = q.url.split('?')[0], p = path.join(ROOT, u === '/' ? 'index.html' : u); if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => srv.listen(0, r)); const url = 'http://localhost:' + srv.address().port + '/';
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const errs = []; const pg = await br.newPage(); await pg.setViewport({ width: 420, height: 860 });
  pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); pg.on('dialog', (d) => d.accept());
  let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' - ' + m);
  await pg.goto(url); await pg.evaluate(() => localStorage.clear());
  // hostile stored data must not brick the app
  await pg.evaluate(() => localStorage.setItem('ta7seel.v1', JSON.stringify({ settings: { logoImage: 'x"><img src=x onerror=window.__xss=1>', accent: 'red' }, clients: [null, { id: 'a', name: 5 }, { id: 'c', name: 'Ali', phone: '01001234567' }], invoices: [{ id: 'i', clientId: 'c', amount: 'x' }, { id: 'j', clientId: 'c', amount: 900, issueDate: '2026-01-01', dueDate: '2026-01-10' }], reminders: 7 })));
  const key = await pg.evaluate(() => { const ks = Object.keys(localStorage); return ks[0]; });
  await pg.reload(); await sleep(600);
  assert.equal(await pg.evaluate(() => window.__xss), undefined); ok('hostile stored state: no crash, no script injection');
  assert.ok((await pg.evaluate(() => document.body.innerText)).length > 50); ok('app renders after cleaning');
  assert.deepEqual(errs, []); ok('no console errors');
  // sample data, reminders page, WhatsApp link with country code
  await pg.evaluate(() => localStorage.clear()); await pg.goto(url + '#/settings'); await pg.reload(); await sleep(400);
  await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => /sample|تجريبية/i.test(b.textContent)).click()); await sleep(500);
  await pg.goto(url + '#/reminders'); await sleep(600);
  const hrefs = await pg.evaluate(() => [...document.querySelectorAll('a[href^="https://wa.me/"]')].map((a) => a.href));
  assert.ok(hrefs.length > 0, 'wa links exist'); assert.ok(hrefs.every((h) => /^https:\/\/wa\.me\/20\d{9,11}\?text=/.test(h)), hrefs[0]); ok('WhatsApp links carry the country code');
  assert.deepEqual(errs, []); ok('no console errors after sample flows');
  await br.close(); srv.close(); console.log('PASSED ' + n);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
