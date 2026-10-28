// Выдача: /api/search?q=&tab=&page=&exact=1. Одинаковые запросы кешируются на 5 минут в CDN.
const { searchPageData, webUrls, send, text } = require('./_common');

const TABS = ['all', 'images', 'videos', 'maps', 'finance', 'shop'];

module.exports = async (req, res) => {
  const query = text(req.query.q);
  const tab = TABS.includes(text(req.query.tab)) ? text(req.query.tab) : 'all';
  const page = Math.max(1, Math.min(50, Number(text(req.query.page)) || 1));
  try {
    const data = await searchPageData(query, tab, page, text(req.query.exact) === '1', { part: text(req.query.part) === 'web' ? 'web' : null });
    send(res, 200, webUrls(data), 'public, s-maxage=300, stale-while-revalidate=900');
  } catch (error) {
    send(res, 500, { query, tab, page, error: error.message });
  }
};
