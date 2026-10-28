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

// Кириллица латиницей — для поиска адресов («кейсер» → keyser) и англоязычного индекса.
const LATIN = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const latin = (text) => [...String(text).toLowerCase()].map((ch) => (LATIN[ch] !== undefined ? LATIN[ch] : ch)).join('');

// Русские слова, которые на сайтах (особенно игровых) пишут по-английски: «кейсы кс2» → «cases cs2».
const ENGLISH = {
  кс: 'cs', кс2: 'cs2', ксго: 'csgo', го: 'go', кейс: 'case', кейсы: 'cases', кейсов: 'cases', открытие: 'opening', открыть: 'open',
  маркет: 'market', скин: 'skin', скины: 'skins', скинов: 'skins', апгрейд: 'upgrade', апгрейдер: 'upgrader', апгрейды: 'upgrade',
  игра: 'game', игры: 'games', игр: 'games', рулетка: 'roulette', трейд: 'trade', обмен: 'trade', батл: 'battle', дроп: 'drop',
  дота: 'dota', майнкрафт: 'minecraft', роблокс: 'roblox', фортнайт: 'fortnite', стим: 'steam', варфейс: 'warface', танки: 'tanks',
  бесплатно: 'free', бесплатные: 'free', онлайн: 'online', магазин: 'shop', яндекс: 'yandex', новости: 'news', погода: 'weather',
  музыка: 'music', фильмы: 'movies', кино: 'movies', аниме: 'anime', карты: 'maps', почта: 'mail', переводчик: 'translate', сайт: '', сайты: '',
};
// Английские корни, записанные по-русски: «кейсер» → caser, «кейсбатл» → casebattle, «скинстейк» → skinsteak.
const STEMS = [
  ['апгрейд', 'upgrade'], ['маркет', 'market'], ['кейс', 'case'], ['скин', 'skin'], ['дроп', 'drop'], ['трейд', 'trade'],
  ['батл', 'battle'], ['гейм', 'game'], ['плей', 'play'], ['стейк', 'steak'], ['лаки', 'lucky'], ['фарм', 'farm'],
  ['чек', 'check'], ['шоп', 'shop'], ['хаб', 'hub'], ['бокс', 'box'], ['ган', 'gun'], ['вин', 'win'], ['фаст', 'fast'],
  ['кс', 'cs'], ['бет', 'bet'], ['топ', 'top'], ['лайв', 'live'], ['стор', 'store'],
];
const ENDINGS = [['ер', 'er'], ['еры', 'ers'], ['ы', 's'], ['с', 's'], ['', '']];
function englishWord(word) {
  if (ENGLISH[word] !== undefined) return ENGLISH[word];
  let out = '';
  let rest = word;
  // Слово целиком из корней и окончания: «кейс»+«ер», «кейс»+«батл»
  while (rest) {
    const stem = STEMS.find(([ru]) => rest.startsWith(ru));
    if (stem) {
      out += stem[1];
      rest = rest.slice(stem[0].length);
      continue;
    }
    const ending = ENDINGS.find(([ru]) => ru && rest === ru);
    if (ending && out) return out.replace(/e$/, '') + (ending[1].startsWith('e') ? ending[1] : out.endsWith('e') ? 'e' + ending[1] : ending[1]);
    return null;
  }
  return out || null;
}
function english(query) {
  const words = String(query).toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  const mapped = words.map(englishWord);
  if (!mapped.some((w) => w !== null)) return null;
  return words.map((w, i) => (mapped[i] !== null ? mapped[i] : latin(w))).filter(Boolean).join(' ');
}

// Заголовки страниц защиты от роботов и ошибок
// Захваченные домены со спамом онлайн-казино («Bandar Togel», «slots online») — не сайты, которые искали.
const SPAM_TITLE = /togel|bandar|judi |gacor|slots? online|online slots?|situs |kupontoto|casino online|онлайн[- ]казино|казино онлайн/i;

const PROTECTION_TITLE =/just a moment|attention required|access denied|forbidden|^40\d|^50\d|ddos-guard|checking your browser|капча|captcha|are you a robot|вы не робот/i;

// Страницы на чужих языках («yandex.com/games/zh/…») русскому читателю не нужны.
const FOREIGN_LOCALES = new Set(['zh', 'hi', 'he', 'th', 'ja', 'ko', 'ar', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'tr', 'vi', 'id', 'fa', 'nl', 'sv', 'ro', 'hu', 'el', 'bn', 'ms', 'zh-cn', 'zh-tw', 'pt-br', 'es-es', 'fr-fr', 'de-de', 'ja-jp', 'ko-kr']);

