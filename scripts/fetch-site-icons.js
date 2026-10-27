// Скачивает значки сайтов из каталога в src/assets/site-icons, чтобы плитки и выдача
// показывали чёткие логотипы сразу, даже если сайт не отдаёт значок напрямую.
// Запуск: node scripts/fetch-site-icons.js
const fs = require('node:fs');
const path = require('node:path');
const { SITES } = require('../src/search/catalog');

const OUT = path.join(__dirname, '..', 'src', 'assets', 'site-icons');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const TYPES = { 'image/png': 'png', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

// Запрос целиком (с телом) укладывается в общий таймаут — зависшие сайты не тормозят остальные.
async function get(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow', signal: ctrl.signal });
    const body = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, url: res.url, type: res.headers.get('content-type') || '', body };
  } finally {
    clearTimeout(timer);
  }
}

function hostKey(host) {
  return host.split('/')[0].replace(/^www\./, '');
}

// Ссылки на значки из <head>: apple-touch-icon и icon с размерами; крупные — первыми.
function iconsFromHtml(html, base) {
  const found = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (/\brel=["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
    if (!/icon/i.test(rel) || /mask-icon/i.test(rel)) continue;
    const href = (/\bhref=["']?([^"'\s>]+)/i.exec(tag) || [])[1];
    if (!href) continue;
    const sizes = (/\bsizes=["']?(\d+)x\d+/i.exec(tag) || [])[1];
    let size = sizes ? Number(sizes) : /apple-touch/i.test(rel) ? 180 : 32;
    if (/\.svg(\?|$)/i.test(href)) size = 150;
    try {
      found.push({ url: new URL(href.replace(/&amp;/g, '&'), base).href, size });
    } catch {
      // Битая ссылка — пропускаем.
    }
  }
  return found.sort((a, b) => b.size - a.size);
}

async function fetchIcon(entry) {
  const host = hostKey(entry.host);
  const origin = `https://${entry.host.split('/')[0]}`;
  const candidates = [];
  try {
    const page = await get(origin + '/');
    const html = page.body.toString('utf8').slice(0, 400000);
    candidates.push(...iconsFromHtml(html, page.url || origin));
  } catch {
    // Главная не открылась — пробуем стандартные адреса.
  }
  candidates.push({ url: `${origin}/apple-touch-icon.png`, size: 180 }, { url: `${origin}/favicon.ico`, size: 16 });
  for (const c of candidates) {
    try {
      const res = await get(c.url);
      if (!res.ok) continue;
      const type = res.type.split(';')[0].trim().toLowerCase();
      const ext = TYPES[type] || (/\.ico(\?|$)/i.test(c.url) ? 'ico' : /\.png(\?|$)/i.test(c.url) ? 'png' : null);
      if (!ext) continue;
      const data = res.body;
      if (data.length < 150 || data.length > 400000) continue;
      if (ext === 'svg' && !/<svg/i.test(data.toString('utf8', 0, 2000))) continue;
      return { host, file: `${host}.${ext}`, data };
    } catch {
      // Следующий вариант.
    }
  }
  return { host, file: null };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {};
  const queue = [...new Map(SITES.map((e) => [hostKey(e.host), e])).values()];
  let done = 0;
  const failed = [];
  async function worker() {
    while (queue.length) {
      const entry = queue.shift();
      const existing = fs.readdirSync(OUT).find((f) => f.startsWith(hostKey(entry.host) + '.') && f !== 'manifest.json');
      const result = existing ? { host: hostKey(entry.host), file: existing, data: fs.readFileSync(path.join(OUT, existing)) } : await fetchIcon(entry);
      done++;
      if (result.file) {
        fs.writeFileSync(path.join(OUT, result.file), result.data);
        manifest[result.host] = result.file;
      } else failed.push(result.host);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`Значков: ${Object.keys(manifest).length} из ${done}. Не удалось: ${failed.join(', ') || 'нет'}`);
})();
