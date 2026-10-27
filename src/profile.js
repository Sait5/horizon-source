// Профиль пользователя: оформление, сохранённые вкладки, группы вкладок и прошлый сеанс.
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const themes = require('./themes');

const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const MAX_IMAGE = 25 * 1024 * 1024;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

function cleanUrl(url) {
  try {
    const parsed = new URL(String(url));
    return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function cleanTitle(title, url) {
  const text = String(title || '').trim().slice(0, 200);
  if (text) return text;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function cleanFavicon(favicon) {
  return typeof favicon === 'string' && /^https?:\/\//.test(favicon) ? favicon.slice(0, 2000) : null;
}

class Profile extends EventEmitter {
  constructor(app, safeStorage) {
    super();
    this.safeStorage = safeStorage;
    const dir = app.getPath('userData');
    this.settingsFile = path.join(dir, 'settings.json');
    this.bookmarksFile = path.join(dir, 'bookmarks.json');
    this.sessionFile = path.join(dir, 'session.json');
    this.backgroundsDir = path.join(dir, 'backgrounds');
    this.historyFile = path.join(dir, 'history.json');
    this.settings = { appearance: themes.DEFAULT_APPEARANCE, restoreSession: true };
    this.bookmarks = [];
    this.groups = [];
    this.history = [];
    this.historyTimer = null;
    this.searchesFile = path.join(dir, 'searches.json');
    this.searches = [];
    this.searchesTimer = null;
  }

  load() {
    const saved = readJson(this.settingsFile, {});
    this.settings = {
      appearance: themes.normalizeAppearance(saved.appearance),
      restoreSession: saved.restoreSession !== false,
      introSeen: saved.introSeen === true,
      wallpaperV2: true,
    };
    // Один раз меняем старый фон по умолчанию («Сияние») на обои «Восход» из заставки.
    const bg = saved.appearance && saved.appearance.background;
    if (!saved.wallpaperV2 && bg && bg.type === 'gradient' && bg.value === 'aurora') {
      this.settings.appearance = themes.normalizeAppearance({ ...saved.appearance, background: { type: 'builtin', value: 'sunrise' }, dim: 0.08 });
    }
    const marks = readJson(this.bookmarksFile, {});
    this.bookmarks = Array.isArray(marks.bookmarks) ? marks.bookmarks : [];
    this.groups = Array.isArray(marks.groups) ? marks.groups : [];
    const history = this.readSecure(this.historyFile, []);
    this.history = Array.isArray(history) ? history : [];
    const searches = this.readSecure(this.searchesFile, []);
    this.searches = Array.isArray(searches) ? searches.filter((s) => s && typeof s.q === 'string') : [];
  }

  // История и прошлые вкладки шифруются средствами Windows: с чужой учётной записи или
  // со снятого диска их не прочитать. Старые незашифрованные файлы читаются и перезаписываются.
  readSecure(file, fallback) {
    try {
      const raw = fs.readFileSync(file);
      if (raw[0] === 0x7b || raw[0] === 0x5b) return JSON.parse(raw.toString('utf8'));
      return JSON.parse(this.safeStorage.decryptString(raw));
    } catch {
      return fallback;
    }
  }

  writeSecure(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, this.safeStorage.encryptString(JSON.stringify(value)));
    fs.renameSync(tmp, file);
  }

  // ---------- История посещений (для подсказок; хранится только на этом компьютере) ----------

  recordVisit(url, title) {
    const clean = cleanUrl(url);
    if (!clean) return;
    const existing = this.history.find((h) => h.url === clean);
    if (existing) {
      existing.visits = (existing.visits || 1) + 1;
      existing.last = Date.now();
      if (title) existing.title = String(title).slice(0, 200);
    } else {
      this.history.unshift({ url: clean, title: title ? String(title).slice(0, 200) : '', visits: 1, last: Date.now() });
      if (this.history.length > 3000) this.history.length = 3000;
    }
    this.scheduleHistorySave();
  }

  updateVisitTitle(url, title) {
    const clean = cleanUrl(url);
    const entry = clean && this.history.find((h) => h.url === clean);
    if (entry && title) {
      entry.title = String(title).slice(0, 200);
      this.scheduleHistorySave();
    }
  }

  scheduleHistorySave() {
    clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => this.writeSecure(this.historyFile, this.history), 2000);
  }

  flushHistory() {
    if (!this.historyTimer) return;
    clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.writeSecure(this.historyFile, this.history);
  }

  clearHistory() {
    clearTimeout(this.historyTimer);
    clearTimeout(this.searchesTimer);
    this.historyTimer = null;
    this.searchesTimer = null;
    this.history = [];
    this.searches = [];
    fs.rmSync(this.historyFile, { force: true });
    fs.rmSync(this.searchesFile, { force: true });
    this.emit('change');
  }

  removeVisit(url) {
    const before = this.history.length;
    this.history = this.history.filter((h) => h.url !== url);
    if (this.history.length !== before) this.scheduleHistorySave();
  }

  // ---------- История поисков (тоже только на этом компьютере, зашифрована) ----------

  addSearch(query) {
    const q = String(query || '').trim().slice(0, 300);
    if (!q) return;
    const now = Date.now();
    const last = this.searches[0];
    // Тот же запрос подряд (переключение вкладок выдачи, обновление) — не дублируем, только время.
    if (last && last.q === q && now - last.at < 30 * 60 * 1000) last.at = now;
    else this.searches.unshift({ q, at: now });
    if (this.searches.length > 2000) this.searches.length = 2000;
    clearTimeout(this.searchesTimer);
    this.searchesTimer = setTimeout(() => this.writeSecure(this.searchesFile, this.searches), 1500);
  }

  removeSearch(at) {
    this.searches = this.searches.filter((s) => s.at !== Number(at));
    this.writeSecure(this.searchesFile, this.searches);
  }

  flushSearches() {
    if (!this.searchesTimer) return;
    clearTimeout(this.searchesTimer);
    this.searchesTimer = null;
    this.writeSecure(this.searchesFile, this.searches);
  }

  // Для панели «История»: последние поиски и сайты, самые новые сверху.
  historyList(limit = 400) {
    return {
      searches: this.searches.slice(0, limit),
      visits: [...this.history].sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, limit).map((h) => ({ url: h.url, title: h.title, at: h.last, visits: h.visits })),
    };
  }

  get appearance() {
    return this.settings.appearance;
  }

  saveSettings() {
    writeJson(this.settingsFile, this.settings);
  }

  saveBookmarks() {
    writeJson(this.bookmarksFile, { bookmarks: this.bookmarks, groups: this.groups });
    this.emit('change');
  }

  // ---------- Оформление ----------

  setAppearance(patch) {
    if (!patch || typeof patch !== 'object') return;
    this.settings.appearance = themes.normalizeAppearance({ ...this.settings.appearance, ...patch });
    this.saveSettings();
    this.emit('change');
  }

  resetAppearance() {
    this.settings.appearance = themes.normalizeAppearance({});
    this.saveSettings();
    this.emit('change');
  }

  setBackgroundImage(source) {
    const ext = path.extname(source).toLowerCase();
    if (!IMAGE_TYPES.has(ext)) throw new Error('Подходят картинки PNG, JPG, WEBP, GIF или BMP');
    if (fs.statSync(source).size > MAX_IMAGE) throw new Error('Картинка больше 25 МБ');
    fs.mkdirSync(this.backgroundsDir, { recursive: true });
    for (const old of fs.readdirSync(this.backgroundsDir)) fs.rmSync(path.join(this.backgroundsDir, old), { force: true });
    const name = 'background' + ext;
    fs.copyFileSync(source, path.join(this.backgroundsDir, name));
    this.setAppearance({ background: { type: 'image', value: name, version: Date.now() } });
  }

  removeBackgroundImage() {
    if (fs.existsSync(this.backgroundsDir)) {
      for (const old of fs.readdirSync(this.backgroundsDir)) fs.rmSync(path.join(this.backgroundsDir, old), { force: true });
    }
    // Остальное оформление не трогаем — возвращается только фон по умолчанию.
    this.setAppearance({ background: themes.DEFAULT_APPEARANCE.background });
  }

  backgroundFile(name) {
    if (!/^[\w.-]+$/.test(name)) return null;
    const file = path.join(this.backgroundsDir, name);
    return fs.existsSync(file) ? file : null;
  }

  markIntroSeen() {
    if (this.settings.introSeen) return;
    this.settings.introSeen = true;
    this.saveSettings();
  }

  setRestoreSession(on) {
    this.settings.restoreSession = Boolean(on);
    this.saveSettings();
    this.emit('change');
  }

  // ---------- Сохранённые вкладки ----------

  isSaved(url) {
    const clean = cleanUrl(url);
    return Boolean(clean && this.bookmarks.some((b) => b.url === clean));
  }

  addBookmark({ url, title, favicon }) {
    const clean = cleanUrl(url);
    if (!clean) throw new Error('Сохранять можно только сайты http и https');
    const existing = this.bookmarks.find((b) => b.url === clean);
    if (existing) return existing;
    const bookmark = { id: crypto.randomUUID(), url: clean, title: cleanTitle(title, clean), favicon: cleanFavicon(favicon), created: Date.now() };
    this.bookmarks.unshift(bookmark);
    this.saveBookmarks();
    return bookmark;
  }

  removeBookmark(id) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.saveBookmarks();
  }

  toggleBookmark(tab) {
    const clean = cleanUrl(tab.url);
    if (!clean) throw new Error('Эту страницу нельзя сохранить');
    const existing = this.bookmarks.find((b) => b.url === clean);
    if (existing) this.removeBookmark(existing.id);
    else this.addBookmark(tab);
  }

  renameBookmark(id, title) {
    const bookmark = this.bookmarks.find((b) => b.id === id);
    if (!bookmark) return;
    bookmark.title = cleanTitle(title, bookmark.url);
    this.saveBookmarks();
  }

  // ---------- Группы вкладок ----------

  saveGroup(name, tabs) {
    const items = tabs
      .map((t) => ({ url: cleanUrl(t.url), title: t.title, favicon: cleanFavicon(t.favicon) }))
      .filter((t) => t.url)
      .map((t) => ({ ...t, title: cleanTitle(t.title, t.url) }));
    if (!items.length) throw new Error('Нет открытых сайтов, которые можно сохранить');
    const title = String(name || '').trim().slice(0, 80) || `Вкладки от ${new Date().toLocaleDateString('ru-RU')}`;
    this.groups.unshift({ id: crypto.randomUUID(), title, tabs: items, created: Date.now() });
    this.saveBookmarks();
  }

  removeGroup(id) {
    this.groups = this.groups.filter((g) => g.id !== id);
    this.saveBookmarks();
  }

  // ---------- Прошлый сеанс ----------

  saveSession(urls, activeIndex) {
    this.writeSecure(this.sessionFile, { urls: urls.slice(0, 100), activeIndex });
  }

  loadSession() {
    const saved = this.readSecure(this.sessionFile, null);
    if (!saved || !Array.isArray(saved.urls)) return null;
    const urls = saved.urls.filter((u) => typeof u === 'string' && (cleanUrl(u) || u === 'horizon://start/'));
    return urls.length ? { urls, activeIndex: Number(saved.activeIndex) || 0 } : null;
  }

  // ---------- Для интерфейса ----------

  publicState() {
    const appearance = this.appearance;
    return {
      appearance,
      palette: themes.palette(appearance),
      presets: Object.fromEntries(Object.entries(themes.PRESETS).map(([id, p]) => [id, { name: p.name, bg: p.bg, toolbar: p.toolbar, text: p.text }])),
      accents: themes.ACCENTS,
      gradients: themes.GRADIENTS,
      builtin: themes.BUILTIN,
      bookmarks: this.bookmarks,
      groups: this.groups,
      historyCount: this.history.length,
      restoreSession: this.settings.restoreSession,
    };
  }
}

module.exports = { Profile, cleanUrl };
