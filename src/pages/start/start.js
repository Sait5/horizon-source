const bgEl = document.getElementById('bg');
const dimEl = document.getElementById('dim');
const clockEl = document.getElementById('clock');
const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const tilesEl = document.getElementById('tiles');
const queryEl = document.getElementById('query');
const dialog = document.getElementById('dialog');
const addUrl = document.getElementById('addUrl');
const addError = document.getElementById('addError');

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

let state = null;
let loadedOnce = false;
const greetingEl = document.getElementById('greeting');

function tick() {
  const now = new Date();
  timeEl.textContent = timeFormat.format(now);
  dateEl.textContent = dateFormat.format(now);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function post(action, body = {}) {
  return fetch(`/action/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Horizon-Key': (state && state.key) || '' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function applyAppearance() {
  const { appearance: a, palette: p, gradients } = state;
  const root = document.documentElement.style;
  root.setProperty('--accent', p.accent);
  root.setProperty('--accent-ink', p.accentInk);
  root.setProperty('--r', `${a.radius}px`);
  root.setProperty('--panel', p.panel);
  root.setProperty('--panel-text', p.text);
  root.setProperty('--panel-line', p.line);
  root.setProperty('--field', p.field);

  // Смена фона — плавным переходом: старый фон растворяется поверх нового.
  if (bgEl.style.background || bgEl.style.backgroundImage) {
    const ghost = bgEl.cloneNode();
    ghost.removeAttribute('id');
    ghost.classList.add('bg-layer');
    bgEl.after(ghost);
    requestAnimationFrame(() => requestAnimationFrame(() => (ghost.style.opacity = '0')));
    setTimeout(() => ghost.remove(), 700);
  }

  const bg = a.background;
  let onLight = false;
  bgEl.style.backgroundImage = '';
  if (bg.type === 'gradient') {
    bgEl.style.background = gradients[bg.value].css;
  } else if (bg.type === 'color') {
    bgEl.style.background = bg.value;
    onLight = luminance(bg.value) > 0.45 && a.dim < 0.3;
  } else if (bg.type === 'builtin') {
    bgEl.style.background = '#0b0a14';
    bgEl.style.backgroundImage = `url("/builtin/${encodeURIComponent(bg.value)}.jpg")`;
    bgEl.style.backgroundSize = 'cover';
    bgEl.style.backgroundPosition = 'center';
  } else if (bg.type === 'image') {
    bgEl.style.background = '#000';
    bgEl.style.backgroundImage = `url("/bg/${encodeURIComponent(bg.value)}?v=${bg.version || 0}")`;
    bgEl.style.backgroundSize = 'cover';
    bgEl.style.backgroundPosition = 'center';
  } else {
    bgEl.style.background = p.bg;
    onLight = p.light;
  }
  // Затемнение и размытие нужны картинкам и градиентам; ровный фон темы остаётся как есть.
  const plain = bg.type === 'theme';
  bgEl.classList.toggle('blurred', !plain && a.blur > 0);
  bgEl.style.filter = !plain && a.blur > 0 ? `blur(${a.blur}px)` : '';
  dimEl.style.background = plain ? 'none' : `rgba(0, 0, 0, ${a.dim})`;
  document.body.classList.toggle('on-light', onLight);
  // Обои из заставки: меню раскладывается вокруг светящегося значка на горизонте.
  document.body.classList.toggle('scene-sunrise', bg.type === 'builtin' && bg.value === 'sunrise');
  setLive(bg.type === 'builtin' ? `/builtin/${encodeURIComponent(bg.value)}.mp4` : null);
  renderGreeting();
  clockEl.hidden = !a.showClock;
  tilesEl.hidden = !a.showTiles;
}

function icon(paths) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24">${paths}</svg>`;
  return t.content.firstChild;
}

// Значок сайта: сначала крупный (apple-touch-icon), потом обычный favicon, иначе — первая буква.
function siteIcon(box, url, favicon) {
  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  const host = new URL(origin).hostname.replace(/^www\./, '');
  const candidates = [`/site-icon/${host}`, `${origin}/apple-touch-icon.png`, favicon, `${origin}/favicon.ico`].filter(Boolean);
  const tryNext = () => {
    const src = candidates.shift();
    if (!src) return;
    const img = new Image();
    img.alt = '';
    // Встроенные значки (бывают в SVG без размеров) принимаем сразу.
    img.onload = () => (img.naturalWidth > 8 || src.startsWith('/site-icon/') ? box.replaceChildren(img) : tryNext());
    img.onerror = tryNext;
    img.src = src;
  };
  tryNext();
}

let justAdded = new Set();

function tile(bookmark, index) {
  const link = document.createElement('a');
  link.className = 'tile' + (justAdded.has(bookmark.url.replace(/\/$/, '')) ? ' fresh' : '');
  link.style.setProperty('--i', String(Math.min(index, 20)));
  link.href = bookmark.url;
  link.title = `${bookmark.title}\n${bookmark.url}`;

  const box = document.createElement('span');
  box.className = 'tile-icon';
  box.textContent = (bookmark.title || hostOf(bookmark.url)).charAt(0).toUpperCase();
  siteIcon(box, bookmark.url, bookmark.favicon);

  const title = document.createElement('span');
  title.className = 'tile-title';
  title.textContent = bookmark.title;

  const remove = document.createElement('button');
  remove.className = 'tile-remove';
  remove.title = 'Убрать плитку';
  remove.append(icon('<path d="M6 6l12 12M18 6L6 18" />'));
  remove.addEventListener('click', async (event) => {
    event.preventDefault();
    await post('bookmark-remove', { id: bookmark.id });
    load();
  });

  link.append(box, title, remove);
  return link;
}

function renderTiles() {
  const add = document.createElement('button');
  add.className = 'tile add';
  add.type = 'button';
  add.innerHTML = '<span class="tile-icon"></span><span class="tile-title">Добавить</span>';
  add.querySelector('.tile-icon').append(icon('<path d="M12 5v14M5 12h14" />'));
  add.addEventListener('click', openDialog);

  const items = state.bookmarks.map((b, i) => tile(b, i));
  add.style.setProperty('--i', String(Math.min(items.length, 20)));
  const hint = state.bookmarks.length
    ? null
    : Object.assign(document.createElement('p'), {
        className: 'hint',
        textContent: 'Сохраняйте сайты звёздочкой в адресной строке — они появятся здесь плитками.',
      });
  tilesEl.replaceChildren(...items, add, ...(hint ? [hint] : []));
}

// ---------- Живые обои: волны «Восхода» ----------
// Два видео сменяют друг друга с плавной склейкой, чтобы волны шли без остановки.
// Пока вкладка скрыта, видео на паузе — компьютер не нагружается.
const live = [document.getElementById('liveA'), document.getElementById('liveB')];
let liveIndex = 0;
let liveSrc = null;
let liveSwapping = false;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function setLive(src) {
  if (reduceMotion) src = null;
  if (src === liveSrc) return;
  liveSrc = src;
  for (const v of live) {
    v.pause();
    v.classList.remove('on');
    if (src) v.src = src;
    else v.removeAttribute('src');
  }
  document.body.classList.toggle('live-on', Boolean(src));
  if (src && !document.body.classList.contains('waiting')) startLive();
}

// Видна ли вкладка, сообщает сам браузер (событие horizon-shown); до этого — по document.hidden.
let pageShown = !document.hidden;

function startLive() {
  if (!liveSrc || !pageShown || document.body.classList.contains('waiting')) return;
  const v = live[liveIndex];
  v.play().then(() => v.classList.add('on')).catch(() => {});
}

for (const v of live) {
  v.addEventListener('timeupdate', () => {
    if (v !== live[liveIndex] || liveSwapping || !v.duration) return;
    if (v.duration - v.currentTime < 1.4) {
      liveSwapping = true;
      const next = live[1 - liveIndex];
      next.currentTime = 0;
      next.play().then(() => {
        next.classList.add('on', 'front');
        setTimeout(() => {
          v.classList.remove('on');
          next.classList.remove('front');
          v.pause();
          liveIndex = 1 - liveIndex;
          liveSwapping = false;
        }, 1300);
      }).catch(() => (liveSwapping = false));
    }
  });
}

function pauseLive() {
  live.forEach((v) => v.pause());
}

// Свёрнутое окно — пауза; развернули — волны идут дальше.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseLive();
  else if (pageShown) startLive();
});
window.addEventListener('horizon-shown', () => {
  pageShown = true;
  startLive();
});
window.addEventListener('horizon-hidden', () => {
  pageShown = false;
  pauseLive();
});
// Страховка: если волны почему-то встали на видимой странице — запускаем снова.
setInterval(() => {
  if (pageShown && !document.hidden && !liveSwapping && live[liveIndex].paused) startLive();
}, 2000);
function renderGreeting() {
  const hour = new Date().getHours();
  const base = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  greetingEl.textContent = state && state.userName ? `, ${state.userName.split(' ')[0]}` : base;
}

