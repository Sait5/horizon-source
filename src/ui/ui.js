const START_URL = 'horizon://start/';

const tabsEl = document.getElementById('tabs');
document.documentElement.dataset.platform = window.horizon.platform;
const address = document.getElementById('address');
const addressIcon = document.getElementById('addressIcon');
const backBtn = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn = document.getElementById('reload');
const addressKey = document.getElementById('addressKey');
const vpnBtn = document.getElementById('vpnBtn');
const vpnLabel = document.getElementById('vpnLabel');
const starBtn = document.getElementById('starBtn');
const railVpn = document.getElementById('railVpn');
const updateBtn = document.getElementById('updateBtn');
const updateLabel = document.getElementById('updateLabel');
const insecureEl = document.getElementById('insecure');
const downloadsBtn = document.getElementById('downloadsBtn');
const dlRing = document.getElementById('dlRing');

const ICON_SEARCH = '<circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />';
const ICON_LOCK = '<rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />';
const ICON_GLOBE = '<circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.5 2.7 2.5 13.3 0 16M12 4c-2.5 2.7-2.5 13.3 0 16" />';
const ICON_SUNRISE = '<path d="M5 15a7 7 0 0 1 14 0" /><path d="M2 15h20" /><path d="M6 19h12" />';

let state = { tabs: [], activeId: null };
let editing = false;

function displayUrl(url) {
  if (!url || url === START_URL) return '';
  // На странице поиска Horizon в строке показывается сам запрос.
  if (url.startsWith('horizon://search/')) return new URL(url).searchParams.get('q') || '';
  return url;
}

function setTabIcon(view, tab) {
  const own = /^horizon:\/\/(start|search)\//.test(tab.url || '');
  const key = tab.loading ? 'loading' : own ? 'own' : tab.favicon || 'globe';
  if (view.iconKey === key) return;
  view.iconKey = key;
  if (own && !tab.loading) {
    view.icon.innerHTML = `<svg viewBox="0 0 24 24" class="own-icon">${ICON_SUNRISE}</svg>`;
  } else if (tab.loading) {
    view.icon.innerHTML = '<span class="spinner"></span>';
  } else if (tab.favicon) {
    const img = new Image();
    img.alt = '';
    img.onerror = () => (view.icon.innerHTML = `<svg viewBox="0 0 24 24">${ICON_GLOBE}</svg>`);
    img.src = tab.favicon;
    view.icon.replaceChildren(img);
  } else {
    view.icon.innerHTML = `<svg viewBox="0 0 24 24">${ICON_GLOBE}</svg>`;
  }
}

function createTabView(id) {
  const el = document.createElement('div');
  el.dataset.id = id;
  const icon = document.createElement('span');
  icon.className = 'tab-icon';
  const title = document.createElement('span');
  title.className = 'tab-title';
  const close = document.createElement('button');
  close.className = 'tab-close';
  close.title = 'Закрыть вкладку (Ctrl+W)';
  close.setAttribute('aria-label', 'Закрыть вкладку');
  close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>';
  // Нажатие на крестик не должно сначала переключать вкладку.
  close.addEventListener('mousedown', (event) => event.stopPropagation());
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    window.horizon.closeTab(id);
  });
  el.append(icon, title, close);
  el.addEventListener('mousedown', (event) => {
    if (event.button === 0) window.horizon.activateTab(id);
  });
  el.addEventListener('auxclick', (event) => {
    if (event.button === 1) window.horizon.closeTab(id);
  });
  return { el, icon, title, iconKey: null };
}

// Вкладки обновляются на месте, а не пересоздаются: иначе щелчок по крестику теряется,
// если между нажатием и отпусканием мыши пришло обновление (загрузка, смена заголовка).
const tabViews = new Map();

