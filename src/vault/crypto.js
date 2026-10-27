// Шифрование сейфа: ключ из пароля через scrypt, данные — AES-256-GCM, коды телефона — TOTP (RFC 6238).
const crypto = require('node:crypto');

const KDF = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const RFC4648 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// Алфавит без похожих букв (I, L, O, U), чтобы код восстановления было легко переписать на бумагу.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function deriveKey(secret, salt, params = KDF) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret).normalize('NFKC'), salt, 32, { ...KDF, ...params }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

function seal(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

// Бросает ошибку, если ключ неверный или данные подменены.
function open(key, box, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
}

function encodeBase32(buffer, alphabet) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(text, alphabet) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Неверный символ в коде');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 160 случайных бит, 8 групп по 4 символа.
function newRecoveryCode() {
  const raw = encodeBase32(crypto.randomBytes(20), CROCKFORD);
  return raw.match(/.{4}/g).join('-');
}

function normalizeRecoveryCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

function totpSecret() {
  return encodeBase32(crypto.randomBytes(20), RFC4648);
}

function totpAt(secret, step) {
  const key = decodeBase32(secret, RFC4648);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, '0');
}

// Возвращает номер шага, если код верный и ещё не использовался, иначе null.
function verifyTotp(secret, code, lastStep = -1, now = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current - 1, current, current + 1]) {
    if (step <= lastStep) continue;
    const expected = totpAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

module.exports = {
  KDF,
  deriveKey,
  seal,
  open,
  newRecoveryCode,
  normalizeRecoveryCode,
  totpSecret,
  totpAt,
  verifyTotp,
};
