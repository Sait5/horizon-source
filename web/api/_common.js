// Общее для функций сайта: модули поиска (копируются сборщиком в api/_lib) и ответы.
const { createVerticals } = require('./_lib/search/verticals');
const { createSearchPageData } = require('./_lib/search/page-data');
const search = require('./_lib/search/suggest');

const UA = 'HorizonBrowser/0.2 (https://github.com/Sait5/horizon-browser; horizon web search)';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`Ошибка ${res.status}`);
  return res.json();
}

const verticals = createVerticals(fetchJson);
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
