// Боковая панель: сохранённые вкладки, группы вкладок и конструктор оформления.
const sidepanel = document.getElementById('sidepanel');
const RAIL_WIDTH = 52;
const PANEL_WIDTH = 320;
const PANEL_TITLES = { saved: 'Сохранённые вкладки', groups: 'Группы вкладок', history: 'История', appearance: 'Оформление' };

const SIDE_ICONS = {
  close: '<path d="M6 6l12 12M18 6L6 18" />',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" />',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  image: '<rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" />',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />',
  layers: '<path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" />',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v4h4" />',
  search: '<circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />',
};

let profile = null;
let openName = null;
let sideForm = {};
let sideNote = '';
let editingId = null;
let dragging = false;

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function sideIcon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24">${SIDE_ICONS[name]}</svg>`;
  return t.content.firstChild;
}

function iconBtn(name, title, onClick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, title, 'aria-label': title, onClick }, sideIcon(name));
}

function sideField(name, placeholder, { onEnter, onEscape } = {}) {
  return h('input', {
    class: 'field',
    placeholder,
    spellcheck: 'false',
    value: sideForm[name] || '',
    'data-name': name,
    onInput: (e) => (sideForm[name] = e.target.value),
    onKeydown: (e) => {
      if (e.key === 'Enter' && onEnter) onEnter();
      if (e.key === 'Escape' && onEscape) onEscape();
    },
  });
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function siteIcon(item) {
  const box = h('div', { class: 'item-icon' }, (item.title || hostOf(item.url)).charAt(0).toUpperCase());
  if (item.favicon) {
    const img = h('img', { src: item.favicon, alt: '' });
    img.onload = () => box.replaceChildren(img);
  }
  return box;
}

function throttle(fn, ms) {
  let timer = null;
  let last = null;
  return (...args) => {
    last = args;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn(...last);
    }, ms);
  };
}

const sendAppearance = throttle((patch) => window.horizon.setAppearance(patch), 60);

// ---------- Раскладка ----------

function reportLayout() {
  const rail = profile && profile.appearance.sidebar ? RAIL_WIDTH : 0;
  document.body.classList.toggle('no-rail', !rail);
  window.horizon.setLayout(rail + (openName ? PANEL_WIDTH : 0));
}

function toggleSide(name) {
  openName = openName === name ? null : name;
  if (openName === 'history') historyData = null; // каждый раз свежая история
  sideNote = '';
  editingId = null;
  renderSide();
  reportLayout();
}

// ---------- Сохранённые вкладки ----------

function bookmarkItem(b) {
  if (editingId === b.id) {
    const save = () => {
      window.horizon.renameBookmark(b.id, sideForm.rename || '');
      editingId = null;
    };
    const input = sideField('rename', 'Название', { onEnter: save, onEscape: () => { editingId = null; renderSide(); } });
    input.dataset.autofocus = '1';
    return h('div', { class: 'item' }, siteIcon(b), input, iconBtn('close', 'Отмена', () => { editingId = null; renderSide(); }));
  }
  return h(
    'div',
    {
      class: 'item',
      title: b.url,
      onClick: (e) => window.horizon.openBookmark(b.id, e.ctrlKey),
      onAuxclick: (e) => e.button === 1 && window.horizon.openBookmark(b.id, true),
    },
    siteIcon(b),
    h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, b.title), h('div', { class: 'item-sub' }, hostOf(b.url))),
    iconBtn('external', 'Открыть в новой вкладке', (e) => { e.stopPropagation(); window.horizon.openBookmark(b.id, true); }),
    iconBtn('pencil', 'Переименовать', (e) => {
      e.stopPropagation();
      editingId = b.id;
      sideForm.rename = b.title;
      renderSide();
    }),
    iconBtn('trash', 'Удалить', (e) => { e.stopPropagation(); window.horizon.removeBookmark(b.id); }, 'danger'),
  );
}

