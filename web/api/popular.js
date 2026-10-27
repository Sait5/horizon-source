// Сайты для окна «Добавить на главную»: /api/popular?q=
const { search, send, text } = require('./_common');

module.exports = (req, res) => send(res, 200, search.popularSites(text(req.query.q, 100)), 'public, s-maxage=3600');
