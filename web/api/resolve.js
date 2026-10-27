// Что открыть по Enter: адрес сайта как есть, иначе — страница выдачи.
const { search, webUrls, send, text } = require('./_common');

module.exports = (req, res) => {
  const url = search.resolve(text(req.query.q), {});
  // Открываем только обычные сайты и свою выдачу
  const safe = url && (/^https?:\/\//i.test(url) || url.startsWith('horizon://search/')) ? url : null;
  send(res, 200, webUrls({ url: safe }));
};
