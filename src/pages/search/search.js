// Страница поиска Horizon: вкладки «Всё», «Картинки», «Видео», «Карты», «Финансы», «Товары».
// Всё строится через textContent; ссылки — только http(s).
const page = document.getElementById('page');
const queryEl = document.getElementById('query');
const vertNav = document.getElementById('verticals');
const params = new URLSearchParams(location.search);
const query = params.get('q') || '';
const tab = params.get('tab') || 'all';
const pageNo = Math.max(1, Number(params.get('page')) || 1);
const exactParam = params.get('exact') === '1' ? '&exact=1' : '';

const TABS = [
  ['all', 'Всё', '<circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />'],
  ['images', 'Картинки', '<rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" />'],
  ['videos', 'Видео', '<rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9l5 3-5 3z" />'],
  ['maps', 'Карты', '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />'],
  ['finance', 'Финансы', '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />'],
  ['shop', 'Товары', '<path d="M5 8h14l-1.5 12h-11z" /><path d="M9 8a3 3 0 0 1 6 0" />'],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function svg(paths) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24">${paths}</svg>`;
  return t.content.firstChild;
}

function safeLink(url, className, text) {
  const a = el('a', className, text);
  if (/^https?:\/\//i.test(url || '')) a.href = url;
  return a;
}

function href(nextTab, nextPage = 1) {
  return `?q=${encodeURIComponent(query)}&tab=${nextTab}${nextPage > 1 ? `&page=${nextPage}` : ''}${exactParam}`;
}

function favicon(host, letter, className = 'fav') {
  const box = el('span', className, (letter || host || '?').charAt(0).toUpperCase());
  if (host) iconInto(box, host);
  return box;
}

// Сначала встроенный чёткий значок, потом значок самого сайта; иначе остаётся буква.
function iconInto(box, host, onFail) {
  const sources = [`/site-icon/${host}`, `https://${host}/favicon.ico`];
  const next = () => {
    const src = sources.shift();
    if (!src) return onFail && onFail();
    const img = new Image();
    img.alt = '';
    img.onload = () => (img.naturalWidth > 1 || src.startsWith('/site-icon/') ? box.replaceChildren(img) : next());
    img.onerror = next;
    img.src = src;
  };
  next();
}

function applyTheme(p) {
  if (!p) return;
  const root = document.documentElement.style;
  const vars = { '--bg': p.bg, '--panel': p.panel, '--panel-2': p.panel2, '--line': p.line, '--text': p.text, '--muted': p.muted, '--accent': p.accent, '--accent-ink': p.accentInk, '--accent-faint': p.accentFaint, '--r': `${p.radius}px` };
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
}

function section(title, ...children) {
  const node = el('section');
  node.append(el('h2', 'section-title', title), ...children);
  return node;
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function fmt(n, digits = 2) {
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits > 0 && n < 100 ? 2 : 0 });
}

// ---------- Вкладки ----------

function renderTabs() {
  vertNav.replaceChildren(
    ...TABS.map(([id, label, icon]) => {
      const a = el('a', 'vert' + (id === tab ? ' active' : ''));
      a.href = href(id);
      a.append(svg(icon), document.createTextNode(label));
      return a;
    }),
  );
}

// ---------- «Всё» ----------

function siteResult(site) {
  const item = el('article', 'result');
  const crumb = el('div', 'crumb');
  crumb.append(favicon(site.host, site.title), el('span', null, site.host || site.subtitle || ''));
  if (site.category) crumb.append(el('span', 'badge', site.category));
  if (site.type === 'history') crumb.append(el('span', 'badge', 'Вы здесь были'));
  if (site.type === 'bookmark') crumb.append(el('span', 'badge', 'Сохранено'));
  const title = safeLink(site.url, 'result-title', site.title);
  const text = site.desc || (site.type === 'site-search' ? `Поиск прямо на сайте ${site.host}.` : site.type === 'history' || site.type === 'bookmark' || site.type === 'tab' ? site.url : `Перейти на ${site.host || site.url}`);
  item.append(crumb, title, el('div', 'result-text', text));
  return item;
}

