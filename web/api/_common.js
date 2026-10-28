// Общее для функций сайта: модули поиска (копируются сборщиком в api/_lib) и ответы.
const { createVerticals, PROTECTION_TITLE } = require('./_lib/search/verticals');
const { createSearchPageData } = require('./_lib/search/page-data');
const search = require('./_lib/search/suggest');
const dns = require('node:dns').promises;

const UA = 'HorizonBrowser/0.2 (https://github.com/Sait5/horizon-browser; horizon web search)';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`Ошибка ${res.status}`);
  return res.json();
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Есть ли сайт по угаданному адресу — то же правило, что в браузере на компьютере:
// отвечает (даже страницей защиты 403/503) — есть; 404, 410, 5xx или тишина — нет.
async function probeSite(url) {
  // Сначала — есть ли домен вообще (через DNS-запрос, а не системный поиск: тот занимает общие потоки
  // и несуществующие домены задерживали бы остальные запросы).
  const host = new URL(url).hostname;
  const exists = await Promise.race([
    Promise.any([dns.resolve4(host), dns.resolve6(host)]).then(() => true, () => false),
    new Promise((r) => setTimeout(() => r(false), 2500)),
  ]);
  if (!exists) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, redirect: 'follow', signal: controller.signal });
    if ([404, 410].includes(res.status) || (res.status >= 500 && res.status !== 503)) return null;
    // Заголовок обычно в начале страницы — дальше не читаем.
    let html = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (html.length < 65536 && !/<\/title>/i.test(html)) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
      }
    } catch {
      // Сайт ответил, но страница долго грузится — он есть, просто без названия.
    }
    reader.cancel().catch(() => {});
    let title = ((/<title[^>]*>([^<]{1,200})<\/title>/i.exec(html) || [])[1] || '').replace(/\s+/g, ' ').trim();
    // Заголовки страниц защиты и ошибок — не название сайта
    if (PROTECTION_TITLE.test(title)) title = '';
    return { url: res.url || url, title };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const verticals = createVerticals(fetchJson, probeSite);
// На сайте нет аккаунтов и возраста, поэтому выдача всегда без материалов 18+.
const searchPageData = createSearchPageData({ verticals, strict: () => true });

// Адреса страниц браузера (horizon://search/…) на сайте — /search/…
function webUrls(value) {
  return JSON.parse(JSON.stringify(value).replace(/horizon:\/\/search\//g, '/search/'));
}

function send(res, status, data, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

const text = (v, max = 300) => String(Array.isArray(v) ? v[0] : v || '').trim().slice(0, max);

module.exports = { search, verticals, searchPageData, webUrls, send, text, UA };
