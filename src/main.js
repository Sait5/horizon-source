const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  protocol,
  net,
  Menu,
  safeStorage,
  dialog,
  clipboard,
  desktopCapturer,
  screen,
  nativeImage,
  powerMonitor,
  shell,
  webContents: allWebContents,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Vpn } = require('./vpn');
const { Vault } = require('./vault/vault');
const { Profile } = require('./profile');
const { Account } = require('./account');
const search = require('./search/suggest');
const safety = require('./safety');
const { createSearchPageData } = require('./search/page-data');
const { createVerticals } = require('./search/verticals');
const { Updater } = require('./updater');

const updater = new Updater();

const TOOLBAR_HEIGHT = 84;
const START_URL = 'horizon://start/';
const START_ORIGIN = 'horizon://start';
const PAGE_KEY = require('node:crypto').randomBytes(24).toString('hex');
const PAGES_DIR = path.join(__dirname, 'pages');
const INTERNAL_PAGES = new Set(['start', 'error', 'search']);
const ERROR_PAGE = 'horizon://error/';
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'horizon:']);
const PANELS = new Set(['vpn', 'vault', 'fill', 'save', 'suggest', 'find', 'downloads', 'account']);

app.setAppUserModelId('app.horizon.browser');
// Вход по ключам доступа (passkey / WebAuthn) выключен: иначе Google и другие сайты открывают окно
// «Безопасность Windows» с просьбой вставить USB-ключ. Без него сайты просто спрашивают пароль.
app.commandLine.appendSwitch('disable-blink-features', 'WebAuth');
let lastFind = '';

protocol.registerSchemesAsPrivileged([
  { scheme: 'horizon', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
app.enableSandbox();

let win = null;
let overlay = null;
let overlayMode = null;
let browserSession = null;
let vpn = null;
let vault = null;
let profile = null;
let account = null;
let sidebarLeft = 0;
const tabs = new Map();
const downloads = new Set();
let activeId = null;
let nextId = 1;

// ---------- Адреса ----------

function isAllowedUrl(url) {
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function webOrigin(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function suggestSources() {
  return {
    tabs: [...tabs.values()].map((t) => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon })),
    bookmarks: profile.bookmarks,
    history: profile.history,
  };
}

// Превращает текст из адресной строки в адрес: ссылку или подходящий сайт открываем сразу,
// остальное ищем на странице поиска Horizon.
function inputToUrl(input) {
  return search.resolve(input, suggestSources());
}

// Запрос в интернет через сеанс вкладок: когда включён VPN, он идёт через VPN.
function fetchViaBrowser(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, session: browserSession, useSessionCookies: false });
    request.setHeader('User-Agent', `HorizonBrowser/${app.getVersion()} (personal browser; horizon search)`);
    request.on('login', (authInfo, callback) => {
      const creds = vpn && vpn.proxyCredentials(authInfo);
      if (creds) callback(creds.username, creds.password);
      else callback();
    });
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error('Время ожидания истекло'));
    }, timeoutMs);
    request.on('response', (response) => {
      const chunks = [];
      response.on('data', (c) => chunks.push(c));
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode >= 400) reject(new Error(`Ошибка ${response.statusCode}`));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

// Картинка целиком (для окна просмотра и скачивания): только http(s), только изображения, до 40 МБ.
// Адреса компьютера и домашней сети не запрашиваются.
function fetchImageViaBrowser(url, timeoutMs = 30000, maxBytes = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error('Неверный адрес картинки'));
    }
    const host = parsed.hostname;
    const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[)/i;
    if (!/^https?:$/.test(parsed.protocol) || privateHost.test(host) || !host.includes('.')) {
      return reject(new Error('Этот адрес нельзя загрузить'));
    }
    const request = net.request({ url, session: browserSession, useSessionCookies: false });
    request.setHeader('User-Agent', `HorizonBrowser/${app.getVersion()} (personal browser; horizon search)`);
    request.on('login', (authInfo, callback) => {
      const creds = vpn && vpn.proxyCredentials(authInfo);
      if (creds) callback(creds.username, creds.password);
      else callback();
    });
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error('Картинка грузится слишком долго'));
    }, timeoutMs);
    request.on('response', (response) => {
      const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (response.statusCode >= 400 || !type.startsWith('image/')) {
        clearTimeout(timer);
        request.abort();
        return reject(new Error(response.statusCode >= 400 ? `Ошибка ${response.statusCode}` : 'По ссылке не картинка'));
      }
      const chunks = [];
      let size = 0;
      response.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          clearTimeout(timer);
          request.abort();
          reject(new Error('Картинка больше 40 МБ'));
        } else chunks.push(c);
      });
      response.on('end', () => {
        clearTimeout(timer);
        resolve({ type, data: Buffer.concat(chunks) });
      });
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

const verticals = createVerticals(async (url) => JSON.parse(await fetchViaBrowser(url, 9000)));

// Данные для страницы поиска — общий модуль (тот же, что у сайта-приложения для телефона).
const buildSearchPage = createSearchPageData({ verticals, sources: () => suggestSources(), strict: () => kidsMode() });
function searchPageData(query, tab = 'all', page = 1, exact = false) {
  return buildSearchPage(query, tab, page, exact, { palette: profile.publicState().palette });
}

// Внутренние страницы читают историю и закладки, поэтому чужие сайты к ним не допускаются.
function fromInternalPage(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === START_ORIGIN || origin === 'horizon://search';
}

// ---------- Внутренние страницы horizon:// ----------

function startPageState() {
  const state = profile.publicState();
  return {
    appearance: state.appearance,
    palette: state.palette,
    gradients: state.gradients,
    bookmarks: state.bookmarks.slice(0, 24),
    userName: account && account.token && account.user ? account.user.name : null,
    key: PAGE_KEY,
    introActive: Boolean(introView || introPending),
  };
}

