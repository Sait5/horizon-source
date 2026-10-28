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
      if (fixed) correction = { text: fixed, spell: true };
    }
    const text = correction ? correction.text : query;
    // Википедия иногда отвечает с задержкой или просит подождать — одна повторная попытка через секунду
    const wikiFor = (q) => safe(() => verticals.wikiSearch(q, page).catch(() => new Promise((r) => setTimeout(r, 1000)).then(() => verticals.wikiSearch(q, page))), { items: [], total: 0 });
    // Сайты из интернета (Mwmbl и угаданные адреса) приходят отдельным запросом (part=web):
    // основная выдача показывается сразу, а они догружаются, пока человек читает.
    if (base.part === 'web') {
      // Орфография могла «исправить» название сайта («кейсер» → «крейсер»), поэтому ищем и как написано,
      // а адреса угадываем по написанному.
      const texts = correction && correction.spell ? [text, query] : [text];
      const webP = verticals.web ? Promise.all(texts.map((t) => verticals.web(t).catch(() => []))).then((lists) => lists.flat()) : Promise.resolve([]);
      // Проверка адресов стартует, когда индекс ответил (или через 2,5 с): на сервере потоков для DNS мало,
      // и десяток проверок одновременно задерживает основной запрос.
      const guessFor = correction && correction.spell ? query : text;
      const guessP = verticals.guess && page === 1 ? Promise.race([webP, new Promise((r) => setTimeout(r, 2500))]).then(() => verticals.guess(guessFor).catch(() => [])) : Promise.resolve([]);
      const [webAll, guessed] = await Promise.all([webP, guessP]);
      const PER_PAGE = 15;
      const knownHosts = new Set(guessed.map((g) => g.host));
      const seenUrls = new Set();
      const webList = webAll.filter((w) => !knownHosts.has(w.host) && !seenUrls.has(w.url) && seenUrls.add(w.url));
      const web = [...(page === 1 ? guessed : []), ...webList.slice((page - 1) * PER_PAGE, page * PER_PAGE)];
      return { ...base, text, web, webPages: Math.min(10, Math.ceil(webList.length / PER_PAGE)) };
    }
    const wiki = await wikiFor(text);
    const site = search.siteMatch(text);
    const isSite = Boolean(site && site.score >= 64);
    const items = page === 1 ? search.suggest(text, sources(), { limit: 30 }).filter((i) => i.url && i.type !== 'search' && i.type !== 'url') : [];
    // Похожие сайты показываются справа, а слева — только то, что действительно подходит к запросу.
    // Совпадение «с опечаткой» без исправления — скорее другой сайт («кейсер» — не Reuters).
    const sites = items.filter((i) => i.type !== 'related' && !(i.type === 'site' && i.score < 64 && !(correction && !correction.spell)));
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
    if (result.web) result.web = clean(result.web, ['title', 'snippet']);
    if (result.info && safety.isAdultText(result.info.title + ' ' + result.info.extract)) result.info = null;
    return result;
  };
}

module.exports = { createSearchPageData };
