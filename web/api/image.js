// Картинка для просмотра и скачивания: только http(s), только изображения, до 15 МБ,
// без адресов внутренних сетей.
const { UA, text } = require('./_common');
const safety = require('./_lib/safety');

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[)/i;
const MAX = 15 * 1024 * 1024;

module.exports = async (req, res) => {
  const fail = (status, message) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(message);
  };
  let url;
  try {
    url = new URL(text(req.query.url, 2000));
  } catch {
    return fail(400, 'Неверный адрес картинки');
  }
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname) || !url.hostname.includes('.') || safety.isAdultUrl(url.href)) {
    return fail(400, 'Этот адрес нельзя загрузить');
  }
  try {
    const upstream = await fetch(url.href, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!upstream.ok) return fail(502, `Ошибка ${upstream.status}`);
    if (!type.startsWith('image/')) return fail(502, 'По ссылке не картинка');
    if (Number(upstream.headers.get('content-length') || 0) > MAX) return fail(413, 'Картинка больше 15 МБ');
    const data = Buffer.from(await upstream.arrayBuffer());
    if (data.length > MAX) return fail(413, 'Картинка больше 15 МБ');
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(data);
  } catch (error) {
    fail(502, error.name === 'TimeoutError' ? 'Картинка грузится слишком долго' : 'Не удалось загрузить картинку');
  }
};
