// Подсказки Horizon: сайты из каталога, сохранённые вкладки, история и открытые вкладки — без чужого поисковика.
// Понимает опечатки, другую раскладку и латиницу вместо кириллицы; на общие слова («новости», «музыка»)
// предлагает сразу много сайтов, а к найденному сайту добавляет похожие.
const { SITES, CATEGORIES } = require('./catalog');
const DESCRIPTIONS = require('./descriptions');

const SEARCH_PAGE = 'horizon://search/?q=';
const RU = 'йцукенгшщзхъфывапролджэячсмитьбю.ё';
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,./`";
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

// Текст, набранный в другой раскладке: «нщгегиу» → «youtube», «dr» → «вк».
function switchLayout(text) {
  let out = '';
  for (const ch of text) {
    const ru = RU.indexOf(ch);
    const en = EN.indexOf(ch);
    out += ru >= 0 ? EN[ru] : en >= 0 ? RU[en] : ch;
  }
  return out;
}

function translit(text) {
  let out = '';
  for (const ch of text) out += TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch;
  return out;
}

// Для сравнения: строчные, «ё» как «е», без пробелов, точек и дефисов.
function squash(text) {
  return String(text).toLowerCase().replace(/ё/g, 'е').replace(/[\s.\-_/()!?,'"«»]+/g, '');
}

// Расстояние между словами с учётом перестановки соседних букв (опечатки «yuotube», «ютбу»).
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev2 = new Array(b.length + 1);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

function allowedTypos(length) {
  if (length < 4) return 0;
  if (length < 6) return 1;
  if (length < 9) return 2;
  return 3;
}

function stripHost(host) {
  return host.replace(/^www\./, '').toLowerCase();
}

function hostOf(url) {
  try {
    return stripHost(new URL(url).host);
  } catch {
    return '';
  }
}

function siteUrl(entry) {
  return 'https://' + entry.host + (entry.host.includes('/') ? '' : '/');
}

function looksLikeUrl(text) {
  return (
    /^(https?|horizon):\/\//i.test(text) ||
    /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(text) ||
    (!/\s/.test(text) && /^[^/]+\.[a-zа-яё]{2,}(:\d+)?(\/.*)?$/i.test(text))
  );
}

function toUrl(text) {
  if (/^(https?|horizon):\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1)/i.test(text)) return 'http://' + text;
  return 'https://' + text;
}

// Варианты того, что человек мог иметь в виду: как набрано, латиницей и в другой раскладке.
// Вариант с другой раскладкой чуть ниже по весу и берётся, только если он похож на слово:
// иначе «вк» превращалось бы в «dr» и находило «Дром».
function queryForms(raw) {
  const lower = raw.toLowerCase().trim();
  const forms = new Map();
  const add = (text, penalty) => {
    const q = squash(text);
    if (q.length >= 1 && (!forms.has(q) || forms.get(q) > penalty)) forms.set(q, penalty);
  };
  add(lower, 0);
  add(translit(lower), 0);
  const switched = switchLayout(lower);
  const cyrillicTyped = /[а-яё]/.test(lower);
  const looksLikeWord = !/[[\];',./`]/.test(switched);
  if (looksLikeWord && (cyrillicTyped ? lower.length >= 4 : lower.length >= 2)) {
    add(switched, 6);
    add(translit(switched), 6);
  }
  return [...forms].map(([q, penalty]) => ({ q, penalty }));
}

function nameForms(names) {
  const out = new Set();
  for (const name of names) {
    const s = squash(name);
    if (!s) continue;
    out.add(s);
    out.add(squash(translit(name.toLowerCase())));
  }
  return [...out];
}

// Насколько название подходит: 100 — точно, 80 — начало, 65 — начало слова, 45 — часть, 40–70 — с опечаткой.
function scoreNames(names, forms) {
  let best = 0;
  const candidates = nameForms(names);
  for (const { q, penalty } of forms) {
    const typos = allowedTypos(q.length);
    const up = (value) => (best = Math.max(best, value - penalty));
    for (const name of candidates) {
      if (name === q) up(100);
      else if (name.startsWith(q)) up(80);
      else if (q.length >= 3 && name.includes(q)) up(45);
      if (typos) {
        const whole = distance(q, name, typos);
        if (whole <= typos) up(72 - whole * 8);
        if (q.length < name.length) {
          const prefix = distance(q, name.slice(0, q.length), typos);
          if (prefix <= Math.max(1, typos - 1)) up(64 - prefix * 8);
        }
      }
    }
  }
  return best;
}

// Насколько сайт подходит к запросу: точное название или другое написание важнее совпадения по адресу
// («google» — это Google, а не Gmail с адресом mail.google.com).
function entryScore(entry, forms) {
  const byName = scoreNames([entry.name, ...entry.aliases], forms);
  const byHost = scoreNames(catalogNames(entry), forms) - 6;
  return Math.max(byName, byHost);
}

