// Популярность сайтов по открытому рейтингу Tranco (500 тысяч самых посещаемых доменов мира).
// Своей статистики посещений, как у Яндекса и Google, у Horizon нет — рейтинг её заменяет:
// известные сайты выше в выдаче, а по имени («bulldrop») сразу находятся домены в любой зоне.
// Список хранится одной строкой по алфавиту; поиск — двоичный, памяти нужно немного.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const FILE = path.join(__dirname, 'popular-domains.gz');
let text = null;
let starts = null;

function load() {
  if (text !== null) return text.length > 0;
  try {
    text = zlib.gunzipSync(fs.readFileSync(FILE)).toString('latin1');
  } catch {
    text = '';
    return false;
  }
  let count = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  starts = new Uint32Array(count);
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts[n++] = i + 1;
  return true;
}

function lineAt(i) {
  const end = i + 1 < starts.length ? starts[i + 1] - 1 : text.length;
  const line = text.slice(starts[i], end);
  const space = line.indexOf(' ');
  return { domain: line.slice(0, space), rank: parseInt(line.slice(space + 1), 36) };
}

// Первая строка, домен которой не меньше key.
function lowerBound(key) {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lineAt(mid).domain < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Место домена в рейтинге (1 — самый посещаемый) или 0. Поддомен считается по своему сайту:
// music.yandex.ru → yandex.ru.
function rankOf(host) {
  if (!host || !load()) return 0;
  let h = String(host).toLowerCase().replace(/^www\./, '');
  while (h.includes('.')) {
    const i = lowerBound(h);
    if (i < starts.length) {
      const row = lineAt(i);
      if (row.domain === h) return row.rank;
    }
    h = h.slice(h.indexOf('.') + 1);
  }
  return 0;
}

// Домены с таким именем в любой зоне: «bulldrop» → bulldrop.mobi, bulldrop.me… — популярные первыми.
function domainsNamed(name, limit = 8) {
  const label = String(name || '').toLowerCase();
  if (!/^[a-z0-9-]{3,63}$/.test(label) || !load()) return [];
  const out = [];
  for (let i = lowerBound(label + '.'); i < starts.length; i++) {
    const row = lineAt(i);
    if (!row.domain.startsWith(label + '.')) break;
    // Только имя.зона (bulldrop.mobi, caser.com.br), а не чужие поддомены.
    const rest = row.domain.slice(label.length + 1);
    if (rest.split('.').length <= 2) out.push(row);
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

// Очки популярности: топ-10 ≈ 8.5, топ-1000 ≈ 5.5, 50 тысяч ≈ 3, вне рейтинга — 0.
function popularityScore(host) {
  const rank = rankOf(host);
  return rank ? Math.max(0, 10 - 1.5 * Math.log10(rank)) : 0;
}

module.exports = { rankOf, domainsNamed, popularityScore };
