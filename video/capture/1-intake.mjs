import { open } from './cap.mjs';
import { PERMS, stream, json, TURN1, TURN2 } from './mock.mjs';
import { writeFileSync } from 'node:fs';
const O = process.argv[2]; let n = 0; const store = [];
const { b, page, log } = await open({ api: async (p, req) => {
  if (p === '/api/auth/me') return json({ perms: PERMS, role: 'admin', demoLogin: true });
  if (p === '/api/agent') { n++; return stream(n === 1 ? TURN1 : TURN2); }
  if (p === '/api/fiches' && req.method() === 'GET') return json(store);
  if (p === '/api/fiches' && req.method() === 'POST') { const d = JSON.parse(req.postData()); d.id = d.id || 'f1'; store.push(d); writeFileSync(O + '/doc.json', JSON.stringify(d, null, 1)); return json(d); }
  if (p.startsWith('/api/fiches/')) { console.log('PATCH', req.postData()?.slice(0,200)); return json(store[0] || {}); }
}});
await page.waitForTimeout(1000);
await page.click('#tab-capture'); await page.waitForTimeout(300);
await page.click('button.ex[data-ex="0"]'); await page.waitForTimeout(700);
await page.screenshot({ path: O + '/c1.png' });
await page.click('#suggest button >> nth=0'); await page.waitForTimeout(900);
await page.screenshot({ path: O + '/c2.png' });
await page.getByText('Relire et transmettre').click(); await page.waitForTimeout(500);
await page.check('#valid'); await page.waitForTimeout(200);
await page.screenshot({ path: O + '/review2.png' });
await page.click('#submit'); await page.waitForTimeout(1200);
await page.screenshot({ path: O + '/sent.png' });
console.log([...new Set(log)].join('\n'));
await b.close();