function renderTabs() {
  // Ширину считаем по всей полосе вкладок, а не по самим вкладкам: во время анимации открытия
  // вкладка ещё узкая, и раньше у неё навсегда пропадало название.
  const room = tabsEl.parentElement.clientWidth - 260;
  const narrow = state.tabs.length > 0 && room > 0 && room / state.tabs.length < 90;
  const alive = new Set(state.tabs.map((t) => t.id));
  for (const [id, view] of tabViews) {
    if (!alive.has(id)) {
      // Закрытая вкладка плавно сжимается и только потом исчезает.
      view.el.classList.add('closing');
      setTimeout(() => view.el.remove(), 180);
      tabViews.delete(id);
    }
  }
  let prev = null;
  state.tabs.forEach((tab) => {
    let view = tabViews.get(tab.id);
    if (!view) {
      view = createTabView(tab.id);
      view.el.classList.add('opening');
      setTimeout(() => view.el.classList.remove('opening'), 220);
      tabViews.set(tab.id, view);
    }
    const opening = view.el.classList.contains('opening');
    view.el.className = 'tab' + (tab.id === state.activeId ? ' active' : '') + (narrow ? ' narrow' : '') + (opening ? ' opening' : '');
    view.el.title = tab.title;
    const text = tab.title || displayUrl(tab.url) || 'Новая вкладка';
    if (view.title.textContent !== text) view.title.textContent = text;
    setTabIcon(view, tab);
    let expected = prev ? prev.nextElementSibling : tabsEl.firstElementChild;
    while (expected && expected.classList.contains('closing')) expected = expected.nextElementSibling;
    if (expected !== view.el) tabsEl.insertBefore(view.el, expected);
    prev = view.el;
  });
}

function renderToolbar() {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  backBtn.disabled = !state.canGoBack;
  forwardBtn.disabled = !state.canGoForward;
  reloadBtn.classList.toggle('loading', Boolean(tab && tab.loading));
  reloadBtn.title = tab && tab.loading ? 'Остановить' : 'Обновить (F5)';

  const url = tab ? tab.url : '';
  const secure = url.startsWith('https://');
  const insecure = /^http:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
  addressIcon.innerHTML = secure || insecure ? ICON_LOCK : ICON_SEARCH;
  addressIcon.classList.toggle('secure', secure);
  addressIcon.classList.toggle('insecure-icon', insecure);
  insecureEl.hidden = !insecure || editing;
  if (!editing) address.value = displayUrl(url);

  addressKey.hidden = !(tab && (tab.passwordFields || tab.pendingSave));
  addressKey.classList.toggle('pending', Boolean(tab && tab.pendingSave));
  addressKey.title = tab && tab.pendingSave ? 'Сохранить пароль' : 'Пароли для этого сайта';

  starBtn.hidden = !(tab && /^https?:\/\//.test(tab.url));
  starBtn.classList.toggle('saved', Boolean(state.saved));
  starBtn.title = state.saved ? 'Убрать из сохранённых' : 'Сохранить вкладку';

  const v = state.vpn || { enabled: false, status: 'off' };
  vpnBtn.className = 'vpn-btn ' + (v.enabled ? v.status : 'off');
  vpnLabel.textContent = v.enabled && (v.status === 'lost' || v.status === 'error') ? 'VPN: нет связи' : 'VPN';
  railVpn.classList.toggle('vpn-on', v.enabled && v.status === 'on');

  const update = state.update || {};
  updateBtn.hidden = update.status !== 'ready';
  updateLabel.textContent = `Обновить до ${update.version || ''}`.trim();
  vpnBtn.title = {
    off: 'Horizon VPN выключен',
    connecting: 'Horizon VPN подключается',
    on: 'Horizon VPN включён',
    lost: 'Соединение VPN потеряно',
    error: 'Horizon VPN не подключился',
  }[v.enabled ? v.status : 'off'];
}

function openPanel(mode, el, side) {
  const rect = el.getBoundingClientRect();
  window.horizon.openPanel(mode, side === 'right' ? { right: Math.round(rect.right) } : { left: Math.round(rect.left - 8) });
}

function render() {
  renderTabs();
  renderToolbar();
}

window.horizon.onState((next) => {
  const switched = next.activeId !== state.activeId;
  state = next;
  if (switched) editing = false;
  render();
});

window.horizon.onFocusAddress(() => {
  address.focus();
  address.select();
});

address.addEventListener('focus', () => {
  editing = true;
  address.select();
});
address.addEventListener('blur', () => {
  editing = false;
  renderToolbar();
});
address.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    editing = false;
    window.horizon.suggestClose();
    renderToolbar();
    address.select();
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    window.horizon.suggestMove(event.key === 'ArrowDown' ? 1 : -1);
  }
});