function wikiResult(w) {
  const item = el('article', 'result');
  const crumb = el('div', 'crumb');
  crumb.append(favicon('ru.wikipedia.org', 'W'), el('span', null, 'ru.wikipedia.org › ' + w.title));
  item.append(crumb, safeLink(w.url, 'result-title', w.title), el('div', 'result-text', w.snippet ? w.snippet + '…' : ''));
  return item;
}

function featured(site) {
  const box = el('div', 'featured');
  const main = el('div', 'featured-main');
  main.append(el('div', 'featured-name', site.title), el('div', 'featured-host', site.host));
  if (site.desc) main.append(el('div', 'featured-desc', site.desc));
  const open = safeLink(site.url, 'btn primary', 'Открыть');
  box.append(favicon(site.host, site.title), main, open);
  return box;
}

function renderAll(data) {
  const left = el('div', 'fade-in');
  if (data.calc !== null && data.calc !== undefined) {
    const calc = el('div', 'calc');
    calc.append(el('div', 'count', `${data.query} =`), el('div', 'value', Number(data.calc).toLocaleString('ru-RU')));
    left.append(calc);
  }
  const sites = data.sites || [];
  const top = sites[0];
  const directSiteSearch = top && top.type === 'site-search' && top.score >= 150; // «ютуб котики»
  if (pageNo === 1 && top && !top.category && (directSiteSearch || (top.score >= 64 && ['site', 'bookmark', 'history', 'tab'].includes(top.type)))) {
    left.append(featured(top));
  }
  const total = (data.wiki && data.wiki.total) || 0;
  if (data.correction) {
    const fix = el('p', 'correction');
    const exact = el('a', null, query);
    exact.href = `?q=${encodeURIComponent(query)}&exact=1`;
    fix.append(document.createTextNode('Исправлена опечатка — показано для «'), el('b', null, data.correction.text), document.createTextNode('». Искать как написано: '), exact);
    left.prepend(fix);
  }
  left.prepend(el('p', 'count', pageNo === 1 ? `Нашлось ${sites.length} ${plural(sites.length, 'сайт', 'сайта', 'сайтов')} и ${total.toLocaleString('ru-RU')} ${plural(total, 'статья', 'статьи', 'статей')}` : `Страница ${pageNo}`));
  if (pageNo === 1) {
    sites.forEach((s, i) => {
      if (i === 0 && left.querySelector('.featured')) return;
      left.append(siteResult(s));
    });
  }
  const wikiItems = (data.wiki && data.wiki.items) || [];
  for (const w of wikiItems) left.append(wikiResult(w));
  if (data.wiki && data.wiki.error) left.append(el('p', 'note', 'Статьи Википедии сейчас не загрузились — обновите страницу чуть позже.'));
  if (!sites.length && !wikiItems.length && !(data.quick || []).length) left.append(el('p', 'empty', 'Ничего не нашлось. Попробуйте другие слова или вкладки выше.'));

  if (data.pages > 1) {
    const pager = el('nav', 'pager');
    if (pageNo > 1) {
      const prev = el('a', null, '←');
      prev.href = href('all', pageNo - 1);
      pager.append(prev);
    }
    for (let n = 1; n <= data.pages; n++) {
      if (n === pageNo) pager.append(el('span', 'current', String(n)));
      else {
        const a = el('a', null, String(n));
        a.href = href('all', n);
        pager.append(a);
      }
    }
    if (pageNo < data.pages) {
      const next = el('a', null, '→');
      next.href = href('all', pageNo + 1);
      pager.append(next);
    }
    left.append(pager);
  }

  // Правая колонка: справка, похожие сайты, поиск на сайтах
  const aside = el('aside', 'aside fade-in');
  if (data.info) {
    const info = el('div', 'card info');
    if (data.info.image) {
      const img = new Image();
      img.alt = '';
      img.src = data.info.image;
      info.append(img);
    }
    info.append(el('h3', null, data.info.title));
    if (data.info.description) info.append(el('div', 'desc', data.info.description));
    info.append(el('p', null, data.info.extract));
    if (data.info.url) info.append(safeLink(data.info.url, 'btn', 'Читать в Википедии'));
    aside.append(info);
  }
  if (data.related && data.related.items.length) {
    const card = el('div', 'card');
    const list = el('div', 'mini-sites');
    for (const s of data.related.items) {
      const a = safeLink(s.url, 'mini');
      const main = el('div', 'mini-main');
      main.append(el('div', 'mini-name', s.name), el('div', 'mini-host', s.host));
      a.append(favicon(s.host, s.name), main);
      list.append(a);
    }
    card.append(el('h2', 'section-title', data.related.title), list);
    aside.append(card);
  }
  if (data.quick && data.quick.length) {
    const card = el('div', 'card');
    const chips = el('div', 'chips');
    for (const q of data.quick) {
      const a = safeLink(q.url, 'chip');
      const ic = el('span', 'chip-icon');
      iconInto(ic, q.host, () => ic.remove());
      a.append(ic, document.createTextNode(q.name));
      chips.append(a);
    }
    card.append(el('h2', 'section-title', `Искать «${data.query}» на сайтах`), chips);
    aside.append(card);
  }

  const layout = el('div', 'layout');
  layout.append(left, aside);
  page.replaceChildren(layout);
}