// Действия стартовой страницы. Принимаются только от самой стартовой страницы, а не от сайтов.
async function handleStartAction(request, url) {
  // Действия принимаются только с секретным ключом, который знает лишь сама стартовая страница
  // (она получает его из state.json — чужой сайт этот ответ прочитать не может).
  const origin = request.headers.get('origin');
  if ((origin && origin !== START_ORIGIN) || request.headers.get('x-horizon-key') !== PAGE_KEY) {
    return new Response('Нет доступа', { status: 403 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    // Пустое тело.
  }
  try {
    if (url.pathname === '/action/bookmark-add') profile.addBookmark({ url: body.url, title: body.title });
    else if (url.pathname === '/action/bookmark-add-many') {
      const items = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
      for (const item of items) profile.addBookmark({ url: item && item.url, title: item && item.title });
    } else if (url.pathname === '/action/bookmark-remove') profile.removeBookmark(String(body.id));
    else if (url.pathname === '/action/customize') openSidebar('appearance');
    else return new Response('Неизвестное действие', { status: 404 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ ok: true });
}

// Видео и картинки из assets. В установленной версии большие файлы лежат рядом с архивом
// (app.asar.unpacked), а не внутри него.
function assetPath(name) {
  const unpacked = path.join(__dirname.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1'), 'assets', name);
  return app.isPackaged && fs.existsSync(unpacked) ? unpacked : path.join(__dirname, 'assets', name);
}

// Встроенные значки популярных сайтов (scripts/fetch-site-icons.js): только файлы из списка.
let siteIcons = null;
const ICON_TYPES = { png: 'image/png', ico: 'image/x-icon', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg' };
function siteIconResponse(url) {
  if (!siteIcons) {
    try {
      siteIcons = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'site-icons', 'manifest.json'), 'utf8'));
    } catch {
      siteIcons = {};
    }
  }
  const host = decodeURIComponent(url.pathname.slice(11)).toLowerCase().replace(/^www\./, '');
  const file = Object.prototype.hasOwnProperty.call(siteIcons, host) ? siteIcons[host] : null;
  if (!file) return new Response('Нет значка', { status: 404 });
  const data = fs.readFileSync(path.join(__dirname, 'assets', 'site-icons', file));
  return new Response(data, { headers: { 'Content-Type': ICON_TYPES[file.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'max-age=86400' } });
}

async function handleInternal(request) {
  const url = new URL(request.url);
  if (!INTERNAL_PAGES.has(url.host)) return new Response('Страница не найдена', { status: 404 });
  if (url.pathname.startsWith('/site-icon/')) return siteIconResponse(url);

  if ((url.pathname === '/suggest' || url.pathname === '/resolve' || url.pathname === '/api' || url.pathname === '/image') && !fromInternalPage(request)) {
    return new Response('Нет доступа', { status: 403 });
  }
  if (url.pathname === '/suggest') return Response.json(search.suggest(url.searchParams.get('q'), suggestSources()));
  if (url.pathname === '/resolve') return Response.json({ url: inputToUrl(url.searchParams.get('q') || '') });
  if (url.host === 'search' && url.pathname === '/image') {
    try {
      const target = url.searchParams.get('url') || '';
      if (kidsMode() && safety.isAdultUrl(target)) throw new Error('Недоступно в детском режиме');
      const image = await fetchImageViaBrowser(target);
      return new Response(image.data, { headers: { 'Content-Type': image.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) {
      return new Response(error.message, { status: 502 });
    }
  }
  if (url.host === 'search' && url.pathname === '/api') {
    const tab = ['all', 'images', 'videos', 'maps', 'finance', 'shop'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'all';
    const page = Math.max(1, Math.min(50, Number(url.searchParams.get('page')) || 1));
    const query = (url.searchParams.get('q') || '').trim().slice(0, 300);
    if (page === 1 && query) profile.addSearch(query);
    try {
      return Response.json(await searchPageData(query, tab, page, url.searchParams.get('exact') === '1'));
    } catch (error) {
      return Response.json({ query, tab, page, error: error.message }, { status: 500 });
    }
  }

  if (url.host === 'start') {
    if (url.pathname === '/state.json') return Response.json(startPageState());
    if (url.pathname === '/popular.json') return Response.json(search.popularSites(url.searchParams.get('q') || ''));
    if (url.pathname.startsWith('/action/') && request.method === 'POST') return handleStartAction(request, url);
    if (url.pathname.startsWith('/builtin/')) {
      const name = decodeURIComponent(url.pathname.slice(9));
      const entry = profile.publicState().builtin[name.replace(/\.(jpg|mp4)$/, '')];
      const file = entry && (name.endsWith('.mp4') ? entry.video : entry.file);
      // Файл берётся из распакованной папки: чтение видео изнутри архива app.asar ломало волны.
      return file ? net.fetch(pathToFileURL(assetPath(file)).toString()) : new Response('Нет файла', { status: 404 });
    }
    if (url.pathname.startsWith('/bg/')) {
      const file = profile.backgroundFile(decodeURIComponent(url.pathname.slice(4)));
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Нет картинки', { status: 404 });
    }
  }

  const root = path.join(PAGES_DIR, url.host);
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    return new Response('Страница не найдена', { status: 404 });
  }
  // Внутренние страницы нельзя встроить в чужой сайт (защита от подмены кликов).
  const response = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  headers.set('X-Frame-Options', 'DENY');
  return new Response(response.body, { status: response.status, headers });
}

// ---------- Вкладки ----------

function activeTab() {
  return tabs.get(activeId) || null;
}

function tabByWebContents(wc) {
  for (const tab of tabs.values()) if (tab.view.webContents === wc) return tab;
  return null;
}

// Панели поверх страницы занимают всю ширину, вкладки — место справа от боковой панели.
function contentBounds() {
  const [width, height] = win.getContentSize();
  return { x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) };
}

function tabBounds() {
  const bounds = contentBounds();
  const left = Math.min(sidebarLeft, Math.max(0, bounds.width - 320));
  return { ...bounds, x: left, width: bounds.width - left };
}

function layout() {
  if (!win) return;
  const bounds = tabBounds();
  const [width, height] = win.getContentSize();
  for (const tab of tabs.values()) tab.view.setBounds(tab.fullscreen ? { x: 0, y: 0, width, height } : bounds);
  if (overlay) overlay.setBounds(overlayBounds());
  if (introView) introView.setBounds({ x: 0, y: 0, width, height });
}

// ---------- Прошлый сеанс ----------

let sessionTimer = null;
function scheduleSessionSave() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSessionNow, 800);
}

function saveSessionNow() {
  clearTimeout(sessionTimer);
  if (!profile || tabs.size === 0) return;
  const list = [...tabs.values()];
  const urls = list.map((t) => (t.failedUrl || t.url || START_URL)).map((u) => (u.startsWith(ERROR_PAGE) ? START_URL : u));
  profile.saveSession(urls, Math.max(0, list.findIndex((t) => t.id === activeId)));
}

function openInitialTabs() {
  const saved = profile.settings.restoreSession ? profile.loadSession() : null;
  if (!saved) {
    createTab();
    return;
  }
  const created = saved.urls.map((url) => createTab(url, { focusAddressBar: false, activate: false }));
  activateTab((created[saved.activeIndex] || created[0]).id);
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  const tab = activeTab();
  const history = tab && tab.view.webContents.navigationHistory;
  win.webContents.send('state', {
    activeId,
    canGoBack: Boolean(history && history.canGoBack()),
    canGoForward: Boolean(history && history.canGoForward()),
    saved: Boolean(tab && profile && profile.isSaved(tab.url)),
    update: updater.publicState(),
    historyCount: profile ? profile.history.length : 0,
    vpn: vpn ? { enabled: vpn.data.enabled, status: vpn.status } : null,
    tabs: [...tabs.values()].map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      loading: t.loading,
      favicon: t.favicon,
      passwordFields: t.passwordFields,
      pendingSave: Boolean(t.pendingSave),
    })),
  });
}

function focusAddress() {
  closeOverlay();
  win.webContents.focus();
  win.webContents.send('focus-address');
}

function applyWebRtcPolicy(wc) {
  // Пока включён VPN, WebRTC не может открыть UDP-соединение в обход прокси и выдать настоящий IP.
  wc.setWebRTCIPHandlingPolicy(vpn && vpn.protectsTraffic ? 'disable_non_proxied_udp' : 'default');
}