function savedPanel() {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  const canSave = Boolean(tab && /^https?:\/\//.test(tab.url));
  const query = (sideForm.savedSearch || '').toLowerCase();
  const list = profile.bookmarks.filter((b) => !query || b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query));
  return [
    h(
      'div',
      { class: 'sp-body' },
      h(
        'div',
        { class: 'sp-section' },
        h('button', { class: 'btn primary wide', disabled: !canSave, onClick: () => window.horizon.toggleBookmark() }, sideIcon('star'), state.saved ? 'Убрать эту вкладку' : 'Сохранить эту вкладку'),
      ),
      profile.bookmarks.length > 6 ? h('div', { class: 'sp-section' }, sideField('savedSearch', 'Поиск по сохранённым')) : null,
      h(
        'div',
        { class: 'sp-section' },
        list.length
          ? list.map(bookmarkItem)
          : h('div', { class: 'empty' }, profile.bookmarks.length ? 'Ничего не найдено' : 'Здесь будут сохранённые вкладки. Нажмите звёздочку в адресной строке или кнопку выше. Они же появятся плитками на стартовой странице.'),
      ),
      sideNote ? h('p', { class: 'note' }, sideNote) : null,
    ),
    h(
      'div',
      { class: 'sp-foot' },
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: profile.restoreSession, onChange: (e) => window.horizon.setRestoreSession(e.target.checked) }),
        h('span', null, 'Открывать вкладки прошлого сеанса при запуске'),
      ),
      h(
        'button',
        { class: 'btn wide', style: 'margin-top:12px', disabled: !state.historyCount, onClick: () => window.horizon.clearHistory() },
        sideIcon('trash'),
        state.historyCount ? `Очистить историю (${state.historyCount})` : 'История пуста',
      ),
      h(
        'button',
        {
          class: 'btn wide',
          style: 'margin-top:8px' + (sideForm.confirmClear ? ';color:var(--red)' : ''),
          onClick: () => {
            if (!sideForm.confirmClear) {
              sideForm.confirmClear = true;
              renderSide();
              return;
            }
            sideForm.confirmClear = false;
            window.horizon.clearSiteData();
          },
        },
        sideIcon('reset'),
        sideForm.confirmClear ? 'Точно? Выйдете из всех сайтов' : 'Удалить cookies и кэш сайтов',
      ),
    ),
  ];
}

// ---------- Группы вкладок ----------

function groupsPanel() {
  const count = state.tabs.filter((t) => /^https?:\/\//.test(t.url)).length;
  const save = () => {
    window.horizon.saveGroup(sideForm.groupName || '');
    sideForm.groupName = '';
    sideNote = '';
  };
  return [
    h(
      'div',
      { class: 'sp-body' },
      h(
        'div',
        { class: 'sp-section' },
        h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
          sideField('groupName', 'Название, например «Работа»', { onEnter: save }),
          h('button', { class: 'btn primary wide', disabled: !count, onClick: save }, sideIcon('layers'), `Сохранить открытые вкладки (${count})`),
        ),
        sideNote ? h('p', { class: 'note' }, sideNote) : null,
      ),
      h(
        'div',
        { class: 'sp-section' },
        profile.groups.length
          ? profile.groups.map((g) =>
              h(
                'div',
                { class: 'group' },
                h(
                  'div',
                  { class: 'row' },
                  h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, g.title), h('div', { class: 'item-sub' }, `${g.tabs.length} вкладок · ${new Date(g.created).toLocaleDateString('ru-RU')}`)),
                  iconBtn('trash', 'Удалить группу', () => window.horizon.removeGroup(g.id), 'danger'),
                ),
                h(
                  'div',
                  { class: 'group-tabs' },
                  g.tabs.slice(0, 4).map((t) => h('div', null, '• ' + t.title)),
                  g.tabs.length > 4 ? h('div', null, `и ещё ${g.tabs.length - 4}`) : null,
                ),
                h('button', { class: 'btn', onClick: () => window.horizon.openGroup(g.id) }, sideIcon('external'), 'Открыть все'),
              ),
            )
          : h('div', { class: 'empty' }, 'Сохраните все открытые вкладки одной группой, чтобы потом открыть их разом.'),
      ),
    ),
  ];
}

// ---------- История: что искали и где были, по дням ----------

let historyData = null;
let historyKind = 'searches';

async function loadHistory() {
  historyData = await window.horizon.historyList();
  if (openName === 'history') renderSide();
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ts >= start) return 'Сегодня';
  if (ts >= start - 86400000) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric', weekday: 'long' });
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function searchItem(s) {
  const url = 'horizon://search/?q=' + encodeURIComponent(s.q);
  return h(
    'div',
    { class: 'item', title: s.q, onClick: (e) => window.horizon.openUrl(url, e.ctrlKey), onAuxclick: (e) => e.button === 1 && window.horizon.openUrl(url, true) },
    h('div', { class: 'item-icon search-icon' }, sideIcon('search')),
    h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, s.q), h('div', { class: 'item-sub' }, timeLabel(s.at))),
    iconBtn('trash', 'Удалить из истории', (e) => {
      e.stopPropagation();
      window.horizon.removeSearch(s.at);
      historyData.searches = historyData.searches.filter((x) => x !== s);
      renderSide();
    }, 'danger'),
  );
}