// Пока идёт заставка, меню спрятано; когда она растворяется — выплывает поверх тех же обоев.
function reveal() {
  document.body.classList.remove('waiting');
  startLive();
  document.body.classList.remove('revealing');
  void document.body.offsetWidth;
  document.body.classList.add('revealing');
}

async function load() {
  state = await (await fetch('/state.json', { cache: 'no-store' })).json();
  if (state.introActive && !loadedOnce) document.body.classList.add('waiting');
  loadedOnce = true;
  applyAppearance();
  renderTiles();
}

// ---------- Окно «Добавить сайты»: можно отметить сразу несколько ----------

const pickGrid = document.getElementById('pickGrid');
const pickSearch = document.getElementById('pickSearch');
const addSubmit = document.getElementById('addSubmit');
const picked = new Map();
let pickSeq = 0;

function savedUrls() {
  return new Set(state.bookmarks.map((b) => b.url.replace(/\/$/, '')));
}

const addTitle = document.getElementById('addTitle');
const linkPreview = document.getElementById('linkPreview');
let pickMode = 'sites';

// Адрес из поля: «youtube.com/@канал» → https://youtube.com/@канал; не адрес — null.
function normalizeLink(text) {
  let value = String(text || '').trim();
  if (!value || /\s/.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) {
    if (!/^[^/]+\.[a-zа-яё]{2,}(:\d+)?(\/.*)?$/i.test(value)) return null;
    value = 'https://' + value;
  }
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function linkTitle(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  let path = u.pathname.replace(/\/$/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // Оставляем как есть.
  }
  return path && path.length < 30 ? host + path : host;
}

function updateSubmit() {
  const own = pickMode === 'link' && normalizeLink(addUrl.value) ? 1 : 0;
  const count = (pickMode === 'sites' ? picked.size : 0) + own;
  addSubmit.textContent = count > 1 ? `Добавить (${count})` : 'Добавить';
  addSubmit.disabled = !count;
}

function setPickMode(mode) {
  pickMode = mode;
  document.querySelectorAll('.pick-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('paneSites').hidden = mode !== 'sites';
  document.getElementById('addForm').hidden = mode !== 'link';
  addError.textContent = '';
  updateSubmit();
  (mode === 'link' ? addUrl : pickSearch).focus();
}

function updateLinkPreview() {
  const url = normalizeLink(addUrl.value);
  linkPreview.hidden = !url;
  if (url) {
    const box = document.getElementById('linkIcon');
    const name = addTitle.value.trim() || linkTitle(url);
    box.textContent = name.charAt(0).toUpperCase();
    siteIcon(box, url);
    document.getElementById('linkName').textContent = name;
    document.getElementById('linkHost').textContent = url;
  }
  addError.textContent = addUrl.value.trim() && !url ? 'Это не похоже на ссылку. Пример: youtube.com/@канал' : '';
  updateSubmit();
}

function pickCard(site, saved, index) {
  const already = saved.has(site.url.replace(/\/$/, ''));
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'pick' + (picked.has(site.url) ? ' selected' : '') + (already ? ' saved' : '') + (site.link ? ' link' : '');
  item.style.setProperty('--i', String(Math.min(index, 24)));
  item.disabled = already;
  item.title = already ? 'Уже на главной' : site.url;
  const box = document.createElement('span');
  box.className = 'pick-icon';
  box.textContent = site.name.charAt(0).toUpperCase();
  siteIcon(box, site.url);
  const name = Object.assign(document.createElement('span'), { className: 'pick-name', textContent: site.name });
  const mark = Object.assign(document.createElement('span'), { className: 'pick-mark', textContent: already ? '✓' : '' });
  item.append(box, name, mark);
  if (site.link) item.append(Object.assign(document.createElement('span'), { className: 'pick-sub', textContent: 'Ваша ссылка' }));
  item.addEventListener('click', () => {
    if (picked.has(site.url)) picked.delete(site.url);
    else picked.set(site.url, site.link ? '' : site.name);
    item.classList.toggle('selected', picked.has(site.url));
    item.classList.remove('pop');
    void item.offsetWidth;
    item.classList.add('pop');
    updateSubmit();
  });
  return item;
}

async function renderPicker() {
  const seq = ++pickSeq;
  const text = pickSearch.value.trim();
  const link = normalizeLink(text);
  // Вставили ссылку прямо в поиск — первой карточкой предлагаем именно её (уже отмеченной).
  const query = link ? new URL(link).hostname.replace(/^www\./, '').split('.')[0] : text;
  const sites = await (await fetch(`/popular.json?q=${encodeURIComponent(query)}`)).json();
  if (seq !== pickSeq) return;
  const saved = savedUrls();
  const same = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '');
  const list = link ? [{ name: linkTitle(link), url: link, link: true }, ...sites.filter((s) => !same(s.url, link))] : sites;
  if (link && !picked.has(link) && !saved.has(link.replace(/\/$/, ''))) picked.set(link, '');
  pickGrid.replaceChildren(...list.map((site, i) => pickCard(site, saved, i)));
  if (!list.length) {
    const empty = Object.assign(document.createElement('div'), { className: 'pick-empty' });
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: 'Добавить по ссылке' });
    btn.addEventListener('click', () => setPickMode('link'));
    empty.append(Object.assign(document.createElement('p'), { textContent: 'Такого сайта нет в списке.' }), btn);
    pickGrid.replaceChildren(empty);
  }
  updateSubmit();
}