function createTab(url = START_URL, { focusAddressBar = true, activate = true } = {}) {
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: {
      session: browserSession,
      preload: path.join(__dirname, 'tab-preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  view.setBackgroundColor(profile.publicState().palette.bg);
  const tab = { id, view, title: 'Новая вкладка', url, loading: true, favicon: null, passwordFields: false, pendingSave: null };
  tabs.set(id, tab);

  const wc = view.webContents;
  applyWebRtcPolicy(wc);
  // Блокировка всплывающих окон: новая вкладка открывается, только если человек только что
  // нажал на ссылку или клавишу. Сайт не может сам по себе открыть десятки вкладок с рекламой.
  tab.lastInput = 0;
  const markInput = (_e, input) => {
    if (/mouseDown|mouseUp|keyDown|rawKeyDown|gestureTap/i.test(input.type)) tab.lastInput = Date.now();
  };
  // before-* срабатывают до того, как страница получит нажатие, — без гонки с window.open.
  wc.on('before-mouse-event', markInput);
  wc.on('before-input-event', markInput);
  wc.on('input-event', markInput);
  wc.setWindowOpenHandler(({ url: target }) => {
    if (isAllowedUrl(target) && Date.now() - tab.lastInput < 1500) {
      tab.lastInput = 0;
      createTab(target, { focusAddressBar: false });
    }
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, params) => showContextMenu(wc, params));
  wc.on('found-in-page', (_e, result) => {
    if (overlayMode === 'find' && tab.id === activeId) overlay.webContents.send('find:result', { current: result.activeMatchOrdinal, total: result.matches });
  });
  // Видео во весь экран (YouTube и др.): вкладка растягивается на всё окно.
  wc.on('enter-html-full-screen', () => {
    tab.fullscreen = true;
    closeOverlay({ refocus: false });
    win.setFullScreen(true);
    showFullscreenNotice();
    layout();
  });
  wc.on('leave-html-full-screen', () => {
    tab.fullscreen = false;
    win.setFullScreen(false);
    layout();
  });
  // Упавшая вкладка показывает объяснение и кнопку «Повторить», а не пустой экран.
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || !tabs.has(id)) return;
    tab.failedUrl = tab.url;
    const params = new URLSearchParams({ code: 'RENDERER_CRASHED', url: tab.url, vpn: '0' });
    setTimeout(() => !wc.isDestroyed() && wc.loadURL(`${ERROR_PAGE}?${params}`), 100);
  });
  wc.on('will-navigate', (event, target) => {
    // Страницу ошибки открывает только сам браузер: сайт не может показать поддельную «ошибку Horizon».
    if (!isAllowedUrl(target) || target.startsWith(ERROR_PAGE)) event.preventDefault();
  });
  wc.on('did-finish-load', () => {
    if (wc.getURL().startsWith(START_URL)) wc.send(id === activeId ? 'horizon:shown' : 'horizon:hidden');
  });
  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    profile.updateVisitTitle(tab.url, title);
    sendState();
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = favicons.find((f) => /^https?:/.test(f)) || null;
    sendState();
  });
  wc.on('did-start-loading', () => {
    tab.loading = true;
    sendState();
  });
  wc.on('did-stop-loading', () => {
    tab.loading = false;
    sendState();
  });
  wc.on('did-navigate', (_e, target) => {
    // На странице ошибки в адресной строке остаётся адрес, который не открылся.
    if (target.startsWith(ERROR_PAGE)) {
      tab.url = tab.failedUrl || target;
    } else {
      tab.url = target;
      tab.failedUrl = null;
      profile.recordVisit(target);
    }
    tab.favicon = null;
    tab.passwordFields = false;
    sendState();
    scheduleSessionSave();
  });
  wc.on('did-fail-load', (_e, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 || failedUrl.startsWith('horizon://')) return;
    tab.failedUrl = failedUrl;
    const params = new URLSearchParams({ code: description, url: failedUrl, vpn: vpn && vpn.protectsTraffic ? '1' : '0' });
    wc.loadURL(`${ERROR_PAGE}?${params}`);
  });
  wc.on('did-navigate-in-page', (_e, target, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = target;
    sendState();
  });
  wc.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });

  // Вкладки всегда лежат под панелями.
  view.setVisible(false);
  win.contentView.addChildView(view, 0);
  layout();
  wc.loadURL(url);
  if (activate) activateTab(id);
  else sendState();
  if (focusAddressBar) focusAddress();
  scheduleSessionSave();
  return tab;
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  for (const tab of tabs.values()) tab.view.setVisible(tab.id === id);
  notifyStartPages();
  if (overlayMode === 'fill' || overlayMode === 'save' || overlayMode === 'suggest') closeOverlay({ refocus: false });
  sendState();
  scheduleSessionSave();
}

function refreshTabVisibility() {
  const tab = tabs.get(activeId);
  if (!tab || !win || win.isMinimized()) return;
  tab.view.setVisible(false);
  tab.view.setVisible(true);
  notifyStartPages();
}

// Детский режим — аккаунт младше 18 лет: сайты 18+ не открываются, выдача строже, VPN выключен.
function kidsMode() {
  return Boolean(account && account.isKid());
}

// Фильтр сайтов 18+ на уровне сети: включается только в детском режиме, взрослых не замедляет.
let kidsFilterOn = false;
function updateKidsFilter() {
  const on = kidsMode();
  if (on === kidsFilterOn || !browserSession) return;
  kidsFilterOn = on;
  if (!on) {
    browserSession.webRequest.onBeforeRequest(null);
    return;
  }
  browserSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (details.resourceType !== 'mainFrame' || !safety.isAdultUrl(details.url)) return callback({});
    callback({ cancel: true });
    const wc = details.webContentsId && allWebContents.fromId(details.webContentsId);
    const params = new URLSearchParams({ code: 'KIDS_BLOCKED', url: details.url, vpn: '0' });
    if (wc) setTimeout(() => !wc.isDestroyed() && wc.loadURL(`${ERROR_PAGE}?${params}`), 30);
  });
}

// Стартовая страница узнаёт от браузера, видна ли она: по document.hidden после перехода
// на «домик» она иногда считала себя скрытой, и волны на обоях замирали.
function notifyStartPages() {
  for (const tab of tabs.values()) {
    const wc = tab.view.webContents;
    if (!wc.isDestroyed() && wc.getURL().startsWith(START_URL)) wc.send(tab.id === activeId ? 'horizon:shown' : 'horizon:hidden');
  }
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const order = [...tabs.keys()];
  const index = order.indexOf(id);
  if (/^https?:/.test(tab.failedUrl || tab.url)) {
    closedTabs.push(tab.failedUrl || tab.url);
    if (closedTabs.length > 25) closedTabs.shift();
  }
  if (tab.fullscreen) win.setFullScreen(false);
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  tabs.delete(id);

  if (tabs.size === 0) {
    // Все вкладки закрыты руками — в следующий раз браузер откроется с чистой стартовой страницы.
    clearTimeout(sessionTimer);
    profile.saveSession([], 0);
    win.close();
    return;
  }
  scheduleSessionSave();
  if (activeId === id) {
    const rest = [...tabs.keys()];
    activateTab(rest[Math.min(index, rest.length - 1)]);
  } else {
    sendState();
  }
}

function cycleTab(step) {
  const order = [...tabs.keys()];
  if (order.length < 2) return;
  const index = order.indexOf(activeId);
  activateTab(order[(index + step + order.length) % order.length]);
}

function withActive(action) {
  const tab = activeTab();
  if (tab) action(tab.view.webContents);
}

function reloadActive() {
  const tab = activeTab();
  if (!tab) return;
  if (tab.failedUrl) tab.view.webContents.loadURL(tab.failedUrl);
  else tab.view.webContents.reload();
}

function openUrl(url, { newTab = false } = {}) {
  if (!isAllowedUrl(url)) return;
  if (newTab || !activeTab()) createTab(url, { focusAddressBar: false });
  else withActive((wc) => wc.loadURL(url));
}

const closedTabs = [];

function reopenClosedTab() {
  const url = closedTabs.pop();
  if (url) createTab(url, { focusAddressBar: false });
}

function zoom(step) {
  withActive((wc) => wc.setZoomLevel(step === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + step))));
}

function openFind() {
  const tab = activeTab();
  if (!tab || overlayMode === 'find') return;
  closeOverlay({ refocus: false });
  openOverlay('find', { anchor: { right: win.getContentSize()[0] - 10 } });
}

// ---------- Меню правой кнопки ----------