function catalogNames(entry) {
  const host = stripHost(entry.host.split('/')[0]);
  const root = host.split('.').length > 2 ? host.split('.').slice(-2)[0] : host.split('.')[0];
  return [entry.name, host, root, host.split('.')[0], ...entry.aliases];
}

// Категория по запросу: «новости», «музыка», «погода»… (с опечатками).
function findCategory(raw) {
  const forms = queryForms(raw);
  let best = null;
  for (const [id, cat] of Object.entries(CATEGORIES)) {
    for (const word of cat.words) {
      const w = squash(word);
      for (const { q } of forms) {
        const typos = Math.min(1, allowedTypos(q.length));
        const d = w === q ? 0 : distance(q, w, typos);
        if (d <= typos && (!best || d < best.d)) best = { id, d };
      }
    }
  }
  if (!best) return null;
  // «авито» похоже на «авто», но это точное название сайта — тогда это не категория.
  if (best.d > 0) {
    const site = siteMatch(raw);
    if (site && site.score >= 80) return null;
  }
  return { id: best.id, ...CATEGORIES[best.id] };
}

// Сначала сайты, для которых категория главная (РБК для «новостей»), потом остальные (Дзен, X).
function sitesIn(categoryId) {
  const main = SITES.filter((s) => s.tags[0] === categoryId);
  const extra = SITES.filter((s) => s.tags[0] !== categoryId && s.tags.includes(categoryId));
  return [...main, ...extra];
}