function openDialog() {
  picked.clear();
  pickSearch.value = '';
  addUrl.value = '';
  addTitle.value = '';
  linkPreview.hidden = true;
  addError.textContent = '';
  dialog.classList.remove('closing');
  dialog.hidden = false;
  setPickMode('sites');
  renderPicker();
}

function closeDialog() {
  if (dialog.hidden || dialog.classList.contains('closing')) return;
  dialog.classList.add('closing');
  setTimeout(() => {
    dialog.hidden = true;
    dialog.classList.remove('closing');
  }, 160);
  queryEl.focus();
}

async function submitPicked() {
  const items = pickMode === 'sites' ? [...picked].map(([url, title]) => ({ url, title })) : [];
  if (pickMode === 'link') {
    const url = normalizeLink(addUrl.value);
    if (!url) {
      addError.textContent = 'Впишите ссылку, например youtube.com/@канал';
      return;
    }
    items.push({ url, title: addTitle.value.trim() });
  }
  if (!items.length) return;
  addSubmit.disabled = true;
  const result = await post('bookmark-add-many', { items });
  if (result.error) {
    addError.textContent = result.error;
    updateSubmit();
    return;
  }
  justAdded = new Set(items.map((i) => i.url.replace(/\/$/, '')));
  closeDialog();
  load();
}