function showContextMenu(wc, params) {
  const items = [];
  const add = (label, click, enabled = true) => items.push({ label, click, enabled });
  const sep = () => items.length && items[items.length - 1].type !== 'separator' && items.push({ type: 'separator' });

  if (params.linkURL && isAllowedUrl(params.linkURL)) {
    add('Открыть ссылку в новой вкладке', () => createTab(params.linkURL, { focusAddressBar: false, activate: false }));
    add('Копировать адрес ссылки', () => clipboard.writeText(params.linkURL));
    sep();
  }
  if (params.mediaType === 'image' && params.srcURL) {
    if (/^https?:/.test(params.srcURL)) add('Открыть картинку в новой вкладке', () => createTab(params.srcURL, { focusAddressBar: false, activate: false }));
    add('Сохранить картинку…', () => wc.downloadURL(params.srcURL));
    add('Копировать картинку', () => wc.copyImageAt(params.x, params.y));
    sep();
  }
  if (params.isEditable) {
    items.push({ label: 'Отменить', role: 'undo', enabled: params.editFlags.canUndo });
    items.push({ type: 'separator' });
    items.push({ label: 'Вырезать', role: 'cut', enabled: params.editFlags.canCut });
    items.push({ label: 'Копировать', role: 'copy', enabled: params.editFlags.canCopy });
    items.push({ label: 'Вставить', role: 'paste', enabled: params.editFlags.canPaste });
    items.push({ label: 'Выделить всё', role: 'selectAll' });
    sep();
  } else if (params.selectionText) {
    items.push({ label: 'Копировать', role: 'copy' });
    const text = params.selectionText.trim().slice(0, 100);
    add(`Найти «${text.length > 30 ? text.slice(0, 30) + '…' : text}» в Horizon`, () =>
      createTab(search.SEARCH_PAGE + encodeURIComponent(text), { focusAddressBar: false }));
    sep();
  }
  if (!params.linkURL && !params.isEditable && !params.selectionText && params.mediaType === 'none') {
    add('Назад', () => wc.navigationHistory.goBack(), wc.navigationHistory.canGoBack());
    add('Вперёд', () => wc.navigationHistory.goForward(), wc.navigationHistory.canGoForward());
    add('Обновить', () => wc.reload());
    sep();
    add('Найти на странице…', openFind);
    add('Печать…', () => wc.print());
    sep();
  }
  add('Просмотреть код', () => wc.inspectElement(params.x, params.y));
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------- Оформление и боковая панель ----------

function openSidebar(name) {
  if (win) win.webContents.send('sidebar:open', name);
}

function sendProfile() {
  if (!win || win.isDestroyed()) return;
  const state = profile.publicState();
  win.webContents.send('profile', state);
  if (overlay) overlay.webContents.send('theme', state.palette);
  win.setTitleBarOverlay({ color: state.palette.strip, symbolColor: state.palette.text });
  win.setBackgroundColor(state.palette.bg);
  for (const tab of tabs.values()) {
    tab.view.setBackgroundColor(state.palette.bg);
    // Открытые стартовые страницы перерисовываются сразу.
    if (tab.view.webContents.getURL().startsWith(START_URL)) tab.view.webContents.send('horizon:refresh');
  }
  sendState();
}

// ---------- Панели поверх страницы ----------

// Строка поиска по странице занимает только свой угол, чтобы страницу можно было листать и нажимать.
function findBounds() {
  const [width] = win.getContentSize();
  return { x: Math.max(0, width - 404), y: TOOLBAR_HEIGHT, width: Math.min(404, width), height: 64 };
}

function overlayBounds() {
  return overlayMode === 'find' ? findBounds() : contentBounds();
}

function openOverlay(mode, payload = {}, { focus = true } = {}) {
  if (!overlay || !PANELS.has(mode)) return;
  overlayMode = mode;
  overlay.setBounds(overlayBounds());
  win.contentView.addChildView(overlay); // поднимаем над вкладками
  overlay.setVisible(true);
  if (focus) overlay.webContents.focus();
  overlay.webContents.send('overlay:open', mode, payload);
}

function closeOverlay({ refocus = true } = {}) {
  if (!overlay || !overlayMode) return;
  if (overlayMode === 'suggest') suggestState = null;
  overlayMode = null;
  overlay.setVisible(false);
  if (refocus) withActive((wc) => wc.focus());
}

// ---------- Подсказки адресной строки ----------

let suggestState = null;

function showSuggestions(text, anchor) {
  const items = search.suggest(text, suggestSources());
  if (!String(text || '').trim() || !items.length) {
    if (overlayMode === 'suggest') closeOverlay({ refocus: false });
    return;
  }
  // Первая подсказка выбрана сразу, если это точно подходящий сайт: Enter откроет его.
  // На общие слова («новости») ничего не выбираем заранее: Enter покажет все варианты.
  const first = items[0];
  // Ничего не выбираем заранее: Enter открывает выдачу, сайт — только если выбрать его стрелкой или мышью.
  const index = -1;
  void first;
  suggestState = { text: String(text).trim(), items, index, anchor };
  if (overlayMode === 'suggest') overlay.webContents.send('suggest:update', { items, index });
  else if (!overlayMode) openOverlay('suggest', { anchor, items, index }, { focus: false });
}

function moveSuggestion(step) {
  if (!suggestState || overlayMode !== 'suggest') return;
  const count = suggestState.items.length;
  suggestState.index = (suggestState.index + step + count + 1) % (count + 1);
  if (suggestState.index === count) suggestState.index = -1;
  overlay.webContents.send('suggest:update', { items: suggestState.items, index: suggestState.index });
}

function openSuggestion(item) {
  closeOverlay({ refocus: false });
  if (!item) return;
  if (item.type === 'tab' && tabs.has(item.tabId)) activateTab(item.tabId);
  else if (item.url) withActive((wc) => wc.loadURL(item.url));
  withActive((wc) => wc.focus());
}

function openPanel(mode, anchor = {}) {
  const tab = activeTab();
  const payload = { anchor };
  if (mode === 'fill' || mode === 'save') {
    payload.origin = tab ? webOrigin(tab.view.webContents.getURL()) : null;
    if (mode === 'save') {
      if (!tab || !tab.pendingSave) return;
      payload.origin = tab.pendingSave.origin;
      payload.pending = { username: tab.pendingSave.username };
    }
  }
  if (overlayMode === mode) closeOverlay();
  else openOverlay(mode, payload);
}

function copySecret(text) {
  clipboard.writeText(text);
  setTimeout(() => {
    if (clipboard.readText() === text) clipboard.clear();
  }, 30000);
}

function activeOrigin() {
  const tab = activeTab();
  return tab ? webOrigin(tab.view.webContents.getURL()) : null;
}

const str = (value) => String(value ?? '');

// Всё, что могут вызвать панели. Вкладки и сайты сюда доступа не имеют.
const overlayApi = {
  'vpn.state': () => vpn.publicState(),
  'vpn.setEnabled': (on) => {
    if (on && kidsMode()) throw new Error('VPN недоступен в детском режиме (аккаунт младше 18 лет)');
    return vpn.setEnabled(Boolean(on));
  },
  'vpn.reconnect': () => vpn.connect(),
  'vpn.importText': (text) => vpn.importText(str(text)),
  'vpn.importQr': (source) => vpn.importQr(source === 'screen' ? 'screen' : 'clipboard'),
  'vpn.importQrFile': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Картинка с QR-кодом',
      filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : vpn.importQr({ file: result.filePaths[0] });
  },
  'vpn.select': (id) => vpn.select(str(id)),
  'vpn.remove': (id) => vpn.remove(str(id)),
  'vpn.removeSubscription': (id) => vpn.removeSubscription(str(id)),
  'vpn.refreshSubscription': (id) => vpn.refreshSubscription(str(id)),
  'vpn.test': () => vpn.test(),
  'vpn.ping': () => vpn.pingAll(),

  'vault.status': () => vault.status(),
  'vault.create': (master) => vault.create(str(master)),
  'vault.unlock': (master) => vault.unlock(str(master)),
  'vault.unlockHello': () => vault.unlockWithHello(),
  'vault.lock': () => vault.lock(),
  'vault.recover': (code, master) => vault.recover(str(code), str(master)),
  'vault.changeMaster': (current, next, code) => vault.changeMaster(str(current), str(next), str(code)),
  'vault.newRecovery': (master, code) => vault.newRecoveryCode(str(master), str(code)),
  'vault.list': () => vault.list(),
  'vault.reveal': (id) => vault.get(str(id)).password,
  'vault.copy': (id) => copySecret(vault.get(str(id)).password),
  'vault.save': (entry) => vault.save({ origin: str(entry && entry.origin), username: str(entry && entry.username), password: str(entry && entry.password) }),
  'vault.remove': (id) => vault.remove(str(id)),
  'vault.tfaBegin': () => vault.twoFactorBegin(),
  'vault.tfaConfirm': (code) => vault.twoFactorConfirm(str(code)),
  'vault.tfaDisable': (code) => vault.twoFactorDisable(str(code)),
  'vault.helloEnable': () => vault.helloEnable(),
  'vault.helloDisable': () => vault.helloDisable(),
  'vault.export': async (master, code) => {
    const result = await dialog.showSaveDialog(win, {
      title: 'Сохранить файл сейфа',
      defaultPath: 'horizon-vault.hvault',
      filters: [{ name: 'Сейф Horizon', extensions: ['hvault'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await vault.exportTo(result.filePath, str(master), str(code));
    return true;
  },
  'vault.import': (file, master, code) => vault.importFrom(str(file), str(master), str(code)),
  'dialog.openVault': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Файл сейфа Horizon',
      filters: [{ name: 'Сейф Horizon', extensions: ['hvault', 'json'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  },
  'clipboard.write': (text) => copySecret(str(text)),

  'fill.list': () => {
    const origin = activeOrigin();
    return origin ? vault.forOrigin(origin) : [];
  },
  'fill.apply': (id) => {
    const tab = activeTab();
    const entry = vault.get(str(id));
    // Пароль уходит только во вкладку, которая сейчас открыта на том же сайте.
    if (!tab || webOrigin(tab.view.webContents.getURL()) !== entry.origin) {
      throw new Error('Адрес сайта изменился, подстановка отменена');
    }
    // Скрипт вкладки ещё раз сверяет сайт: если страница успела смениться, пароль не подставится.
    tab.view.webContents.send('pw:fill', { origin: entry.origin, username: entry.username, password: entry.password });
  },
  'save.confirm': () => {
    const tab = activeTab();
    if (!tab || !tab.pendingSave) throw new Error('Нечего сохранять');
    vault.save(tab.pendingSave);
    tab.pendingSave = null;
    sendState();
  },
  'save.dismiss': () => {
    const tab = activeTab();
    if (tab) tab.pendingSave = null;
    sendState();
  },
  'overlay.openVault': () => openOverlay('vault', {}),

  'account.state': () => account.publicState(),
  'account.register': (email, password, name, birthDate) => account.register(str(email), str(password), str(name), str(birthDate)),
  'account.setBirthDate': (birthDate) => account.setBirthDate(str(birthDate)),
  'account.verify': (email, code) => account.verifyEmail(str(email), str(code)),
  'account.resend': (email) => account.resend(str(email)),
  'account.login': (email, password) => account.login(str(email), str(password)),
  'account.forgot': (email) => account.forgot(str(email)),
  'account.reset': (email, code, password) => account.reset(str(email), str(code), str(password)),
  'account.logout': () => account.logout(),
  'account.refresh': () => account.refresh(),
  'account.update': (patch) => account.updateProfile({ name: patch && patch.name !== undefined ? str(patch.name) : undefined, avatar: patch && patch.avatar === null ? null : undefined }),
  'account.avatar': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Фото профиля',
      filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      properties: ['openFile'],
    });
    if (!result.canceled) await account.setAvatarFromFile(result.filePaths[0]);
  },
  // Telegram открывается в новой вкладке Horizon; QR-код — запасной путь с телефона.
  'account.phoneStart': async ({ openTab = true } = {}) => {
    const data = await account.phoneStart();
    const QRCode = require('qrcode');
    const qr = await QRCode.toDataURL(data.link, { margin: 1, width: 200, color: { dark: '#0e1116', light: '#ffffff' } });
    if (openTab) {
      closeOverlay({ refocus: false });
      createTab(data.web, { focusAddressBar: false });
    }
    return { ...data, qr };
  },
  'account.adminUsers': () => account.adminUsers(),
  'account.adminBlock': (id, blocked) => account.adminBlock(str(id), Boolean(blocked)),
  'account.adminLogout': (id) => account.adminLogout(str(id)),
  'account.adminRole': (id, role) => account.adminRole(str(id), role === 'admin' ? 'admin' : 'user'),
  'account.phoneRemove': () => account.phoneRemove(),
  'account.sessions': () => account.sessions(),
  'account.revoke': (id) => account.revoke(str(id)),
  'account.password': (current, password) => account.changePassword(str(current), str(password)),
  'account.delete': (password) => account.deleteAccount(str(password)),
  'suggest.pick': (index) => openSuggestion(suggestState && suggestState.items[Number(index)]),
  'find.query': (text, forward) => {
    const query = str(text);
    if (!query) return withActive((wc) => wc.stopFindInPage('clearSelection'));
    withActive((wc) => wc.findInPage(query, { forward: forward !== false, findNext: query === lastFind }));
    lastFind = query;
  },
  'find.stop': () => {
    lastFind = '';
    withActive((wc) => wc.stopFindInPage('keepSelection'));
    closeOverlay();
  },
  'downloads.list': () => downloadList(),
  'downloads.open': (id, confirmed) => openDownload(str(id), Boolean(confirmed)),
  'downloads.show': (id) => {
    const d = downloadRecords.get(str(id));
    if (d) shell.showItemInFolder(d.path);
  },
  'downloads.cancel': (id) => {
    const d = downloadRecords.get(str(id));
    if (d && d.item && d.state === 'progressing') d.item.cancel();
  },
  'downloads.clear': () => {
    for (const [id, d] of downloadRecords) if (d.state !== 'progressing') downloadRecords.delete(id);
    sendDownloads();
  },
};

ipcMain.handle('overlay:call', async (event, method, args) => {
  if (!overlay || event.sender !== overlay.webContents) return { ok: false, error: 'Нет доступа' };
  const fn = overlayApi[method];
  if (!fn) return { ok: false, error: `Неизвестное действие ${method}` };
  try {
    return { ok: true, value: await fn(...(Array.isArray(args) ? args : [])) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.on('overlay:close', (event) => {
  if (overlay && event.sender === overlay.webContents) closeOverlay();
});

// ---------- Пароли из вкладок ----------

ipcMain.on('pw:fields', (event, has) => {
  const tab = tabByWebContents(event.sender);
  if (!tab) return;
  tab.passwordFields = Boolean(has);
  sendState();
});

ipcMain.on('pw:submitted', (event, payload) => {
  const tab = tabByWebContents(event.sender);
  const origin = event.senderFrame ? webOrigin(event.senderFrame.url) : null;
  if (!tab || !origin || !payload) return;
  const username = str(payload.username).slice(0, 512);
  const password = str(payload.password);
  if (!password || password.length > 4096) return;
  // Предложение сохранить пароль — только после настоящего нажатия человека, а не по команде сайта.
  if (Date.now() - (tab.lastInput || 0) > 5000) return;
  if (vault.has(origin, username, password)) return;
  tab.pendingSave = { origin, username, password };
  sendState();
  if (tab.id === activeId && !overlayMode) openPanel('save', { left: 150 });
});

// ---------- Горячие клавиши ----------

function handleShortcut(input) {
  if (input.type !== 'keyDown') return false;
  const key = input.key.toLowerCase();
  const ctrl = input.control || input.meta;

  // Esc всегда выводит из полноэкранного режима сайта.
  const current = activeTab();
  if (key === 'escape' && current && current.fullscreen) {
    current.view.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {});
    return true;
  }

  if (ctrl && input.shift && key === 't') return reopenClosedTab(), true;
  if (ctrl && key === 't') return createTab(), true;
  if (ctrl && key === 'f') return openFind(), true;
  if (ctrl && key === 'h') return openSidebar('history'), true;
  if (ctrl && key === 'p') return withActive((wc) => wc.print()), true;
  if (ctrl && (key === '=' || key === '+')) return zoom(0.5), true;
  if (ctrl && key === '-') return zoom(-0.5), true;
  if (ctrl && key === '0') return zoom(0), true;
  if (key === 'f11') return win.setFullScreen(!win.isFullScreen()), true;
  if (ctrl && key === 'w') return closeTab(activeId), true;
  if (ctrl && key === 'l') return focusAddress(), true;
  if (ctrl && key === 'tab') return cycleTab(input.shift ? -1 : 1), true;
  if ((ctrl && key === 'r') || key === 'f5') return reloadActive(), true;
  if (input.alt && key === 'arrowleft') return withActive((wc) => wc.navigationHistory.goBack()), true;
  if (input.alt && key === 'arrowright') return withActive((wc) => wc.navigationHistory.goForward()), true;
  if (key === 'f12') return withActive((wc) => wc.toggleDevTools()), true;
  return false;
}

// ---------- Связь с панелью браузера ----------

function fromUi(handler) {
  return (event, ...args) => {
    if (win && event.sender === win.webContents) handler(...args);
  };
}

ipcMain.on('tab:new', fromUi(() => createTab()));
ipcMain.on('tab:close', fromUi((id) => closeTab(Number(id))));
ipcMain.on('tab:activate', fromUi((id) => activateTab(Number(id))));
ipcMain.on('nav:go', fromUi((text) => {
  if (typeof text !== 'string') return;
  // Если стрелками выбрана подсказка — открываем её.
  const picked = suggestState && suggestState.text === text.trim() && suggestState.index >= 0 ? suggestState.items[suggestState.index] : null;
  if (picked && picked.url) return openSuggestion(picked);
  if (overlayMode === 'suggest') closeOverlay({ refocus: false });
  const url = inputToUrl(text);
  if (!url || !isAllowedUrl(url)) return;
  withActive((wc) => {
    wc.loadURL(url);
    wc.focus();
  });
}));
ipcMain.on('suggest:query', fromUi((text, anchor) => {
  const a = anchor && typeof anchor === 'object' ? anchor : {};
  showSuggestions(typeof text === 'string' ? text : '', {
    left: Number.isFinite(a.left) ? a.left : 150,
    width: Number.isFinite(a.width) ? a.width : 600,
  });
}));
ipcMain.on('suggest:move', fromUi((step) => moveSuggestion(step > 0 ? 1 : -1)));
ipcMain.on('suggest:close', fromUi(() => {
  if (overlayMode === 'suggest') closeOverlay({ refocus: false });
}));
// «Очистить историю» стирает всё, что говорит, где человек был и что искал: историю сайтов и поисков,
// «назад/вперёд» во вкладках, недавно закрытые вкладки, кэш страниц и поисковой выдачи, список загрузок.
// Cookies (входы на сайты) остаются — для них есть отдельная кнопка.
async function clearAllHistory() {
  profile.clearHistory();
  closedTabs.length = 0;
  verticals.clearCache();
  for (const tab of tabs.values()) {
    try {
      tab.view.webContents.navigationHistory.clear();
    } catch {
      // Вкладка закрывается — пропускаем.
    }
  }
  saveSessionNow();
  await browserSession.clearCache().catch(() => {});
  await browserSession.clearData({ dataTypes: ['cache', 'downloads'] }).catch(() => {});
  await browserSession.clearHostResolverCache().catch(() => {});
  sendState();
}
ipcMain.on('history:clear', fromUi(() => clearAllHistory()));
ipcMain.handle('history:list', (event) => (win && event.sender === win.webContents ? profile.historyList() : null));
ipcMain.on('history:removeSearch', fromUi((at) => profile.removeSearch(at)));
ipcMain.on('history:removeVisit', fromUi((url) => profile.removeVisit(String(url))));
ipcMain.on('history:open', fromUi((url, newTab) => {
  if (typeof url !== 'string' || !isAllowedUrl(url)) return;
  if (newTab) createTab(url);
  else withActive((wc) => wc.loadURL(url));
}));
ipcMain.on('nav:back', fromUi(() => withActive((wc) => wc.navigationHistory.goBack())));
ipcMain.on('nav:forward', fromUi(() => withActive((wc) => wc.navigationHistory.goForward())));
ipcMain.on('nav:reload', fromUi(reloadActive));
ipcMain.on('nav:stop', fromUi(() => withActive((wc) => wc.stop())));
ipcMain.on('nav:home', fromUi(() => withActive((wc) => wc.loadURL(START_URL))));
ipcMain.on('panel:open', fromUi((mode, anchor) => {
  if (!PANELS.has(mode)) return;
  const a = anchor && typeof anchor === 'object' ? anchor : {};
  openPanel(mode, {
    left: Number.isFinite(a.left) ? a.left : undefined,
    right: Number.isFinite(a.right) ? a.right : undefined,
  });
}));

// Боковая панель и оформление.
const safely = (fn) => (...args) => {
  try {
    fn(...args);
  } catch (error) {
    if (win) win.webContents.send('ui:error', error.message);
  }
};

ipcMain.on('ui:layout', fromUi((left) => {
  sidebarLeft = Math.max(0, Math.min(Number(left) || 0, 800));
  layout();
}));
ipcMain.on('appearance:set', fromUi(safely((patch) => profile.setAppearance(patch))));
ipcMain.on('appearance:reset', fromUi(safely(() => profile.resetAppearance())));
ipcMain.on('appearance:image', fromUi(async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Картинка для фона',
    filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    properties: ['openFile'],
  });
  if (!result.canceled) safely(() => profile.setBackgroundImage(result.filePaths[0]))();
}));
ipcMain.on('session:restore', fromUi((on) => profile.setRestoreSession(on)));
ipcMain.on('appearance:removeImage', fromUi(safely(() => profile.removeBackgroundImage())));
// Выход из всех сайтов: удаляются cookies, сохранённые данные сайтов и кэш.
ipcMain.on('sitedata:clear', fromUi(async () => {
  await browserSession.clearStorageData();
  await browserSession.clearCache();
  if (win) win.webContents.send('ui:error', 'Cookies и данные сайтов удалены. Вы вышли из всех сайтов.');
}));
ipcMain.on('bookmark:toggle', fromUi(safely(() => {
  const tab = activeTab();
  if (tab) profile.toggleBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon });
})));
ipcMain.on('bookmark:remove', fromUi((id) => profile.removeBookmark(String(id))));
ipcMain.on('bookmark:rename', fromUi((id, title) => profile.renameBookmark(String(id), title)));
ipcMain.on('bookmark:open', fromUi((id, newTab) => {
  const bookmark = profile.bookmarks.find((b) => b.id === id);
  if (bookmark) openUrl(bookmark.url, { newTab: Boolean(newTab) });
}));
ipcMain.on('group:save', fromUi(safely((name) => {
  profile.saveGroup(name, [...tabs.values()].map((t) => ({ url: t.failedUrl || t.url, title: t.title, favicon: t.favicon })));
})));
ipcMain.on('group:open', fromUi((id) => {
  const group = profile.groups.find((g) => g.id === id);
  if (!group) return;
  group.tabs.forEach((t, i) => createTab(t.url, { focusAddressBar: false, activate: i === 0 }));
}));
ipcMain.on('group:remove', fromUi((id) => profile.removeGroup(String(id))));
ipcMain.on('intro:replay', fromUi(() => {
  // Повтор заставки: стартовая страница снова прячет меню до перехода.
  introPending = true;
  for (const tab of tabs.values()) if (tab.view.webContents.getURL().startsWith(START_URL)) tab.view.webContents.send('horizon:hold');
  showIntro();
}));
ipcMain.on('update:check', fromUi(() => updater.check()));
ipcMain.on('update:install', fromUi(() => {
  if (updater.install({ restart: true })) app.quit();
}));

// ---------- Заставка при первом запуске ----------

let introView = null;
let introPending = false;

// Стартовая страница выплывает, когда заставка начинает растворяться.
function revealStartPage() {
  introPending = false;
  for (const tab of tabs.values()) {
    if (tab.view.webContents.getURL().startsWith(START_URL)) tab.view.webContents.send('horizon:reveal');
  }
}

function introVideoPath(name = 'intro.mp4') {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'assets', name)
    : path.join(__dirname, 'assets', name);
}

function showIntro() {
  const file = introVideoPath();
  if (!win || introView || !fs.existsSync(file)) return;
  introView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  introView.setBackgroundColor('#000000');
  const [width, height] = win.getContentSize();
  introView.setBounds({ x: 0, y: 0, width, height });
  win.contentView.addChildView(introView);
  introView.webContents.on('will-navigate', (event) => event.preventDefault());
  introView.webContents.on('page-title-updated', (_e, title) => {
    if (title === 'leaving') revealStartPage();
    if (title === 'done') closeIntro();
  });
  const query = { src: pathToFileURL(file).href };
  const sound = introVideoPath('intro-sound.wav');
  if (profile.appearance.introSound !== false && fs.existsSync(sound)) query.sound = pathToFileURL(sound).href;
  introView.webContents.loadFile(path.join(__dirname, 'ui', 'intro.html'), { query });
  introView.webContents.focus();
  setTimeout(closeIntro, 10000); // на случай, если видео не сможет проиграться
}

function closeIntro() {
  if (!introView) return;
  const view = introView;
  introView = null;
  win.contentView.removeChildView(view);
  view.webContents.close();
  profile.markIntroSeen();
  revealStartPage();
  withActive((wc) => wc.focus());
}

// ---------- Окно ----------

function createWindow() {
  const colors = profile.publicState().palette;
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'Horizon',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    backgroundColor: colors.bg,
    // На Windows кнопки окна рисуются поверх полосы вкладок справа, на Mac — «светофор» слева.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 12 } }
      : { titleBarOverlay: { color: colors.strip, symbolColor: colors.text, height: 38 } }),
    webPreferences: {
      // Значки сайтов в панели тоже загружаются через VPN, когда он включён.
      session: browserSession,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });
  win.on('resize', layout);
  win.once('ready-to-show', () => {
    trace('окно показано');
    win.show();
  });
  // Вкладка, созданная до показа окна, оставалась для Chromium «скрытой» — и видео на главной
  // (волны) вставало на паузу. При показе, разворачивании и фокусе окна видимость обновляется.
  for (const event of ['show', 'restore', 'focus']) win.on(event, refreshTabVisibility);
  win.webContents.once('did-finish-load', () => {
    trace('интерфейс загружен');
    sendProfile();
    win.webContents.send('account', account.publicState());
    const wantIntro = !profile.settings.introSeen || profile.appearance.introEveryLaunch;
    introPending = wantIntro && process.env.HORIZON_NO_INTRO !== '1';
    openInitialTabs();
    if (introPending) showIntro();
  });
  win.on('close', saveSessionNow);
  win.on('closed', () => {
    win = null;
    overlay = null;
    tabs.clear();
  });

  overlay = new WebContentsView({
    webPreferences: {
      session: browserSession,
      preload: path.join(__dirname, 'overlay-preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.setBackgroundColor('#00000000');
  overlay.setVisible(false);
  overlay.webContents.on('will-navigate', (event) => event.preventDefault());
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.webContents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });
  win.contentView.addChildView(overlay);
  overlay.webContents.loadFile(path.join(__dirname, 'ui', 'overlay.html'));
  overlay.webContents.on('did-finish-load', () => overlay.webContents.send('theme', profile.publicState().palette));

  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

function setupSession() {
  browserSession = session.fromPartition('persist:horizon');
  browserSession.protocol.handle('horizon', handleInternal);
  // Убираем из User-Agent пометки Electron, чтобы сайты видели обычный Chromium.
  browserSession.setUserAgent(browserSession.getUserAgent().replace(/\s(horizon|Electron)\/\S+/gi, ''));
  // Камера, микрофон, геолокация и уведомления пока запрещены: запрос разрешений появится позже.
  browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write');
  });
  browserSession.on('will-download', (_event, item, wc) => {
    // Сайт не может сам, без нажатия человека, подсунуть файл в «Загрузки».
    const tab = wc ? tabByWebContents(wc) : null;
    if (tab && Date.now() - (tab.lastInput || 0) > 10000) {
      item.cancel();
      return;
    }
    trackDownload(item);
  });
}

