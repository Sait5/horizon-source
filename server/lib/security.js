// Пароли, коды и токены сеансов. Пароли хранятся только как scrypt-хеш, коды и токены — как sha256.
const crypto = require('node:crypto');

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password).normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function checkPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, expected);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Код из письма хранится с «перцем» сервера: украденная база не даёт подобрать коды.
function hashCode(code, email, secret) {
  return sha256(`${secret}:${email}:${code}`);
}

function newCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const COMMON = ['12345678', '123456789', '1234567890', 'password', 'qwerty123', 'qwertyuiop', '11111111', 'пароль123', 'iloveyou', '1q2w3e4r'];

function passwordProblem(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Пароль должен быть не короче 8 символов';
  if (value.length > 200) return 'Пароль слишком длинный';
  if (new Set(value).size < 4) return 'В пароле слишком мало разных символов';
  if (COMMON.includes(value.toLowerCase())) return 'Это один из самых частых паролей — придумайте другой';
  return null;
}

module.exports = { hashPassword, checkPassword, sha256, hashCode, newCode, newToken, safeEqual, passwordProblem };