// ---------- Картинки ----------

let imagePage = pageNo;
const allImages = [];
function renderImages(data) {
  const gallery = el('div', 'gallery fade-in');
  const addShots = (items) => {
    for (const img of items) {
      const a = safeLink(img.page, 'shot');
      // По нажатию — окно просмотра со скачиванием, а не переход на сайт
      const position = allImages.push(img) - 1;
      a.addEventListener('click', (event) => {
        if (event.ctrlKey || event.button !== 0) return;
        event.preventDefault();
        window.openViewer(allImages, position);
      });
      const pic = new Image();
      pic.alt = img.title || '';
      pic.loading = 'lazy';
      pic.src = img.thumb || img.full;
      // Сервер картинок иногда отказывает, когда их просят много сразу, — одна повторная попытка.
      let retried = false;
      pic.onerror = () => {
        if (retried) return a.remove();
        retried = true;
        const src = img.thumb || img.full;
        setTimeout(() => (pic.src = src + (src.includes('?') ? '&' : '?') + 'retry=1'), 1200 + Math.random() * 1500);
      };
      a.append(pic, el('div', 'shot-cap', [img.title, img.author].filter(Boolean).join(' · ')));
      gallery.append(a);
    }
  };
  addShots(data.images.items || []);
  const wrap = el('div');
  const count = data.images.error
    ? `Картинки сейчас недоступны (${data.images.error})`
    : !(data.images.items || []).length
      ? 'Картинок не нашлось. Попробуйте другие слова.'
      : data.images.total
        ? `Свободные картинки: ${data.images.total.toLocaleString('ru-RU')}`
        : 'Свободные картинки';
  wrap.append(el('p', 'count', count), gallery);
  if (data.images.pages > imagePage) {
    const more = el('div', 'more');
    const btn = el('button', 'btn', 'Показать ещё');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Загружаю…';
      imagePage++;
      const next = await (await fetch(`/api?q=${encodeURIComponent(query)}&tab=images&page=${imagePage}`)).json();
      addShots(next.images.items || []);
      btn.disabled = false;
      btn.textContent = 'Показать ещё';
      if (imagePage >= (next.images.pages || 0)) more.remove();
    });
    more.append(btn);
    wrap.append(more);
  }
  wrap.append(el('p', 'note', `Картинки со свободной лицензией: ${data.images.source || 'Openverse и Wikimedia Commons'}.`));
  page.replaceChildren(wrap);
}

// ---------- Видео ----------

function duration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

