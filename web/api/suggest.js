// Подсказки под строкой поиска: /api/suggest?q=
const { search, webUrls, send, text } = require('./_common');

module.exports = (req, res) => send(res, 200, webUrls(search.suggest(text(req.query.q, 200), {})), 'public, s-maxage=3600');