document.querySelectorAll('.pick-tab').forEach((b) => b.addEventListener('click', () => setPickMode(b.dataset.mode)));
pickSearch.addEventListener('input', renderPicker);
addUrl.addEventListener('input', updateLinkPreview);
addTitle.addEventListener('input', updateLinkPreview);
document.getElementById('addForm').addEventListener('submit', (event) => {
  event.preventDefault();
  submitPicked();
});
addSubmit.addEventListener('click', submitPicked);
document.getElementById('addCancel').addEventListener('click', closeDialog);
dialog.addEventListener('mousedown', (event) => {
  if (event.target === dialog) closeDialog();
});
window.addEventListener('keydown', (event) => {
  if (dialog.hidden) return;
  if (event.key === 'Escape') closeDialog();
  if (event.key === 'Enter' && document.activeElement === pickSearch && picked.size) submitPicked();
});

// ---------- Подсказки Horizon ----------

const dropEl = document.getElementById('drop');
const LABELS = { tab: 'Вкладка', bookmark: 'Сохранено', history: 'Были здесь', site: 'Сайт', 'site-search': 'Поиск на сайте', url: 'Адрес', calc: 'Калькулятор', related: 'Похожий', search: 'Поиск' };
let suggestions = [];
let selected = -1;
let suggestSeq = 0;