// Возможные адреса сайта по словам запроса: «market csgo» → market.csgo.com, csgo.market, marketcsgo.com…
const TLDS = ['com', 'ru', 'net', 'gg', 'io', 'org', 'pro', 'one', 'me', 'fun'];
const TLD_WORDS = new Set(['market', 'shop', 'store', 'games', 'game', 'live', 'pro', 'net', 'org', 'io', 'gg', 'ru', 'com', 'app', 'online', 'site', 'club', 'fun', 'top', 'win', 'bet', 'case', 'cases']);
function guessHosts(query) {
  const words = latin(query).split(/[^a-z0-9]+/).filter((w) => w.length >= 2).slice(0, 3);
  if (!words.length || words.join('').length < 4) return [];
  const hosts = new Set();
  const joined = words.join('');
  for (const tld of TLDS.slice(0, words.length === 1 ? 10 : 3)) hosts.add(`${joined}.${tld}`);
  if (words.length === 2) {
    const [a, b] = words;
    hosts.add(`${a}-${b}.com`);
    hosts.add(`${a}.${b}.com`);
    hosts.add(`${b}.${a}.com`);
    if (TLD_WORDS.has(a)) hosts.add(`${b}.${a}`);
    if (TLD_WORDS.has(b)) hosts.add(`${a}.${b}`);
  }
  return [...hosts].slice(0, 14);
}