// Подсказки Horizon при наборе: сайты, сохранённое, история, открытые вкладки.
const addressForm = document.getElementById('addressForm');
address.addEventListener('input', () => {
  const rect = addressForm.getBoundingClientRect();
  window.horizon.suggest(address.value, { left: Math.round(rect.left), width: Math.round(rect.width) });
});
address.addEventListener('blur', () => setTimeout(() => window.horizon.suggestClose(), 150));

document.getElementById('addressForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = address.value.trim();
  if (!text) return;
  editing = false;
  address.blur();
  window.horizon.go(text);
});

document.getElementById('newTab').addEventListener('click', () => window.horizon.newTab());
backBtn.addEventListener('click', () => window.horizon.back());
forwardBtn.addEventListener('click', () => window.horizon.forward());
reloadBtn.addEventListener('click', () => {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  if (tab && tab.loading) window.horizon.stop();
  else window.horizon.reload();
});
document.getElementById('home').addEventListener('click', () => window.horizon.home());
vpnBtn.addEventListener('click', () => openPanel('vpn', vpnBtn, 'right'));
document.getElementById('vaultBtn').addEventListener('click', () => window.horizon.openPanel('vault', {}));
railVpn.addEventListener('click', () => openPanel('vpn', vpnBtn, 'right'));
document.getElementById('railVault').addEventListener('click', () => window.horizon.openPanel('vault', {}));
starBtn.addEventListener('click', () => window.horizon.toggleBookmark());
updateBtn.addEventListener('click', () => window.horizon.installUpdate());
downloadsBtn.addEventListener('click', () => openPanel('downloads', downloadsBtn, 'right'));

// Кнопка аккаунта: фото, первая буква имени или значок «войти».
const accountBtn = document.getElementById('accountBtn');
const ICON_USER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>';
accountBtn.addEventListener('click', () => window.horizon.openPanel('account', {}));
window.horizon.onAccount((acc) => {
  const user = acc.loggedIn && acc.user;
  accountBtn.classList.toggle('signed', Boolean(user));
  accountBtn.title = user ? `${user.name} · ${user.email}` : 'Войти в аккаунт Horizon';
  if (user && user.avatar) {
    const img = new Image();
    img.alt = '';
    img.src = user.avatar;
    accountBtn.replaceChildren(img);
  } else if (user) {
    accountBtn.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
  } else {
    accountBtn.innerHTML = ICON_USER;
  }
});

// Кнопка загрузок появляется после первой загрузки; кольцо показывает общий прогресс.
window.horizon.onDownloads((d) => {
  downloadsBtn.hidden = !d.count;
  downloadsBtn.classList.toggle('active', d.active > 0);
  downloadsBtn.title = d.active ? `Загрузки: идёт ${d.active}` : 'Загрузки';
  dlRing.style.background = d.active && d.progress !== null ? `conic-gradient(var(--accent) ${Math.round(d.progress * 360)}deg, transparent 0)` : 'none';
});
addressKey.addEventListener('click', () => {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  openPanel(tab && tab.pendingSave ? 'save' : 'fill', addressKey, 'left');
});

window.addEventListener('resize', renderTabs);