let videoPage = pageNo;
function renderVideos(data) {
  const grid = el('div', 'videos fade-in');
  const add = (items) => {
    for (const v of items) {
      const a = safeLink(v.url, 'video');
      a.target = '_blank';
      const thumb = el('div', 'thumb');
      const img = new Image();
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.replaceWith(svg('<path d="M10 9l5 3-5 3z" /><circle cx="12" cy="12" r="9" />'));
      if (v.thumb) img.src = v.thumb;
      thumb.append(v.thumb ? img : svg('<path d="M10 9l5 3-5 3z" /><circle cx="12" cy="12" r="9" />'));
      if (v.duration) thumb.append(el('span', 'duration', duration(v.duration)));
      a.append(thumb, el('div', 'video-title', v.title), el('div', 'video-meta', [v.author, v.source].filter(Boolean).join(' · ')));
      grid.append(a);
    }
  };
  add(data.videos.items || []);
  const wrap = el('div');
  // Сначала три главных видеосайта крупно, затем остальные.
  const q = encodeURIComponent(query);
  const chip = (name, host, url, cls) => {
    const a = safeLink(url, cls);
    const ic = el('span', 'chip-icon');
    iconInto(ic, host, () => ic.remove());
    a.append(ic, document.createTextNode(name));
    return a;
  };
  const mainChips = el('div', 'video-main');
  for (const [name, host, url] of [
    ['Искать на YouTube', 'youtube.com', `https://www.youtube.com/results?search_query=${q}`],
    ['Искать на Rutube', 'rutube.ru', `https://rutube.ru/search/?query=${q}`],
    ['Искать в VK Видео', 'vkvideo.ru', `https://vkvideo.ru/?q=${q}`],
  ]) mainChips.append(chip(name, host, url, 'chip big'));
  const chips = el('div', 'chips');
  for (const [name, host, url] of [
    ['Дзен', 'dzen.ru', `https://dzen.ru/search?query=${q}`],
    ['Twitch', 'twitch.tv', `https://www.twitch.tv/search?term=${q}`],
    ['TikTok', 'tiktok.com', `https://www.tiktok.com/search?q=${q}`],
    ['Vimeo', 'vimeo.com', `https://vimeo.com/search?q=${q}`],
    ['Dailymotion', 'dailymotion.com', `https://www.dailymotion.com/search/${q}`],
    ['Kick', 'kick.com', `https://kick.com/search?query=${q}`],
  ]) chips.append(chip(name, host, url, 'chip'));
  wrap.append(mainChips, chips, el('div', 'count', ' '), data.videos.items && data.videos.items.length ? grid : el('p', 'empty', data.videos.error ? `Видео сейчас недоступны (${data.videos.error})` : 'Видео не нашлось.'));
  if (data.videos.more) {
    const more = el('div', 'more');
    const btn = el('button', 'btn', 'Показать ещё');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      videoPage++;
      const next = await (await fetch(`/api?q=${encodeURIComponent(query)}&tab=videos&page=${videoPage}`)).json();
      add(next.videos.items || []);
      btn.disabled = false;
      if (!next.videos.more) more.remove();
    });
    more.append(btn);
    wrap.append(more);
  }
  page.replaceChildren(wrap);
}

// ---------- Карты ----------

function mapUrl(p) {
  const [south, north, west, east] = p.bbox.length === 4 ? p.bbox : [p.lat - 0.02, p.lat + 0.02, p.lon - 0.03, p.lon + 0.03];
  return `https://www.openstreetmap.org/export/embed.html?bbox=${west},${south},${east},${north}&layer=mapnik&marker=${p.lat},${p.lon}`;
}

function renderMaps(data) {
  const items = data.places.items || [];
  if (!items.length) {
    page.replaceChildren(el('p', 'empty', data.places.error ? `Карты сейчас недоступны (${data.places.error})` : 'Место не нашлось. Попробуйте написать адрес или название города.'));
    return;
  }
  const wrap = el('div', 'maps');
  const list = el('div', 'places fade-in');
  const frame = document.createElement('iframe');
  frame.className = 'map-frame';
  frame.title = 'Карта';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  const select = (p, btn) => {
    frame.src = mapUrl(p);
    list.querySelectorAll('.place').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  };
  items.forEach((p, i) => {
    const btn = el('button', 'place');
    btn.append(el('div', 'place-name', p.short), el('div', 'place-addr', p.name));
    btn.addEventListener('click', () => select(p, btn));
    list.append(btn);
    if (i === 0) setTimeout(() => select(p, btn));
  });
  const links = el('div', 'chips');
  for (const [name, url] of [
    ['Открыть в 2ГИС', `https://2gis.ru/search/${encodeURIComponent(query)}`],
    ['Открыть в OpenStreetMap', `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`],
  ]) links.append(safeLink(url, 'chip', name));
  list.append(links);
  wrap.append(list, frame);
  page.replaceChildren(wrap);
}

// ---------- Финансы ----------