function dropIcon(item) {
  const box = document.createElement('span');
  box.className = 'drop-icon';
  const glyph = item.type === 'search' || item.type === 'site-search' ? '<circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />' : '<circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.5 2.7 2.5 13.3 0 16M12 4c-2.5 2.7-2.5 13.3 0 16" />';
  box.append(icon(glyph));
  const src = item.favicon || (item.host && item.type !== 'search' && item.type !== 'calc' ? `https://${item.host}/favicon.ico` : null);
  if (src) {
    const img = new Image();
    img.alt = '';
    img.onload = () => img.naturalWidth > 1 && box.replaceChildren(img);
    img.src = src;
  }
  return box;
}

function renderDrop() {
  if (!suggestions.length) {
    dropEl.hidden = true;
    return;
  }
  dropEl.replaceChildren(
    ...suggestions.map((item, index) => {
      const row = document.createElement('div');
      row.className = 'drop-row' + (index === selected ? ' selected' : '') + (item.type === 'calc' ? ' calc' : '');
      const main = document.createElement('span');
      main.className = 'drop-main';
      const title = Object.assign(document.createElement('span'), { className: 'drop-title', textContent: item.title });
      const sub = Object.assign(document.createElement('span'), { className: 'drop-sub', textContent: item.subtitle || '' });
      main.append(title, sub);
      const type = Object.assign(document.createElement('span'), { className: 'drop-type', textContent: item.category && item.type === 'site' ? item.category : LABELS[item.type] || '' });
      row.append(dropIcon(item), main, type);
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (item.url) location.href = item.url;
      });
      return row;
    }),
  );
  dropEl.hidden = false;
}

async function updateSuggestions() {
  const text = queryEl.value.trim();
  const seq = ++suggestSeq;
  if (!text) {
    suggestions = [];
    renderDrop();
    return;
  }
  const items = await (await fetch(`/suggest?q=${encodeURIComponent(text)}`)).json();
  if (seq !== suggestSeq) return;
  suggestions = items;
  selected = -1;
  renderDrop();
}

queryEl.addEventListener('input', updateSuggestions);
queryEl.addEventListener('blur', () => setTimeout(() => (dropEl.hidden = true), 150));
queryEl.addEventListener('focus', () => suggestions.length && renderDrop());
queryEl.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = suggestions.length;
    if (!count) return;
    selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + count + 1) % (count + 1);
    if (selected === count) selected = -1;
    renderDrop();
  } else if (event.key === 'Escape') {
    suggestions = [];
    renderDrop();
  }
});

document.getElementById('search').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = queryEl.value.trim();
  if (!text) return;
  const picked = suggestions[selected];
  if (picked && picked.url) {
    location.href = picked.url;
    return;
  }
  const { url } = await (await fetch(`/resolve?q=${encodeURIComponent(text)}`)).json();
  if (url) location.href = url;
});

document.getElementById('customize').addEventListener('click', () => post('customize'));
window.addEventListener('horizon-refresh', load);
window.addEventListener('horizon-reveal', reveal);
window.addEventListener('horizon-hold', () => document.body.classList.add('waiting'));
setInterval(renderGreeting, 60000);

tick();
setInterval(tick, 1000);
load();
