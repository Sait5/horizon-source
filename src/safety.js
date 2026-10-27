// Детский режим (аккаунт младше 18 лет): сайты и запросы для взрослых закрыты.
// Список — крупнейшие сайты 18+ и слова, по которым такие сайты обычно узнаются по адресу.
const ADULT_HOSTS = [
  'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com', 'youporn.com', 'tube8.com', 'spankbang.com',
  'eporner.com', 'tnaflix.com', 'porntrex.com', 'beeg.com', 'txxx.com', 'hqporner.com', 'chaturbate.com', 'stripchat.com',
  'bongacams.com', 'livejasmin.com', 'cam4.com', 'camsoda.com', 'myfreecams.com', 'onlyfans.com', 'fansly.com', 'brazzers.com',
  'nhentai.net', 'hentaihaven.xxx', 'rule34.xxx', 'e-hentai.org', 'motherless.com', 'porn.com', 'fapello.com', 'thothub.to',
];
const ADULT_HOST_WORDS = /(^|[.-])(porn|xxx|sex|hentai|xvideo|xnxx|xhamster|nsfw|fetish|escort|camgirl|onlyfans)|porno|секс|порно/i;
const ADULT_TEXT = /\b(porn\w*|xxx|nsfw|hentai|onlyfans|nude\w*|naked|erotic\w*|sex(y|ual)?|fetish\w*|escort\w*|milf|bdsm)\b|порн\w*|эрот\w*|секс\w*|голая|голые|обнажён\w*|обнажен\w*|интим\w*|18\+|хентай|проститу\w*/i;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isAdultUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (ADULT_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return true;
  return ADULT_HOST_WORDS.test(host) || /\.(xxx|porn|sex|adult)$/.test(host);
}

function isAdultText(text) {
  return ADULT_TEXT.test(String(text || ''));
}

module.exports = { isAdultUrl, isAdultText };
