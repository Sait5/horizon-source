// Сайт-приложение Horizon: заменяет страницам то, что в браузере на компьютере даёт сам браузер.
// Плитки хранятся только на этом телефоне (localStorage), на сервер ничего не уходит.
(function () {
  const KEY = 'horizon-tiles-v1';
  const DEFAULT_TILES = [
    ['YouTube', 'https://youtube.com/'],
    ['ВКонтакте', 'https://vk.com/'],
    ['Telegram', 'https://web.telegram.org/'],
    ['Ozon', 'https://ozon.ru/'],
    ['Wildberries', 'https://wildberries.ru/'],
    ['Википедия', 'https://ru.wikipedia.org/'],
    ['Кинопоиск', 'https://kinopoisk.ru/'],
  ];
  const nativeFetch = window.fetch.bind(window);
  const json = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  function readTiles() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(saved)) return saved;
    } catch {
      // Хранилище недоступно (приватный режим) — показываем набор по умолчанию.
    }
    return DEFAULT_TILES.map(([title, url], i) => ({ id: 'd' + i, title, url, favicon: null }));
  }

  function writeTiles(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 48)));
    } catch {
      // Не сохранилось — останется до перезагрузки.
    }
  }

  function cleanUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function addTile(list, item) {
    const url = cleanUrl(item && item.url);
    if (!url || list.some((b) => b.url === url)) return;
    const host = new URL(url).hostname.replace(/^www\./, '');
    list.push({ id: uid(), url, title: String((item && item.title) || '').trim().slice(0, 60) || host, favicon: null });
  }

  const ROUTES = [
    ['/api?', '/api/search?'],
    ['/resolve?', '/api/resolve?'],
    ['/suggest?', '/api/suggest?'],
    ['/popular.json', '/api/popular'],
    ['/image?', '/api/image?'],
  ];

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('/state.json')) {
      const state = await (await nativeFetch('/default-state.json')).json();
      state.bookmarks = readTiles();
      return json(state);
    }
    if (url.startsWith('/action/')) {
      const action = url.slice(8).split('?')[0];
      let body = {};
      try {
        body = JSON.parse(init.body || '{}');
      } catch {}
      const list = readTiles();
      if (action === 'bookmark-add') addTile(list, body);
      else if (action === 'bookmark-add-many') (body.items || []).slice(0, 60).forEach((item) => addTile(list, item));
      else if (action === 'bookmark-remove') {
        const i = list.findIndex((b) => b.id === String(body.id));
        if (i >= 0) list.splice(i, 1);
      }
      writeTiles(list);
      return json({ ok: true });
    }
    for (const [from, to] of ROUTES) {
      if (url.startsWith(from)) return nativeFetch(to + url.slice(from.length), init);
    }
    return nativeFetch(input, init);
  };

  // Экономия трафика: на мобильном интернете с «Экономией данных» живые волны не грузятся.
  window.HORIZON_SAVE_DATA = Boolean(navigator.connection && navigator.connection.saveData);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