// fetchJson — запрос JSON; probe(url) → { url, title } если сайт открывается, иначе null.
function createVerticals(fetchJson, probe = null) {
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
        // Короткие слова и сокращения («гта», «кс», «дс») — не опечатки: «гта 5» не «гто 5».
        if (word.length <= 3) continue;
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

  // Сайты из интернета: открытый поисковик Mwmbl (бесплатно, без ключей). Для русских запросов —
  // ещё и латиницей, потому что его индекс в основном англоязычный.
  // Варианты запроса для открытого индекса: как написано, латиницей, по-английски и в обратном порядке слов
  // («market csgo» индекс не знает, а «csgo market» — знает).
  function variants(query) {
    const swap = (v) => {
      const words = v.split(/\s+/);
      return words.length === 2 ? `${words[1]} ${words[0]}` : null;
    };
    const en = english(query);
    // Самые полезные — первыми: английский вариант находит игровые сайты лучше всего.
    const out = [query];
    if (en) out.push(en, swap(en), en.replace(/\b(cases|skins|games)\b/g, (w) => w.slice(0, -1)));
    if (/[а-яё]/i.test(query)) out.push(latin(query));
    out.push(swap(query));
    return [...new Set(out.filter(Boolean))].slice(0, 6);
  }

  async function web(query) {
    return cached(`web:${query}`, async () => {
      const lists = await Promise.allSettled(variants(query).map((v) => fetchJson(`https://api.mwmbl.org/search?s=${enc(v)}`)));
      const tokens = [...new Set(variants(query).join(' ').toLowerCase().split(/[^a-zа-яё0-9]+/).filter((w) => w.length >= 2))];
      const seen = new Set();
      const perHost = new Map();
      const items = [];
      const text = (parts) => (Array.isArray(parts) ? parts.map((p) => p.value).join('') : String(parts || '')).replace(/\s+/g, ' ').trim();
      lists.forEach((list, order) => {
        if (list.status !== 'fulfilled' || !Array.isArray(list.value)) return;
        list.value.forEach((r, rank) => {
          let u;
          try {
            u = new URL(r.url);
          } catch {
            return;
          }
          if (!/^https?:$/.test(u.protocol)) return;
          const segments = u.pathname.toLowerCase().split('/').filter(Boolean);
          if (segments.some((p) => FOREIGN_LOCALES.has(p))) return;
          const host = u.hostname.toLowerCase().replace(/^www\./, '');
          // SEO-зеркала чужих сайтов: csgocases.com.statvoo.com
          if (/\.(com|net|org|ru|su|ua|io|gg|pro|shop|online|site|tv|me|club|info|xyz|top|cc|co)$/.test(host.split('.').slice(0, -2).join('.'))) return;
          // Спам на чужих поддоменах: gifuwq7100.nordiskmytologi.se, troy03bp9.ssnblog.com
          if (host.split('.').length > 2 && /^(?=.*\d.*\d)(?=.*[a-z])[a-z0-9]{6,}$/.test(host.split('.')[0])) return;
          if (SPAM_TITLE.test(r.title ? text(r.title) : '')) return;
          const key = host + u.pathname.replace(/\/$/, '') + u.search;
          if (seen.has(key)) return;
          seen.add(key);
          // С одного сайта — не больше двух ссылок, чтобы выдача не состояла из одного Яндекса.
          const count = perHost.get(host) || 0;
          if (count >= 2) return;
          perHost.set(host, count + 1);
          // Заголовок страницы проверки на робота («Ой, Капча!») — не название сайта.
          const rawTitle = text(r.title);
          const title = !rawTitle || PROTECTION_TITLE.test(rawTitle) ? host : rawTitle;
          // На русский запрос — без копий тех же страниц на украинском («Ігри… На Яндекс Игры»).
          if (/[а-яё]/i.test(query) && /[іїєґ]/i.test(title)) return;
          // Выше — сайты, в адресе которых есть слово запроса, и главные страницы сайтов.
          const score = (tokens.some((t) => host.includes(t)) ? 30 : 0) + (segments.length === 0 ? 15 : 0) + (tokens.some((t) => title.toLowerCase().includes(t)) ? 5 : 0) - rank - order * 2;
          items.push({ title, url: r.url, host, snippet: text(r.extract), source: 'web', score });
        });
      });
      return items.sort((x, y) => y.score - x.score).slice(0, 60).map(({ score, ...item }) => item);
    });
  }

  // Сайты, найденные по адресу: проверяем, открываются ли угаданные адреса (по 6 одновременно).
  async function guess(query) {
    if (!probe) return [];
    return cached(`guess:${query}`, async () => {
      const en = english(query);
      const hosts = [...new Set([...guessHosts(query), ...(en ? guessHosts(en) : [])])].slice(0, 24);
      const found = new Array(hosts.length).fill(null);
      let next = 0;
      const worker = async () => {
        while (next < hosts.length) {
          const i = next++;
          found[i] = await probe(`https://${hosts[i]}/`).catch(() => null);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      const seen = new Set();
      // Домены на продажу: переадресация на чужой сайт (upgrader.org → atom.com) или «domain for sale» в заголовке.
      const parked = (r, i) => {
        const name = hosts[i].split('.')[0];
        const finalHost = new URL(r.url).hostname.toLowerCase();
        return !finalHost.includes(name) || /for sale|is parked|buy this domain|домен продаётся|домен продается|купить домен|parking|hosted by|suspended|coming soon|under construction|default page|welcome to nginx|index of \/|this domain|домен припаркован|сайт в разработке|сайт временно/i.test(r.title);
      };
      // Выше — сайты с настоящим названием, где есть слово запроса; домены без названия — в конце, не больше двух.
      const wordsOf = (v) => String(v || '').toLowerCase().split(/[^a-zа-яё0-9]+/).filter((w) => w.length >= 3);
      const has = (r, v) => wordsOf(v).some((w) => r.title.toLowerCase().includes(w));
      // «кейсер»: caser.one («КЕЙСЕР (CASER) — Официальный сайт») выше keyser.com (недвижимость в Аризоне).
      const rank = (r) => (r.title ? 2 : 0) + (has(r, query) ? 4 : 0) + (has(r, en) ? 3 : 0) + (has(r, latin(query)) ? 2 : 0) + (/[а-яё]/i.test(query) && /[а-яё]/i.test(r.title) ? 1 : 0);
      const list = found
        .map((r, i) => (r && !parked(r, i) ? r : null))
        .filter(Boolean)
        .sort((a, b) => rank(b) - rank(a));
      let untitled = 0;
      return list
        .filter((r) => !SPAM_TITLE.test(r.title))
        .filter((r) => r.title || untitled++ < 2)
        .map((r) => ({ title: r.title || new URL(r.url).hostname, url: r.url, host: new URL(r.url).hostname.replace(/^www\./, ''), snippet: '', source: 'guess' }))
        .filter((r) => !seen.has(r.host) && seen.add(r.host));
    });
  }

  return { wikiSearch, wikiSummary, spell, images, videos, places, finance, web, guess, clearCache: () => cache.clear() };
}

module.exports = { createVerticals, parseConversion, guessHosts, PROTECTION_TITLE };
