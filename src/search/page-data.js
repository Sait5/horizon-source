// Данные для страницы поиска: вкладки «Всё», «Картинки», «Видео», «Карты», «Финансы», «Товары».
// Общий модуль для браузера на компьютере и для сайта-приложения на телефоне.
const search = require('./suggest');
const safety = require('../safety');

// deps: verticals — источники выдачи; sources() — вкладки, закладки, история (на сайте пусто);
// strict() — убирать ли всё 18+ (детский режим; на сайте — всегда).
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
    let correction = exact ? null : search.correctQuery(query);
    // Обычные слова с опечаткой («барщ», «масква») проверяет орфография; название сайта — каталог.
    // Названия сайтов («авито», «ютуб котики») орфографией не «исправляются».
    const namesSite = query.split(/\s+/).some((word) => {
      const m = search.siteMatch(word);
      return m && m.score >= 80;
    });
    if (!correction && !exact && !namesSite && !search.looksLikeUrl(query)) {
      const fixed = await verticals.spell(query).catch(() => null);
      if (fixed) correction = { text: fixed };
    }
    const text = correction ? correction.text : query;
    // Википедия иногда отвечает с задержкой или просит подождать — одна повторная попытка через секунду
    const wikiFor = (q) => safe(() => verticals.wikiSearch(q, page).catch(() => new Promise((r) => setTimeout(r, 1000)).then(() => verticals.wikiSearch(q, page))), { items: [], total: 0 });
    const wiki = await wikiFor(text);
    const site = search.siteMatch(text);
    const isSite = Boolean(site && site.score >= 64);
    const items = page === 1 ? search.suggest(text, sources(), { limit: 30 }).filter((i) => i.url && i.type !== 'search' && i.type !== 'url') : [];
    // Похожие сайты показываются справа, а слева — только то, что действительно подходит к запросу.
    const sites = items.filter((i) => i.type !== 'related');
    const categoryItem = sites.find((i) => i.category);
    const category = search.findCategory(text) || (categoryItem ? { name: categoryItem.category } : null);
    const info = page === 1 && wiki.items[0] ? await safe(() => verticals.wikiSummary(wiki.items[0].title), {}) : null;
    return {
      ...base,
      text,
      correction,
      calc: search.calculate(query),
      category: category ? category.name : null,
      sites,
      wiki,
      pages: Math.max(1, Math.min(10, Math.ceil((wiki.total || 0) / 10))),
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
    if (result.info && safety.isAdultText(result.info.title + ' ' + result.info.extract)) result.info = null;
    return result;
  };
}

module.exports = { createSearchPageData };