function visitItem(v) {
  const host = hostOf(v.url);
  return h(
    'div',
    { class: 'item', title: v.url, onClick: (e) => window.horizon.openUrl(v.url, e.ctrlKey), onAuxclick: (e) => e.button === 1 && window.horizon.openUrl(v.url, true) },
    siteIcon({ title: v.title || host, url: v.url, favicon: `https://${host}/favicon.ico` }),
    h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, v.title || host), h('div', { class: 'item-sub' }, `${timeLabel(v.at)} · ${host}${v.visits > 1 ? ` · ${v.visits} раз` : ''}`)),
    iconBtn('trash', 'Удалить из истории', (e) => {
      e.stopPropagation();
      window.horizon.removeVisit(v.url);
      historyData.visits = historyData.visits.filter((x) => x !== v);
      renderSide();
    }, 'danger'),
  );
}

function historyPanel() {
  if (!historyData) {
    loadHistory();
    return [h('div', { class: 'sp-body' }, h('div', { class: 'empty' }, 'Загружаю историю…'))];
  }
  const query = (sideForm.historySearch || '').toLowerCase();
  const list = historyKind === 'searches'
    ? historyData.searches.filter((s) => !query || s.q.toLowerCase().includes(query))
    : historyData.visits.filter((v) => !query || (v.title || '').toLowerCase().includes(query) || v.url.toLowerCase().includes(query));
  const groups = [];
  for (const entry of list.slice(0, 300)) {
    const label = dayLabel(entry.at);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(entry);
  }
  const kindBtn = (kind, text, count) =>
    h('button', { class: 'seg-btn' + (historyKind === kind ? ' active' : ''), onClick: () => { historyKind = kind; renderSide(); } }, text, h('span', { class: 'seg-count' }, String(count)));
  return [
    h(
      'div',
      { class: 'sp-body' },
      h(
        'div',
        { class: 'sp-section' },
        h('div', { class: 'seg' }, kindBtn('searches', 'Поиски', historyData.searches.length), kindBtn('visits', 'Сайты', historyData.visits.length)),
        h('div', { style: 'margin-top:10px' }, sideField('historySearch', historyKind === 'searches' ? 'Найти в истории поисков' : 'Найти в истории сайтов')),
      ),
      groups.length
        ? groups.map((g) => h('div', { class: 'sp-section' }, h('div', { class: 'sp-label' }, g.label), g.items.map(historyKind === 'searches' ? searchItem : visitItem)))
        : h('div', { class: 'sp-section' }, h('div', { class: 'empty' }, query ? 'Ничего не найдено' : historyKind === 'searches' ? 'Здесь появятся ваши поисковые запросы с датой и временем.' : 'Здесь появятся сайты, на которых вы были.')),
    ),
    h(
      'div',
      { class: 'sp-foot' },
      h(
        'button',
        {
          class: 'btn wide',
          style: sideForm.confirmHistory ? 'color:var(--red)' : '',
          disabled: !historyData.searches.length && !historyData.visits.length,
          onClick: () => {
            if (!sideForm.confirmHistory) {
              sideForm.confirmHistory = true;
              renderSide();
              return;
            }
            sideForm.confirmHistory = false;
            window.horizon.clearHistory();
            historyData = { searches: [], visits: [] };
            renderSide();
          },
        },
        sideIcon('trash'),
        sideForm.confirmHistory ? 'Точно очистить всю историю?' : 'Очистить всю историю',
      ),
      h('p', { class: 'note', style: 'margin:8px 0 0;color:var(--muted)' }, 'История хранится только на этом компьютере в зашифрованном виде.'),
    ),
  ];
}

// ---------- Конструктор оформления ----------

function slider(label, key, min, max, step, format) {
  const a = profile.appearance;
  const value = h('span', null, format(a[key]));
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value: a[key],
    onPointerdown: () => (dragging = true),
    onPointerup: () => {
      dragging = false;
      renderSide();
    },
    onInput: (e) => {
      value.textContent = format(Number(e.target.value));
      sendAppearance({ [key]: Number(e.target.value) });
    },
  });
  return h('div', { class: 'slider' }, h('div', { class: 'slider-head' }, h('span', null, label), value), input);
}

function toggle(label, key) {
  return h(
    'label',
    { class: 'check' },
    h('input', { type: 'checkbox', checked: profile.appearance[key], onChange: (e) => window.horizon.setAppearance({ [key]: e.target.checked }) }),
    h('span', null, label),
  );
}