function renderFinance(data) {
  const f = data.finance || {};
  const wrap = el('div', 'fade-in');
  if (f.conversion) {
    const c = el('div', 'convert');
    c.append(el('div', 'count', `${fmt(f.conversion.amount)} ${f.conversion.from} =`), el('div', 'value', `${fmt(f.conversion.value)} ${f.conversion.to}`));
    wrap.append(c);
  }
  if (f.rates && f.rates.length) {
    const grid = el('div', 'money');
    for (const r of f.rates) {
      const card = el('div', 'card');
      card.append(el('div', 'label', `1 ${r.code}`), el('div', 'value', `${fmt(r.rub)} ₽`));
      grid.append(card);
    }
    wrap.append(section('Курсы валют', grid));
  }
  if (f.crypto && f.crypto.length) {
    const grid = el('div', 'money');
    for (const c of f.crypto) {
      const card = el('div', 'card');
      const change = el('div', c.change >= 0 ? 'up' : 'down', `${c.change >= 0 ? '▲' : '▼'} ${Math.abs(c.change || 0).toFixed(2)}% за сутки`);
      card.append(el('div', 'label', c.name), el('div', 'value', `${fmt(c.rub, c.rub < 1000 ? 2 : 0)} ₽`), el('div', 'label', `$${fmt(c.usd, c.usd < 100 ? 2 : 0)}`), change);
      grid.append(card);
    }
    wrap.append(section('Криптовалюты', grid));
  }
  if (!f.rates || !f.rates.length) wrap.append(el('p', 'empty', f.error ? `Курсы сейчас недоступны (${f.error})` : 'Курсы недоступны.'));
  if (data.banks && data.banks.length) {
    const list = el('div', 'shops');
    for (const b of data.banks) {
      const a = safeLink(b.url, 'shop');
      const main = el('div');
      main.append(el('div', 'shop-name', b.name), el('div', 'shop-sub', b.host));
      a.append(favicon(b.host, b.name), main);
      list.append(a);
    }
    wrap.append(section('Банки', list));
  }
  wrap.append(el('p', 'note', 'Подсказка: напишите «100 долларов в рублях» — сумма пересчитается сразу. Курсы — open.er-api.com, криптовалюты — CoinGecko.'));
  page.replaceChildren(wrap);
}

// ---------- Товары ----------

function renderShop(data) {
  const grid = el('div', 'shops fade-in');
  for (const s of data.shops || []) {
    const a = safeLink(s.url, 'shop');
    a.target = '_blank';
    const main = el('div');
    main.append(el('div', 'shop-name', s.name), el('div', 'shop-sub', `Искать «${query}»`));
    a.append(favicon(s.host, s.name), main);
    grid.append(a);
  }
  const wrap = el('div');
  wrap.append(el('p', 'count', 'Ищем товар сразу во всех магазинах — откройте нужные, каждый в своей вкладке:'), grid);
  page.replaceChildren(wrap);
}

// ---------- Загрузка ----------

async function load() {
  queryEl.value = query;
  document.title = query || 'Поиск';
  renderTabs();
  if (!query) {
    page.replaceChildren(el('p', 'empty', 'Введите, что найти.'));
    queryEl.focus();
    return;
  }
  try {
    const data = await (await fetch(`/api?q=${encodeURIComponent(query)}&tab=${tab}&page=${pageNo}${exactParam}`)).json();
    applyTheme(data.palette);
    if (data.error) throw new Error(data.error);
    if (data.blocked) {
      page.replaceChildren(el('div', 'kids-block', 'Этот запрос недоступен в детском режиме. Аккаунту меньше 18 лет — материалы для взрослых скрыты.'));
      return;
    }
    if (data.kids) document.body.classList.add('kids');
    if (tab === 'images') renderImages(data);
    else if (tab === 'videos') renderVideos(data);
    else if (tab === 'maps') renderMaps(data);
    else if (tab === 'finance') renderFinance(data);
    else if (tab === 'shop') renderShop(data);
    else renderAll(data);
  } catch (error) {
    page.replaceChildren(el('p', 'empty', `Не удалось выполнить поиск: ${error.message}`));
  }
}

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = queryEl.value.trim();
  if (!text) return;
  const { url } = await (await fetch(`/resolve?q=${encodeURIComponent(text)}`)).json();
  if (!url) return;
  // Новый запрос остаётся на той же вкладке выдачи (картинки, видео…)
  if (url.startsWith('horizon://search/') && tab !== 'all') location.href = `?q=${encodeURIComponent(text)}&tab=${tab}`;
  else location.href = url;
});

load();