// Простой калькулятор: «12*(3+4)» → 84. Только числа, скобки и + - * / ^ %.
function calculate(text) {
  const src = String(text || '').replace(/\s+/g, '').replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/');
  if (!/^[\d.+\-*/^%()]+$/.test(src) || !/\d[+\-*/^%]/.test(src)) return null;
  let i = 0;
  const number = () => {
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) throw new Error();
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = () => {
    if (src[i] === '-') {
      i++;
      return -factor();
    }
    if (src[i] === '(') {
      i++;
      const v = expr();
      if (src[i++] !== ')') throw new Error();
      return v;
    }
    return number();
  };
  const power = () => {
    let v = factor();
    while (src[i] === '^') {
      i++;
      v = v ** factor();
    }
    return v;
  };
  const term = () => {
    let v = power();
    while (src[i] && '*/%'.includes(src[i])) {
      const op = src[i++];
      const r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (src[i] === '+' || src[i] === '-') {
      const op = src[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const value = expr();
    if (i !== src.length || !Number.isFinite(value)) return null;
    return Math.round(value * 1e10) / 1e10;
  } catch {
    return null;
  }
}

// «ютуб котики» → поиск «котики» прямо на YouTube (точное название сайта в начале запроса).
function siteSearch(text) {
  const whole = squash(text.toLowerCase());
  if (SITES.some((e) => [e.name, ...e.aliases].some((n) => squash(n.toLowerCase()) === whole))) return null;
  const lower = text.toLowerCase();
  for (const entry of SITES) {
    if (!entry.search) continue;
    for (const name of catalogNames(entry).sort((a, b) => b.length - a.length)) {
      const n = name.toLowerCase();
      if (n.length >= 2 && lower.startsWith(n + ' ') && lower.length > n.length + 1) {
        const query = text.slice(n.length + 1).trim();
        return { entry, query, url: entry.search.replace('{q}', encodeURIComponent(query)) };
      }
    }
  }
  return null;
}

// «погода москва», «музыка linkin park» → категория и запрос для поиска на сайтах этой категории.
function categorySearch(text) {
  const words = text.trim().split(/\s+/);
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const head = words.slice(0, n).join(' ');
    const cat = findCategory(head);
    if (cat) return { category: cat, query: words.slice(n).join(' ') };
  }
  return null;
}

function siteItem(entry, score, type = 'site') {
  return {
    type,
    title: entry.name,
    subtitle: stripHost(entry.host),
    url: siteUrl(entry),
    host: stripHost(entry.host.split('/')[0]),
    desc: DESCRIPTIONS[entry.name] || '',
    score,
  };
}

function suggest(text, { tabs = [], bookmarks = [], history = [] } = {}, { limit = 9 } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const forms = queryForms(raw);
  const items = [];
  const seen = new Set();
  const push = (item) => {
    const key = item.type === 'tab' ? `tab:${item.tabId}` : item.url.replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    items.push(item);
    return true;
  };
  const score = (names) => scoreNames(names, forms);

  const calc = calculate(raw);
  if (calc !== null) items.push({ type: 'calc', title: `= ${calc.toLocaleString('ru-RU')}`, subtitle: raw, url: '', score: 200 });

  if (looksLikeUrl(raw)) {
    const url = toUrl(raw);
    push({ type: 'url', title: raw, subtitle: 'Открыть адрес', url, host: hostOf(url), score: 140 });
  }

  const direct = siteSearch(raw);
  if (direct) {
    push({ type: 'site-search', title: `Найти «${direct.query}» на ${direct.entry.name}`, subtitle: stripHost(direct.entry.host), url: direct.url, host: stripHost(direct.entry.host.split('/')[0]), score: 150 });
  }

  // Категория целиком: «новости» → много новостных сайтов; «погода москва» → поиск на сайтах погоды.
  const category = findCategory(raw);
  const catSearch = !category && !direct ? categorySearch(raw) : null;
  if (category) {
    sitesIn(category.id).forEach((entry, i) => push({ ...siteItem(entry, 90 - i * 0.1), category: category.name }));
  } else if (catSearch) {
    for (const entry of sitesIn(catSearch.category.id)) {
      if (entry.search) {
        push({ type: 'site-search', title: `Найти «${catSearch.query}» на ${entry.name}`, subtitle: stripHost(entry.host), url: entry.search.replace('{q}', encodeURIComponent(catSearch.query)), host: stripHost(entry.host.split('/')[0]), score: 95, category: catSearch.category.name });
      } else {
        push({ ...siteItem(entry, 70), category: catSearch.category.name });
      }
    }
  }

  for (const tab of tabs) {
    if (!/^https?:/.test(tab.url)) continue;
    const s = score([tab.title || '', hostOf(tab.url)]);
    if (s >= 45) push({ type: 'tab', title: tab.title || hostOf(tab.url), subtitle: 'Перейти на открытую вкладку', url: tab.url, host: hostOf(tab.url), tabId: tab.id, favicon: tab.favicon, score: s + 5 });
  }
  for (const b of bookmarks) {
    const s = score([b.title, hostOf(b.url), hostOf(b.url).split('.')[0]]);
    if (s >= 45) push({ type: 'bookmark', title: b.title, subtitle: hostOf(b.url), url: b.url, host: hostOf(b.url), favicon: b.favicon, score: s + 12 });
  }
  for (const h of history) {
    const s = score([h.title || '', hostOf(h.url), hostOf(h.url).split('.')[0]]);
    if (s >= 45) push({ type: 'history', title: h.title || hostOf(h.url), subtitle: hostOf(h.url), url: h.url, host: hostOf(h.url), score: s + Math.min(10, Math.log2(1 + (h.visits || 1)) * 3) });
  }
  const matched = [];
  for (const entry of SITES) {
    const s = entryScore(entry, forms);
    if (s >= 40 && push(siteItem(entry, s))) matched.push({ entry, s });
  }

  let ranked = items.sort((a, b) => b.score - a.score).slice(0, limit);

  // Похожие сайты к лучшему совпадению: YouTube → Rutube, VK Видео, Twitch…
  const best = matched.sort((a, b) => b.s - a.s)[0];
  if (best && best.s >= 64 && !category && ranked.length < limit) {
    const tag = best.entry.tags[0];
    const related = tag ? sitesIn(tag).filter((e) => e !== best.entry) : [];
    for (const entry of related.slice(0, limit - ranked.length)) {
      const item = { ...siteItem(entry, 10, 'related'), category: CATEGORIES[tag].name };
      const key = item.url.replace(/\/$/, '');
      if (!seen.has(key)) {
        seen.add(key);
        ranked.push(item);
      }
    }
    ranked = ranked.slice(0, limit);
  }

  ranked.push({
    type: 'search',
    title: `Искать «${raw}»`,
    subtitle: category ? `Все сайты: ${category.name.toLowerCase()}` : 'Сайты, Википедия и поиск по сайтам',
    url: SEARCH_PAGE + encodeURIComponent(raw),
    score: 0,
  });
  return ranked;
}

// Что открыть по Enter: адрес, поиск на сайте, точно подходящий сайт — иначе страницу поиска Horizon
// с вариантами. На общие слова («новости») Horizon не выбирает за человека один сайт.
function resolve(text, sources) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // Сам браузер на сайт не перескакивает: по Enter — выдача Horizon, где первым стоит нужный сайт.
  // Сразу открывается только явно введённый адрес (youtube.com) или выбранная подсказка.
  if (looksLikeUrl(raw)) return toUrl(raw);
  return SEARCH_PAGE + encodeURIComponent(raw);
}

// Кнопки «искать на сайте» для страницы поиска: под категорию запроса или общий набор.
function quickSites(text) {
  const cat = findCategory(text) || (categorySearch(text) || {}).category;
  const query = (categorySearch(text) || {}).query || text;
  const pool = cat ? sitesIn(cat.id).filter((e) => e.search) : [];
  // Для обычного запроса — сайты, где о нём можно почитать или посмотреть, а не магазины.
  const defaults = ['YouTube', 'Википедия', 'VK Видео', 'Дзен', 'Пикабу', 'Reddit']
    .map((name) => SITES.find((e) => e.name === name))
    .filter((e) => e && e.search);
  return [...new Set([...pool, ...defaults])]
    .slice(0, 12)
    .map((e) => ({ name: e.name, host: stripHost(e.host.split('/')[0]), url: e.search.replace('{q}', encodeURIComponent(query)) }));
}

// Сайты для окна «Добавить плитки»: популярные или найденные по запросу (с опечатками).
const POPULAR = ['YouTube', 'ВКонтакте', 'Telegram', 'WhatsApp', 'Gmail', 'Mail.ru Почта', 'Ozon', 'Wildberries', 'Avito',
  'Кинопоиск', 'ChatGPT', 'Claude', 'DeepSeek', 'GitHub', 'Twitch', 'Steam', 'Spotify', 'Rutube', 'Википедия', 'Госуслуги',
  'Сбербанк', 'Т-Банк', '2ГИС', 'TikTok', 'Instagram', 'Reddit', 'Discord', 'hh.ru', 'Пикабу', 'Хабр', 'AliExpress'];

function popularSites(text) {
  const query = String(text || '').trim();
  const pick = (entry) => ({ name: entry.name, host: stripHost(entry.host.split('/')[0]), url: siteUrl(entry) });
  if (query) {
    return suggest(query, {}, { limit: 24 })
      .filter((i) => i.type === 'site' || i.type === 'related')
      .map((i) => ({ name: i.title, host: i.host, url: i.url }));
  }
  return POPULAR.map((name) => SITES.find((s) => s.name === name)).filter(Boolean).map(pick);
}

// Магазины для вкладки «Товары»: поиск запроса прямо в каждом магазине.
function shopSites(text) {
  const query = String(text || '').trim();
  const shops = SITES.filter((s) => s.search && (s.tags.includes('shop') || s.tags.includes('electronics')));
  return shops.map((e) => ({ name: e.name, host: stripHost(e.host.split('/')[0]), url: e.search.replace('{q}', encodeURIComponent(query)) }));
}

// Похожие сайты для правой колонки: из той же категории, что и запрос или найденный сайт.
function relatedSites(text, exclude = []) {
  const cat = findCategory(text) || (categorySearch(text) || {}).category;
  let tag = cat ? cat.id : null;
  let fromSite = false;
  if (!tag) {
    fromSite = true;
    const best = suggest(text, {}, { limit: 3 }).find((i) => i.type === 'site');
    const entry = best && SITES.find((s) => s.name === best.title);
    tag = entry && entry.tags[0];
  }
  if (!tag) return { title: 'Популярные сайты', items: popularSites('').slice(0, 8) };
  const skip = new Set(exclude.map((u) => u.replace(/\/$/, '')));
  return {
    title: fromSite ? 'Похожие сайты' : `Ещё: ${CATEGORIES[tag].name.toLowerCase()}`,
    items: sitesIn(tag).map((e) => ({ name: e.name, host: stripHost(e.host.split('/')[0]), url: siteUrl(e) })).filter((s) => !skip.has(s.url.replace(/\/$/, ''))).slice(0, 10),
  };
}

// Сайт, который человек скорее всего имел в виду (с опечатками и другой раскладкой).
function siteMatch(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const forms = queryForms(text);
  let best = null;
  for (const entry of SITES) {
    const s = entryScore(entry, forms);
    if (!best || s > best.s) best = { entry, s };
  }
  return best && best.s >= 40 ? { name: best.entry.name, score: best.s, entry: best.entry } : null;
}

// Исправление опечатки в названии сайта: «ютубе», «yuotube», «нщгегиу» → «YouTube».
// Если набрано без ошибки (точно или начало названия) — исправлять нечего.
function correctQuery(raw) {
  const text = String(raw || '').trim();
  if (text.length < 3 || text.split(/\s+/).length > 3 || looksLikeUrl(text) || findCategory(text) || siteSearch(text)) return null;
  const best = siteMatch(text);
  if (!best || best.score < 56) return null;
  const lower = text.toLowerCase();
  const typed = [squash(lower), squash(translit(lower))];
  const asTyped = nameForms(catalogNames(best.entry)).some((n) => typed.some((q) => n === q || (q.length >= 2 && n.startsWith(q))));
  return asTyped ? null : { text: best.name };
}

module.exports = { shopSites, relatedSites, popularSites, suggest, resolve, quickSites, calculate, switchLayout, looksLikeUrl, findCategory, siteMatch, correctQuery, SEARCH_PAGE };