// Предупреждение при входе сайта в полноэкранный режим: подделать интерфейс браузера незаметно не выйдет.
let noticeView = null;
function showFullscreenNotice() {
  if (!win) return;
  if (noticeView) win.contentView.removeChildView(noticeView);
  noticeView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  noticeView.setBackgroundColor('#00000000');
  const html = `<html><body style="margin:0;display:grid;place-items:center;height:100vh;font:14px Segoe UI,sans-serif">
    <div style="padding:12px 20px;border-radius:12px;background:rgba(14,17,22,.92);color:#e6eaf0;border:1px solid #2a313c">
    Сайт открыт во весь экран. Нажмите <b>Esc</b>, чтобы выйти</div></body></html>`;
  noticeView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const [width] = win.getContentSize();
  noticeView.setBounds({ x: Math.round(width / 2 - 220), y: 24, width: 440, height: 60 });
  win.contentView.addChildView(noticeView);
  const view = noticeView;
  setTimeout(() => {
    if (win && noticeView === view) {
      win.contentView.removeChildView(view);
      view.webContents.close();
      noticeView = null;
    }
  }, 4000);
}

// ---------- Загрузки ----------

const downloadRecords = new Map();
let downloadSeq = 0;
// Файлы, которые запускаются как программы: перед открытием Horizon переспрашивает.
const DANGEROUS_FILE = /\.(exe|msi|msix|appx|appxbundle|bat|cmd|com|scr|pif|ps1|vbs|vbe|js|jse|wsf|wsh|hta|jar|lnk|reg|cpl|dll|iso|img|vhdx?)$/i;

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

