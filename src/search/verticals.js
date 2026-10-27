// Вкладки поиска Horizon: статьи, картинки, видео, карты и финансы из открытых бесплатных источников.
// Все запросы идут через сеанс браузера (с VPN, если он включён). Взрослый контент отфильтровывается.
const enc = encodeURIComponent;

function strip(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CURRENCY_WORDS = [
  [/^(usd|\$|доллар|бакс)/i, 'USD'],
  [/^(eur|€|евро)/i, 'EUR'],
  [/^(cny|юан)/i, 'CNY'],
  [/^(rub|₽|руб)/i, 'RUB'],
  [/^(kzt|тенге)/i, 'KZT'],
  [/^(uah|гривн)/i, 'UAH'],
  [/^(gbp|фунт)/i, 'GBP'],
  [/^(try|лир)/i, 'TRY'],
  [/^(jpy|йен|иен)/i, 'JPY'],
  [/^(byn|белорус)/i, 'BYN'],
];

function currencyCode(word) {
  for (const [re, code] of CURRENCY_WORDS) if (re.test(word)) return code;
  return null;
}

// «100 долларов в рублях», «50 eur to usd», «1000 ₽ в тенге»
function parseConversion(text) {
  const m = /^(\d+(?:[.,]\d+)?)\s*([^\d\s]+)\s+(?:в|во|to|in|=)\s+([^\d\s]+)/i.exec(String(text || '').trim());
  if (!m) return null;
  const from = currencyCode(m[2]);
  const to = currencyCode(m[3]);
  return from && to ? { amount: parseFloat(m[1].replace(',', '.')), from, to } : null;
}

function createVerticals(fetchJson) {
  const cache = new Map();
  async function cached(key, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < 5 * 60 * 1000) return hit.value;
    const value = await fn();
    cache.set(key, { time: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  }

  async function wikiSearch(query, page) {
    return cached(`wiki:${query}:${page}`, async () => {
      const data = await fetchJson(`https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(query)}&srlimit=10&sroffset=${(page - 1) * 10}&format=json&srprop=snippet&srinfo=totalhits%7Csuggestion`);
      const info = (data.query && data.query.searchinfo) || {};
      return {
        total: info.totalhits || 0,
        suggestion: info.suggestion || null, // «барщ» → «борщ»
        items: ((data.query && data.query.search) || []).map((s) => ({
          title: s.title,
          snippet: strip(s.snippet),
          url: `https://ru.wikipedia.org/wiki/${enc(s.title.replace(/ /g, '_'))}`,
          host: 'ru.wikipedia.org',
          source: 'Википедия',
        })),
      };
    });
  }

  // Проверка орфографии запроса (бесплатный LanguageTool): «барщ рецепт» → «борщ рецепт».
  // Исправляются только опечатки, а не регистр и знаки препинания.
  async function spell(query) {
    if (!/[а-яё]{3}/i.test(query) || query.length > 120) return null;
    return cached(`spell:${query}`, async () => {
      const d = await fetchJson(`https://api.languagetool.org/v2/check?language=ru-RU&text=${enc(query)}`);
      let out = '';
      let pos = 0;
      for (const m of (d.matches || []).filter((x) => x.rule && x.rule.issueType === 'misspelling' && x.replacements && x.replacements[0])) {
        const word = query.substr(m.offset, m.length);
        let fix = m.replacements[0].value;
        if (word === word.toLowerCase()) fix = fix.toLowerCase();
        out += query.slice(pos, m.offset) + fix;
        pos = m.offset + m.length;
      }
      out += query.slice(pos);
      return out !== query ? out : null;
    });
  }

  async function wikiSummary(title) {
    return cached(`sum:${title}`, async () => {
      const d = await fetchJson(`https://ru.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, '_'))}`);
      return {
        title: d.title,
        description: d.description || '',
        extract: d.extract || '',
        image: d.thumbnail ? d.thumbnail.source : null,
        url: d.content_urls && d.content_urls.desktop ? d.content_urls.desktop.page : null,
      };
    });
  }

  // Openverse без ключа отдаёт не больше 20 картинок за раз и иногда не отвечает —
  // тогда берём картинки из Wikimedia Commons.
  async function openverse(query, page) {
    const d = await fetchJson(`https://api.openverse.org/v1/images/?q=${enc(query)}&page=${page}&page_size=20&mature=false`);
    return {
      total: d.result_count || 0,
      pages: Math.min(d.page_count || 1, 12),
      source: 'Openverse',
      items: (d.results || []).map((r) => ({
        thumb: r.thumbnail,
        full: r.url,
        page: r.foreign_landing_url || r.url,
        title: r.title || '',
        author: r.creator || '',
        width: r.width,
        height: r.height,
      })),
    };
  }

  const ADULT = /nud|naked|nsfw|porn|erot|sex|xxx|topless|lingerie|голая|голый|обнаж|эрот|порн|секс/i;
  async function commons(query, page) {
    const search = `filetype:bitmap ${query} -nude -naked -erotic -porn -sex -nsfw`;
    const d = await fetchJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${enc(search)}&gsrnamespace=6&gsrlimit=30&gsroffset=${(page - 1) * 30}&prop=imageinfo&iiprop=url%7Cuser%7Csize&iiurlwidth=400&format=json&formatversion=2`);
    const items = ((d.query && d.query.pages) || [])
      .sort((a, b) => a.index - b.index)
      .filter((p) => p.imageinfo && p.imageinfo[0] && p.imageinfo[0].thumburl && !ADULT.test(p.title))
      .map((p) => {
        const info = p.imageinfo[0];
        return {
          thumb: info.thumburl,
          full: info.url,
          page: `https://commons.wikimedia.org/wiki/${enc(p.title.replace(/ /g, '_'))}`,
          title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''),
          author: info.user || '',
          width: info.width,
          height: info.height,
        };
      });
    return { total: null, pages: d.continue ? Math.min(page + 1, 12) : page, source: 'Wikimedia Commons', items };
  }

  // Оба источника спрашиваются сразу, показывается тот, что первым ответил с картинками.
  let openverseDownUntil = 0;
  async function images(query, page) {
    return cached(`img:${query}:${page}`, async () => {
      const withItems = (promise) => promise.then((r) => (r.items.length ? r : Promise.reject(new Error('пусто'))));
      const sources = [withItems(commons(query, page))];
      if (Date.now() > openverseDownUntil) {
        sources.push(
          withItems(openverse(query, page)).catch((error) => {
            // Openverse не отвечает — 10 минут его не спрашиваем.
            if (error.message !== 'пусто') openverseDownUntil = Date.now() + 10 * 60 * 1000;
            throw error;
          }),
        );
      }
      try {
        return await Promise.any(sources);
      } catch {
        return { total: 0, pages: 0, items: [] };
      }
    });
  }

  async function videos(query, page) {
    return cached(`vid:${query}:${page}`, async () => {
      const [rutube, daily] = await Promise.allSettled([
        fetchJson(`https://rutube.ru/api/search/video/?query=${enc(query)}&page=${page}`),
        fetchJson(`https://api.dailymotion.com/videos?search=${enc(query)}&limit=12&page=${page}&family_filter=true&fields=id,title,thumbnail_360_url,duration,url,owner.screenname`),
      ]);
      const list = [];
      if (rutube.status === 'fulfilled') {
        for (const v of (rutube.value.results || []).slice(0, 20)) {
          if (v.is_adult || v.is_hidden || v.is_deleted) continue;
          list.push({ title: v.title, thumb: v.thumbnail_url, url: v.video_url, duration: v.duration, author: v.author && v.author.name, source: 'Rutube' });
        }
      }
      if (daily.status === 'fulfilled') {
        for (const v of daily.value.list || []) {
          list.push({ title: v.title, thumb: v.thumbnail_360_url, url: v.url, duration: v.duration, author: v['owner.screenname'], source: 'Dailymotion' });
        }
      }
      // Перемешиваем источники через одного, чтобы выдача была разнообразной
      const a = list.filter((v) => v.source === 'Rutube');
      const b = list.filter((v) => v.source === 'Dailymotion');
      const mixed = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i]) mixed.push(a[i]);
        if (b[i]) mixed.push(b[i]);
      }
      return { items: mixed, more: mixed.length >= 10 };
    });
  }

  async function places(query) {
    return cached(`map:${query}`, async () => {
      const d = await fetchJson(`https://nominatim.openstreetmap.org/search?q=${enc(query)}&format=jsonv2&limit=8&accept-language=ru`);
      return (Array.isArray(d) ? d : []).map((p) => ({
        name: p.display_name,
        short: p.name || p.display_name.split(',')[0],
        type: p.type,
        lat: Number(p.lat),
        lon: Number(p.lon),
        bbox: (p.boundingbox || []).map(Number), // юг, север, запад, восток
      }));
    });
  }

  async function finance(query) {
    const [fiat, crypto] = await Promise.allSettled([
      cached('rates', () => fetchJson('https://open.er-api.com/v6/latest/USD')),
      cached('crypto', () => fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,the-open-network,solana&vs_currencies=rub,usd&include_24hr_change=true')),
    ]);
    const result = { rates: [], crypto: [], conversion: null };
    if (fiat.status === 'fulfilled' && fiat.value.rates) {
      const r = fiat.value.rates;
      const inRub = (code) => r.RUB / r[code];
      result.rates = ['USD', 'EUR', 'CNY', 'KZT', 'TRY'].filter((c) => r[c]).map((code) => ({ code, rub: inRub(code) }));
      const conv = parseConversion(query);
      if (conv && r[conv.from] && r[conv.to]) {
        result.conversion = { ...conv, value: (conv.amount / r[conv.from]) * r[conv.to] };
      }
      result.updated = fiat.value.time_last_update_utc;
    }
    if (crypto.status === 'fulfilled') {
      const names = { bitcoin: 'Bitcoin', ethereum: 'Ethereum', 'the-open-network': 'Toncoin', solana: 'Solana' };
      result.crypto = Object.entries(crypto.value).map(([id, v]) => ({ name: names[id] || id, rub: v.rub, usd: v.usd, change: v.rub_24h_change }));
    }
    return result;
  }

  return { wikiSearch, wikiSummary, spell, images, videos, places, finance, clearCache: () => cache.clear() };
}

module.exports = { createVerticals, parseConversion };
