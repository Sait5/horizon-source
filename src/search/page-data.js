// Данные для страницы поиска: вкладки «Всё», «Картинки», «Видео», «Карты», «Финансы», «Товары».
// Общий модуль для браузера на компьютере и для сайта-приложения на телефоне.
const search = require('./suggest');
const safety = require('../safety');

// deps: verticals — источники выдачи; sources() — вкладки, закладки, история (на сайте пусто);
// strict() — убирать ли всё 18+ (детский режим; на сайте — всегда).
// Статья называется как запрос: «Крейсер», «Аврора (крейсер)» на «аврора», «Кейсер, Марике» на «кейсер».
function namedLike(title, query) {
  const norm = (v) => String(v).toLowerCase().replace(/ё/g, 'е').replace(/\([^)]*\)/g, ' ').split(/[^a-zа-я0-9]+/).filter(Boolean);
  const t = norm(title);
  const q = norm(query);
  return q.length > 0 && q.every((w) => t.includes(w)) && t.length <= q.length + 2;
}

function createSearchPageData({ verticals, sources = () => ({}), strict = () => false }) {
  async function raw(query, tab, page, exact, base) {
    const safe = async (fn, fallback) => {
      try {
        return await fn();
      } catch (error) {
        return { ...fallback, error: error.message };
      }
    };
    if (tab === 'images') return { ...base, images: await safe(() => verticals.images(query, page), { items: [], pages: 0 }) };
    if (tab === 'videos') return { ...base, videos: await safe(() => verticals.videos(query, page), { items: [] }), quick: search.quickSites(`ютуб ${query}`).slice(0, 1) };
    if (tab === 'maps') return { ...base, places: await safe(async () => ({ items: await verticals.places(query) }), { items: [] }) };
    if (tab === 'finance') return { ...base, finance: await safe(() => verticals.finance(query), { rates: [], crypto: [] }), banks: search.relatedSites('банк').items };
    if (tab === 'shop') return { ...base, shops: search.shopSites(query) };

    // Опечатка в названии сайта («ютубе») исправляется сразу; можно вернуться к написанному (&exact=1).
    const correction = exact ? null : search.correctQuery(query);
    const text = correction ? correction.text : query;
    // Википедия иногда отвечает с задержкой или просит подождать — одна повторная попытка через секунду
    const wikiFor = (q) => safe(() => verticals.wikiSearch(q, page).catch(() => new Promise((r) => setTimeout(r, 1000)).then(() => verticals.wikiSearch(q, page))), { items: [], total: 0 });
    // Сайты из интернета (Mwmbl и угаданные адреса) приходят отдельным запросом (part=web):
    // основная выдача показывается сразу, а они догружаются, пока человек читает.
    if (base.part === 'web') {
      const webP = verticals.web ? verticals.web(text).catch(() => []) : Promise.resolve([]);
      // Проверка адресов стартует, когда индекс ответил (или через 2,5 с): на сервере потоков для DNS мало,
      // и десяток проверок одновременно задерживает основной запрос.
      // Точное название сайта из каталога («дота 2» → Dota 2) — угадывать адреса (dota.net…) незачем.
      const known = search.siteMatch(text);
      const guessP = verticals.guess && page === 1 && !(known && known.score >= 100) ? Promise.race([webP, new Promise((r) => setTimeout(r, 2500))]).then(() => verticals.guess(text).catch(() => [])) : Promise.resolve([]);
      const [webAll, guessed] = await Promise.all([webP, guessP]);
      const PER_PAGE = 15;
      const knownHosts = new Set(guessed.map((g) => g.host));
      const seenUrls = new Set();
      const webList = webAll.filter((w) => !knownHosts.has(w.host) && !seenUrls.has(w.url) && seenUrls.add(w.url));
      const web = [...(page === 1 ? guessed : []), ...webList.slice((page - 1) * PER_PAGE, page * PER_PAGE)];
      return { ...base, text, web, webPages: Math.min(10, Math.ceil(webList.length / PER_PAGE)) };
    }
    // Обычные слова с опечаткой («масква») орфография не подменяет, а только предлагает:
    // «кейсер» — это сайт, а не «крейсер». Названия сайтов («авито», «ютуб котики») не проверяются.
    const namesSite = query.split(/\s+/).some((word) => {
      const m = search.siteMatch(word);
      return m && m.score >= 80;
    });
    const spellP = !correction && !exact && !namesSite && !search.looksLikeUrl(query) ? verticals.spell(query).catch(() => null) : Promise.resolve(null);
    const [wikiAll, suggestion] = await Promise.all([page === 1 ? wikiFor(text) : { items: [], total: 0 }, spellP]);
    // Из Википедии — только статьи, которые называются как запрос («крейсер» → «Крейсер»), не больше двух,
    // а не всё, где слово встречается в тексте.
    const wiki = { ...wikiAll, items: wikiAll.items.filter((w) => namedLike(w.title, text)).slice(0, 2) };
    const site = search.siteMatch(text);
    const isSite = Boolean(site && site.score >= 64);
    const items = page === 1 ? search.suggest(text, sources(), { limit: 30 }).filter((i) => i.url && i.type !== 'search' && i.type !== 'url') : [];
    // Похожие сайты показываются справа, а слева — только то, что действительно подходит к запросу.
    // Совпадение «с опечаткой» без исправления — скорее другой сайт («кейсер» — не Reuters).
    const sites = items.filter((i) => i.type !== 'related' && !(i.type === 'site' && i.score < 64 && !correction));
    const categoryItem = sites.find((i) => i.category);
    const category = search.findCategory(text) || (categoryItem ? { name: categoryItem.category } : null);
    // Справка справа — только если статья называется ровно как запрос («Борщ»), а не «Кейсер, Марике».
    const exactTitle = wiki.items[0] && wiki.items[0].title.replace(/\s*\([^)]*\)/g, '').toLowerCase().replace(/ё/g, 'е') === text.trim().toLowerCase().replace(/ё/g, 'е');
    const info = exactTitle && !isSite ? await safe(() => verticals.wikiSummary(wiki.items[0].title), {}) : null;
    return {
      ...base,
      text,
      correction,
      suggestion: suggestion && suggestion.toLowerCase() !== query.toLowerCase() ? suggestion : null,
      calc: search.calculate(query),
      category: category ? category.name : null,
      sites,
      wiki,
      info: info && info.extract ? info : null,
      related: search.relatedSites(text, sites.map((s) => s.url)),
      // Кнопки «искать на сайтах» нужны только для обычных запросов («борщ»), а не для названия сайта.
      quick: isSite ? [] : search.quickSites(text),
    };
  }

  return async function searchPageData(query, tab = 'all', page = 1, exact = false, extra = {}) {
    const kids = strict();
    const base = { query, tab, page, kids, ...extra };
    if (kids && safety.isAdultText(query)) return { ...base, blocked: true };
    const result = await raw(query, tab, page, exact, base);
    if (!kids) return result;
    // Строгий режим: из выдачи убирается всё, что похоже на 18+.
    const clean = (list, fields) => (list || []).filter((item) => !fields.some((f) => safety.isAdultText(item[f])) && !(item.url && safety.isAdultUrl(item.url)));
    if (result.wiki) result.wiki.items = clean(result.wiki.items, ['title', 'snippet']);
    if (result.images) result.images.items = clean(result.images.items, ['title']);
    if (result.videos) result.videos.items = clean(result.videos.items, ['title', 'author']);
    if (result.sites) result.sites = clean(result.sites, ['title']);
    if (result.web) result.web = clean(result.web, ['title', 'snippet']);
    if (result.info && safety.isAdultText(result.info.title + ' ' + result.info.extract)) result.info = null;
    return result;
  };
}

module.exports = { createSearchPageData };