function downloadList() {
  return [...downloadRecords.values()]
    .sort((a, b) => b.started - a.started)
    .map(({ item, ...rest }) => rest);
}

let downloadTimer = null;
function sendDownloads() {
  clearTimeout(downloadTimer);
  downloadTimer = null;
  const list = downloadList();
  const active = list.filter((d) => d.state === 'progressing');
  const total = active.reduce((s, d) => s + (d.total || 0), 0);
  const received = active.reduce((s, d) => s + d.received, 0);
  if (win && !win.isDestroyed()) win.webContents.send('downloads', { count: list.length, active: active.length, progress: total ? received / total : null });
  if (overlay && overlayMode === 'downloads') overlay.webContents.send('downloads:update', list);
}

function sendDownloadsSoon() {
  if (!downloadTimer) downloadTimer = setTimeout(sendDownloads, 300);
}

function trackDownload(item) {
  downloads.add(item);
  const id = String(++downloadSeq);
  const name = item.getFilename().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'файл';
  // Как в Chrome: файл сразу сохраняется в «Загрузки», без лишнего окна.
  const savePath = uniquePath(app.getPath('downloads'), name);
  item.setSavePath(savePath);
  const record = {
    id,
    item,
    name: path.basename(savePath),
    path: savePath,
    url: item.getURL(),
    received: 0,
    total: item.getTotalBytes(),
    state: 'progressing',
    dangerous: DANGEROUS_FILE.test(savePath),
    started: Date.now(),
  };
  downloadRecords.set(id, record);
  item.on('updated', (_e, state) => {
    record.received = item.getReceivedBytes();
    record.total = item.getTotalBytes();
    record.state = state === 'interrupted' ? 'interrupted' : 'progressing';
    sendDownloadsSoon();
  });
  item.once('done', (_e, state) => {
    downloads.delete(item);
    record.item = null;
    record.received = item.getReceivedBytes();
    record.state = state; // completed | cancelled | interrupted
    sendDownloads();
  });
  sendDownloads();
}

