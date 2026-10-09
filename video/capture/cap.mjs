// Sert intake-agent/public (après `node build.mjs`) et simule l'API /api/* pour photographier la vraie interface.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const PUB = new URL('../../intake-agent/public/', import.meta.url).pathname;
const log = [];
const types = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript', '.webmanifest': 'application/json', '.css': 'text/css' };
export async function open(script) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'fr-FR', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
  await page.route('https://app.local/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
    if (p.startsWith('/api/')) {
      const h = script.api && await script.api(p, req, url);
      log.push(req.method() + ' ' + p);
      if (h) return route.fulfill(h);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    const f = join(PUB, p === '/' ? 'index.html' : p);
    if (existsSync(f)) return route.fulfill({ status: 200, contentType: types[extname(f)] || 'application/octet-stream', body: readFileSync(f) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://app.local/');
  return { b, page, log };
}
