// Список популярных доменов для поиска: из открытого рейтинга Tranco (tranco-list.eu, бесплатно).
// Скачайте top-1m.csv.zip, распакуйте и запустите: node scripts/build-popular.js путь/к/top-1m.csv
// Получится src/search/popular-domains.gz — 500 тысяч самых посещаемых доменов с их местом в рейтинге.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const LIMIT = 500000;
const source = process.argv[2];
if (!source) {
  console.error('Укажите путь к top-1m.csv');
  process.exit(1);
}
const rows = [];
for (const line of fs.readFileSync(source, 'latin1').split(/\r?\n/)) {
  const comma = line.indexOf(',');
  if (comma < 0) continue;
  const rank = Number(line.slice(0, comma));
  const domain = line.slice(comma + 1).trim().toLowerCase();
  if (!rank || rank > LIMIT || !/^[a-z0-9.-]+$/.test(domain)) continue;
  rows.push([domain, rank]);
}
// По алфавиту: так в браузере домен и все домены с одним именем (bulldrop.*) ищутся двоичным поиском.
rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const text = rows.map(([d, r]) => `${d} ${r.toString(36)}`).join('\n');
const out = path.join(__dirname, '..', 'src', 'search', 'popular-domains.gz');
fs.writeFileSync(out, zlib.gzipSync(text, { level: 9 }));
console.log(`Готово: ${rows.length} доменов, ${(fs.statSync(out).size / 1048576).toFixed(1)} МБ`);