async function openDownload(id, confirmed) {
  const record = downloadRecords.get(id);
  if (!record || record.state !== 'completed') throw new Error('Файл ещё не скачан');
  if (record.dangerous && !confirmed) return { needsConfirm: true };
  const error = await shell.openPath(record.path);
  if (error) throw new Error(error);
  return { opened: true };
}

function setupVpn() {
  vpn = new Vpn({ app, session: browserSession, safeStorage, net, desktopCapturer, screen, clipboard, nativeImage });
  let previous = vpn.status;
  vpn.on('change', (state) => {
    // При обрыве и при переключении маршрута загрузки останавливаются, чтобы не докачиваться мимо VPN.
    if (state.status !== previous && (state.status === 'lost' || state.status === 'connecting')) {
      for (const item of downloads) item.cancel();
    }
    previous = state.status;
    for (const tab of tabs.values()) applyWebRtcPolicy(tab.view.webContents);
    if (overlay) overlay.webContents.send('vpn:state', state);
    sendState();
  });
}

function setupAccount() {
  account = new Account({ app, safeStorage, net, shell, nativeImage });
  account.load();
  account.on('change', (state) => {
    if (win && !win.isDestroyed()) win.webContents.send('account', state);
    if (overlay) overlay.webContents.send('account:changed', state);
    // Вошли в детский аккаунт — VPN выключается: через него можно обойти ограничения.
    if (kidsMode() && vpn && vpn.publicState().enabled) vpn.setEnabled(false).catch(() => {});
    updateKidsFilter();
  });
  // Когда бот подтвердил номер, профиль открывается сам и показывает результат.
  account.on('phone-verified', () => {
    if (!overlayMode) openOverlay('account', { phoneVerified: true });
  });
  // Имя, фото и номер подтягиваются с сервера при запуске; без сети остаётся сохранённое.
  account.refresh().catch(() => {});
}

