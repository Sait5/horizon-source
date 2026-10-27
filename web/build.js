// Сборка сайта-приложения Horizon из страниц браузера: node web/build.js
// Страницы и поиск — те же, что в браузере на компьютере; меняются только адреса и раскладка под телефон.
const fs = require('node:fs');
const path = require('node:path');

const WEB = __dirname;
const SRC = path.join(WEB, '..', 'src');
const PUB = path.join(WEB, 'public');
const LIB = path.join(WEB, 'api', '_lib');

fs.rmSync(PUB, { recursive: true, force: true });
fs.rmSync(LIB, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(from, to, { recursive: true });
const edit = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`${path.basename(file)}: нет «${a.slice(0, 60)}»`);
    s = s.split(a).join(b);
  }
  fs.writeFileSync(file, s);
};

// Страницы
copy(path.join(SRC, 'pages', 'start'), PUB);
copy(path.join(SRC, 'pages', 'search'), path.join(PUB, 'search'));
copy(path.join(WEB, 'static'), PUB);

const HEAD = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0e1116">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Horizon">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <link rel="icon" href="/icons/icon-192.png">
  <meta charset="utf-8">`;
const SCRIPTS = '<script src="/web-shim.js"></script>\n  <script src="/site-icons.js"></script>\n  ';
const ICON = "(window.SITE_ICONS && SITE_ICONS[host] ? `/site-icon/${SITE_ICONS[host]}` : '')";

edit(path.join(PUB, 'index.html'), [
  ['<meta charset="utf-8">', HEAD],
  ['<link rel="stylesheet" href="start.css">', '<link rel="stylesheet" href="/start.css">\n  <link rel="stylesheet" href="/mobile.css">'],
  ['<script src="start.js"></script>', SCRIPTS + '<script src="/start.js"></script>'],
]);
edit(path.join(PUB, 'search', 'index.html'), [
  ['<meta charset="utf-8">', HEAD],
  ['<link rel="stylesheet" href="search.css">', '<link rel="stylesheet" href="/search/search.css">\n  <link rel="stylesheet" href="/mobile.css">'],
  ['href="horizon://start/"', 'href="/"'],
  ['<script src="viewer.js"></script>', SCRIPTS + '<script src="/search/viewer.js"></script>'],
  ['<script src="search.js"></script>', '<script src="/search/search.js"></script>'],
]);
edit(path.join(PUB, 'start.js'), [
  ['`/site-icon/${host}`', ICON],
  ['if (reduceMotion) src = null;', 'if (reduceMotion || window.HORIZON_SAVE_DATA) src = null;'],
]);
edit(path.join(PUB, 'search', 'search.js'), [
  ['`/site-icon/${host}`', ICON],
  ["url.startsWith('horizon://search/')", "url.startsWith('/search/')"],
]);

// Обои и волны «Восхода»
fs.mkdirSync(path.join(PUB, 'builtin'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'assets', 'wallpaper-sunrise.jpg'), path.join(PUB, 'builtin', 'sunrise.jpg'));
fs.copyFileSync(path.join(SRC, 'assets', 'waves-sunrise.mp4'), path.join(PUB, 'builtin', 'sunrise.mp4'));

// Значки сайтов
const iconsDir = path.join(SRC, 'assets', 'site-icons');
const manifest = JSON.parse(fs.readFileSync(path.join(iconsDir, 'manifest.json'), 'utf8'));
copy(iconsDir, path.join(PUB, 'site-icon'));
fs.rmSync(path.join(PUB, 'site-icon', 'manifest.json'));
fs.writeFileSync(path.join(PUB, 'site-icons.js'), `window.SITE_ICONS = ${JSON.stringify(manifest)};\n`);

// Оформление по умолчанию — как у браузера
const themes = require(path.join(SRC, 'themes.js'));
const appearance = themes.DEFAULT_APPEARANCE;
fs.writeFileSync(path.join(PUB, 'default-state.json'), JSON.stringify({ appearance, palette: themes.palette(appearance), gradients: themes.GRADIENTS, bookmarks: [], userName: null, key: '', introActive: false }));

// Модули поиска для серверных функций
fs.mkdirSync(path.join(LIB, 'search'), { recursive: true });
for (const f of ['catalog.js', 'suggest.js', 'descriptions.js', 'verticals.js', 'page-data.js']) fs.copyFileSync(path.join(SRC, 'search', f), path.join(LIB, 'search', f));
fs.copyFileSync(path.join(SRC, 'safety.js'), path.join(LIB, 'safety.js'));

console.log('Сайт собран в web/public');