function appearancePanel() {
  const a = profile.appearance;
  const bg = a.background;

  const presets = h(
    'div',
    { class: 'presets' },
    Object.entries(profile.presets).map(([id, p]) =>
      h(
        'button',
        { class: 'preset' + (a.preset === id ? ' selected' : ''), title: p.name, onClick: () => window.horizon.setAppearance({ preset: id }) },
        h(
          'div',
          { class: 'preset-mock' },
          h('span', { style: `background:${p.bg}` }),
          h('span', { style: `background:${p.toolbar}` }, h('i', { style: `background:${p.text}` })),
        ),
        h('span', { class: 'preset-name' }, p.name),
      ),
    ),
  );

  const accents = h(
    'div',
    { class: 'swatches' },
    profile.accents.map((color) =>
      h('button', {
        class: 'swatch' + (a.accent === color ? ' selected' : ''),
        style: `background:${color}`,
        title: color,
        onClick: () => window.horizon.setAppearance({ accent: color }),
      }),
    ),
    h(
      'label',
      { class: 'color-input' + (!profile.accents.includes(a.accent) ? ' selected' : ''), title: 'Свой цвет', style: profile.accents.includes(a.accent) ? '' : `background:${a.accent};border-style:solid` },
      profile.accents.includes(a.accent) ? sideIcon('plus') : null,
      h('input', { type: 'color', value: a.accent, onChange: (e) => window.horizon.setAppearance({ accent: e.target.value }) }),
    ),
  );

  const imageUrl = bg.type === 'image' ? `horizon://start/bg/${encodeURIComponent(bg.value)}?v=${bg.version || 0}` : null;
  const backgrounds = h(
    'div',
    { class: 'backgrounds' },
    Object.entries(profile.builtin || {}).map(([id, b]) =>
      h('button', {
        class: 'bg-tile' + (bg.type === 'builtin' && bg.value === id ? ' selected' : ''),
        style: `background-image:url("horizon://start/builtin/${id}.jpg");background-size:cover;background-position:center`,
        onClick: () => window.horizon.setAppearance({ background: { type: 'builtin', value: id } }),
      }, b.name),
    ),
    Object.entries(profile.gradients).map(([id, g]) =>
      h('button', {
        class: 'bg-tile' + (bg.type === 'gradient' && bg.value === id ? ' selected' : ''),
        style: `background:${g.css}`,
        onClick: () => window.horizon.setAppearance({ background: { type: 'gradient', value: id } }),
      }, g.name),
    ),
    h('button', {
      class: 'bg-tile' + (bg.type === 'theme' ? ' selected' : ''),
      style: `background:${profile.palette.bg};color:${profile.palette.text};text-shadow:none`,
      onClick: () => window.horizon.setAppearance({ background: { type: 'theme' } }),
    }, 'Как тема'),
    h(
      'label',
      { class: 'bg-tile special' + (bg.type === 'color' ? ' selected' : ''), style: bg.type === 'color' ? `background:${bg.value};color:#fff` : '' },
      sideIcon('drop'),
      'Свой цвет',
      h('input', { type: 'color', value: bg.type === 'color' ? bg.value : '#1e2a3a', onChange: (e) => window.horizon.setAppearance({ background: { type: 'color', value: e.target.value } }) }),
    ),
    h(
      'button',
      {
        class: 'bg-tile special' + (bg.type === 'image' ? ' selected' : ''),
        style: imageUrl ? `background-image:url("${imageUrl}");background-size:cover;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7)` : '',
        onClick: () => window.horizon.pickBackground(),
      },
      sideIcon('image'),
      bg.type === 'image' ? 'Сменить' : 'Картинка',
    ),
  );

  return [
    h(
      'div',
      { class: 'sp-body' },
      h('div', { class: 'sp-section' }, h('p', { class: 'sp-label' }, 'Тема панелей'), presets),
      h('div', { class: 'sp-section' }, h('p', { class: 'sp-label' }, 'Цвет акцента'), accents),
      h(
        'div',
        { class: 'sp-section' },
        h('p', { class: 'sp-label' }, 'Фон стартовой страницы'),
        backgrounds,
        bg.type === 'image'
          ? h('button', { class: 'btn wide', style: 'margin-top:8px', onClick: () => window.horizon.removeBackground() }, sideIcon('trash'), 'Убрать свою картинку')
          : null,
        slider('Затемнение фона', 'dim', 0, 0.8, 0.05, (v) => `${Math.round(v * 100)}%`),
        slider('Размытие фона', 'blur', 0, 30, 1, (v) => `${v} px`),
      ),
      h('div', { class: 'sp-section' }, h('p', { class: 'sp-label' }, 'Форма'), slider('Скругление углов', 'radius', 0, 20, 1, (v) => `${v} px`)),
      h(
        'div',
        { class: 'sp-section' },
        h('p', { class: 'sp-label' }, 'Показывать'),
        h('div', { class: 'toggles' },
          toggle('Часы на стартовой странице', 'showClock'),
          toggle('Плитки сохранённых вкладок', 'showTiles'),
          toggle('Полоса кнопок слева', 'sidebar'),
          toggle('Заставка при каждом запуске', 'introEveryLaunch'),
          toggle('Звук заставки', 'introSound'),
        ),
      ),
      aboutSection(),
      sideNote ? h('p', { class: 'note' }, sideNote) : null,
    ),
    h('div', { class: 'sp-foot' }, h('button', { class: 'btn wide', onClick: () => window.horizon.resetAppearance() }, sideIcon('reset'), 'Сбросить оформление')),
  ];
}