function setupVault() {
  vault = new Vault({ app, safeStorage });
  vault.on('change', () => {
    if (overlay) overlay.webContents.send('vault:changed');
  });
  powerMonitor.on('lock-screen', () => vault.lock());
  powerMonitor.on('suspend', () => vault.lock());
}

// Логин и пароль локального ядра VPN подставляются только для него.
app.on('login', (event, _webContents, _details, authInfo, callback) => {
  const creds = vpn && vpn.proxyCredentials(authInfo);
  if (!creds) return;
  event.preventDefault();
  callback(creds.username, creds.password);
});

// Отдельная папка профиля (для проверок установленной версии, не трогая основной профиль).
if (process.env.HORIZON_PROFILE_DIR) app.setPath('userData', process.env.HORIZON_PROFILE_DIR);

// Один браузер на профиль: второй запуск ярлыка открывает новую вкладку в уже запущенном окне,
// а не второй экземпляр, который мог бы испортить историю и сейф.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    createTab();
  });
}

// Журнал запуска для проверок на машинах сборки (HORIZON_TRACE=1): видно, на каком шаге старт.
const traceStart = Date.now();
const trace = (step) => process.env.HORIZON_TRACE === '1' && process.stderr.write(`[запуск] ${step} +${Date.now() - traceStart} мс
`);
process.on('unhandledRejection', (error) => console.error('[ошибка]', error && error.stack ? error.stack : error));

// Самопроверка для машин сборки (HORIZON_SELFTEST=<папка>): главная, поиск, плитки и волны работают,
// снимки окна сохраняются в папку, итог печатается одной строкой — и программа закрывается.
async function selfTest() {
  const dir = process.env.HORIZON_SELFTEST;
  const result = { window: Boolean(win && !win.isDestroyed()) };
  const tab = tabs.get(activeId);
  const wc = tab && tab.view.webContents;
  result.url = wc ? wc.getURL() : null;
  const run = (target, code) => target.executeJavaScript(code).catch((error) => `ошибка: ${error.message}`);
  if (wc) {
    result.page = await run(wc, `({ search: !!document.getElementById('query'), tiles: document.querySelectorAll('.tile').length, video: (() => { const v = document.getElementById('liveA'); return v ? [v.readyState, v.error && v.error.message] : null; })() })`);
    result.popular = await run(wc, `fetch('/popular.json').then((r) => r.json()).then((l) => l.length)`);
  }
  if (win) result.platform = await run(win.webContents, 'document.documentElement.dataset.platform');
  for (const [name, target] of [['start', wc], ['ui', win && win.webContents]]) {
    if (!target) continue;
    try {
      fs.writeFileSync(path.join(dir, `smoke-${name}.png`), (await target.capturePage()).toPNG());
    } catch (error) {
      result[`${name}Shot`] = error.message;
    }
  }
  process.stderr.write(`[самопроверка] ${JSON.stringify(result)}\n`);
  app.exit(0);
}

app.whenReady().then(async () => {
  trace('готов');
  profile = new Profile(app, safeStorage);
  profile.load();
  trace('профиль');
  profile.on('change', sendProfile);
  // На Mac без меню «Правка» не работают ⌘C, ⌘V и ⌘A в полях ввода, а без меню приложения — ⌘Q.
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null);
  setupSession();
  trace('сеанс');
  setupVpn();
  setupVault();
  setupAccount();
  trace('аккаунт');
  updateKidsFilter();
  await vpn.init();
  trace('vpn');
  createWindow();
  trace('окно');
  if (process.env.HORIZON_SELFTEST) setTimeout(selfTest, 15000);
  updater.on('change', sendState);
  updater.start({ app });
});

let quitting = false;
app.on('before-quit', (event) => {
  // Скачанное обновление ставится тихо после закрытия браузера.
  updater.install({ restart: false });
  if (profile) {
    profile.flushHistory();
    profile.flushSearches();
  }
  if (quitting || !vpn) return;
  event.preventDefault();
  quitting = true;
  vpn.shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());