const UPDATE_TEXT = {
  idle: 'Проверка ещё не запускалась',
  checking: 'Проверяю обновления…',
  latest: 'Установлена последняя версия',
  downloading: 'Скачиваю обновление…',
  ready: 'Обновление готово — нажмите «Обновить» вверху или просто закройте браузер',
  error: 'Не удалось проверить обновления',
};

function aboutSection() {
  const u = state.update || { status: 'idle' };
  const text = u.status === 'disabled' ? u.message : `${UPDATE_TEXT[u.status] || ''}${u.status === 'error' && u.message ? `: ${u.message}` : ''}`;
  return h(
    'div',
    { class: 'sp-section' },
    h('p', { class: 'sp-label' }, 'О программе'),
    h('div', { class: 'item-title' }, `Horizon ${u.current || ''}`),
    h('button', { class: 'btn', style: 'margin:0 0 10px', onClick: () => window.horizon.replayIntro() }, 'Показать заставку'),
    h('div', { class: 'item-sub', style: 'white-space:normal;margin:4px 0 10px' }, text),
    u.status !== 'disabled'
      ? h('button', { class: 'btn', disabled: u.status === 'checking' || u.status === 'downloading', onClick: () => window.horizon.checkUpdate() }, sideIcon('reset'), 'Проверить обновления')
      : null,
  );
}

// ---------- Отрисовка ----------

function renderSide() {
  document.querySelectorAll('.rail-btn[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === openName));
  if (!openName || !profile) {
    sidepanel.hidden = true;
    return;
  }
  const focused = document.activeElement && sidepanel.contains(document.activeElement) ? document.activeElement.dataset.name : null;
  const scroll = sidepanel.querySelector('.sp-body') ? sidepanel.querySelector('.sp-body').scrollTop : 0;
  const body = openName === 'saved' ? savedPanel() : openName === 'groups' ? groupsPanel() : openName === 'history' ? historyPanel() : appearancePanel();
  sidepanel.hidden = false;
  sidepanel.replaceChildren(
    h('div', { class: 'sp-head' }, h('h2', null, PANEL_TITLES[openName]), iconBtn('close', 'Закрыть', () => toggleSide(openName))),
    ...body.filter(Boolean),
  );
  const newBody = sidepanel.querySelector('.sp-body');
  if (newBody) newBody.scrollTop = scroll;
  const target = (focused && sidepanel.querySelector(`[data-name="${focused}"]`)) || sidepanel.querySelector('[data-autofocus="1"]');
  if (target) {
    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
  }
}

document.querySelectorAll('.rail-btn[data-panel]').forEach((b) => b.addEventListener('click', () => toggleSide(b.dataset.panel)));

window.horizon.onProfile((next) => {
  profile = next;
  applyTheme(next.palette);
  if (!dragging) renderSide();
  reportLayout();
});

window.horizon.onSidebar((name) => {
  if (!PANEL_TITLES[name]) return;
  openName = name;
  if (name === 'history') historyData = null;
  renderSide();
  reportLayout();
});

let lastUpdateStatus = null;
window.horizon.onState(() => {
  const updateStatus = state.update ? state.update.status : null;
  const updateChanged = updateStatus !== lastUpdateStatus;
  lastUpdateStatus = updateStatus;
  if (openName === 'saved' || openName === 'groups' || (openName === 'appearance' && updateChanged && !dragging)) renderSide();
});

window.horizon.onError((message) => {
  sideNote = message;
  renderSide();
});
