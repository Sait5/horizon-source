// Сейф паролей: открывается мастер-паролем или Windows Hello, восстанавливается только кодом пользователя.
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const c = require('./crypto');
const hello = require('./hello');

const AAD_KEY = 'horizon:vault-key:v1';
const AAD_DATA = 'horizon:vault-data:v1';
const MIN_MASTER = 10;
const AUTO_LOCK_MS = 15 * 60 * 1000;
const COMMON_PASSWORDS = [
  '1234567890', 'qwertyuiop', 'password', 'пароль', 'йцукенгшщз', '1q2w3e4r', 'qwerty123', 'iloveyou',
  'asdfghjkl', 'zxcvbnm', 'admin123', 'abc123', '11111111', '123123123', 'parol123', 'football', 'princess',
];

class Vault extends EventEmitter {
  constructor({ app, safeStorage }) {
    super();
    this.safeStorage = safeStorage;
    const dir = app.getPath('userData');
    this.file = path.join(dir, 'vault.json');
    this.guardFile = path.join(dir, 'vault-guard.json');
    this.helloFile = path.join(dir, 'vault-hello.bin');
    this.key = null;
    this.data = null;
    this.pendingTotp = null;
    this.lockTimer = null;
  }

  // ---------- Файлы ----------

  exists() {
    return fs.existsSync(this.file);
  }

  readFile() {
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  writeFile(json) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(json, null, 1));
    fs.renameSync(tmp, this.file);
  }

  persist() {
    const json = this.readFile();
    json.data = c.seal(this.key, JSON.stringify(this.data), AAD_DATA);
    json.twoFactor = Boolean(this.data.account.totpSecret);
    this.writeFile(json);
  }

  // ---------- Защита от перебора ----------

  readGuard() {
    try {
      return JSON.parse(fs.readFileSync(this.guardFile, 'utf8'));
    } catch {
      return {};
    }
  }

  checkGuard(kind) {
    const g = this.readGuard()[kind];
    if (g && g.until > Date.now()) {
      const seconds = Math.ceil((g.until - Date.now()) / 1000);
      throw new Error(`Слишком много попыток. Подождите ${seconds} с.`);
    }
  }

  recordAttempt(kind, success) {
    const guard = this.readGuard();
    if (success) {
      delete guard[kind];
    } else {
      const fails = ((guard[kind] && guard[kind].fails) || 0) + 1;
      const delay = fails >= 5 ? Math.min(30000 * 2 ** (fails - 5), 3600000) : 0;
      guard[kind] = { fails, until: Date.now() + delay };
    }
    fs.writeFileSync(this.guardFile, JSON.stringify(guard));
  }

  // ---------- Состояние ----------

  async status() {
    const exists = this.exists();
    let twoFactor = false;
    if (exists) {
      try {
        twoFactor = Boolean(this.readFile().twoFactor);
      } catch {
        // Повреждённый файл покажется при попытке открыть.
      }
    }
    return {
      exists,
      unlocked: Boolean(this.key),
      twoFactor,
      helloAvailable: await hello.isAvailable(),
      helloEnabled: fs.existsSync(this.helloFile),
      count: this.data ? this.data.entries.length : null,
    };
  }

  changed() {
    this.emit('change');
  }

  touch() {
    clearTimeout(this.lockTimer);
    if (this.key) this.lockTimer = setTimeout(() => this.lock(), AUTO_LOCK_MS);
  }

  requireUnlocked() {
    if (!this.key) throw new Error('Сейф закрыт');
    this.touch();
  }

  setUnlocked(key, data) {
    this.key = key;
    this.data = data;
    this.data.entries = this.data.entries || [];
    this.data.account = this.data.account || {};
    this.touch();
    this.changed();
  }

  lock() {
    clearTimeout(this.lockTimer);
    if (this.key) this.key.fill(0);
    this.key = null;
    this.data = null;
    this.pendingTotp = null;
    this.changed();
  }

  // ---------- Создание и открытие ----------

  // Отсекаем пароли, которые подбираются за минуты: короткие, из одних цифр, из повторов и самые частые.
  checkMasterStrength(master) {
    const value = String(master || '');
    if (value.length < MIN_MASTER) throw new Error(`Мастер-пароль должен быть не короче ${MIN_MASTER} символов`);
    if (new Set(value.toLowerCase()).size < 5) throw new Error('В мастер-пароле слишком мало разных символов');
    if (/^\d+$/.test(value) && value.length < 16) throw new Error('Пароль только из цифр должен быть не короче 16 символов. Лучше возьмите фразу из нескольких слов.');
    const lower = value.toLowerCase();
    if (COMMON_PASSWORDS.some((p) => lower.includes(p) && lower.length - p.length < 4)) {
      throw new Error('Это один из самых частых паролей — его подберут первым. Возьмите фразу из нескольких слов.');
    }
  }

  async wrap(secret, key) {
    const salt = crypto.randomBytes(16);
    const derived = await c.deriveKey(secret, salt);
    return { salt: salt.toString('base64'), box: c.seal(derived, key, AAD_KEY) };
  }

  async unwrap(secret, wrapped, kdf) {
    const derived = await c.deriveKey(secret, Buffer.from(wrapped.salt, 'base64'), kdf);
    return c.open(derived, wrapped.box, AAD_KEY);
  }

  async create(master) {
    if (this.exists()) throw new Error('Сейф уже создан');
    this.checkMasterStrength(master);
    const key = crypto.randomBytes(32);
    const recoveryCode = c.newRecoveryCode();
    const data = { entries: [], account: {} };
    this.writeFile({
      v: 1,
      kdf: { N: c.KDF.N, r: c.KDF.r, p: c.KDF.p },
      master: await this.wrap(master, key),
      recovery: await this.wrap(c.normalizeRecoveryCode(recoveryCode), key),
      data: c.seal(key, JSON.stringify(data), AAD_DATA),
      twoFactor: false,
    });
    this.setUnlocked(key, data);
    return { recoveryCode };
  }

  async keyFromMaster(master, json = this.readFile()) {
    this.checkGuard('master');
    try {
      const key = await this.unwrap(master, json.master, json.kdf);
      this.recordAttempt('master', true);
      return key;
    } catch {
      this.recordAttempt('master', false);
      throw new Error('Неверный мастер-пароль');
    }
  }

  async unlock(master) {
    const json = this.readFile();
    const key = await this.keyFromMaster(master, json);
    this.setUnlocked(key, JSON.parse(c.open(key, json.data, AAD_DATA)));
  }

  async unlockWithHello() {
    if (!fs.existsSync(this.helloFile)) throw new Error('Windows Hello для сейфа не включён');
    if (!(await hello.verify('Horizon: открыть сейф паролей'))) throw new Error('Windows Hello не подтвердил вход');
    const key = Buffer.from(this.safeStorage.decryptString(fs.readFileSync(this.helloFile)), 'hex');
    const json = this.readFile();
    this.setUnlocked(key, JSON.parse(c.open(key, json.data, AAD_DATA)));
  }

  // ---------- Подтверждение с телефона (2FAS, TOTP) ----------

  requireSecondFactor(code) {
    const secret = this.data.account.totpSecret;
    if (!secret) return;
    const step = c.verifyTotp(secret, code, this.data.account.totpLastStep ?? -1);
    if (step === null) throw new Error('Неверный код из 2FAS');
    this.data.account.totpLastStep = step;
    this.persist();
  }

  async twoFactorBegin() {
    this.requireUnlocked();
    const secret = c.totpSecret();
    this.pendingTotp = secret;
    const uri = `otpauth://totp/Horizon:${encodeURIComponent('Сейф Horizon')}?secret=${secret}&issuer=Horizon&algorithm=SHA1&digits=6&period=30`;
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#0e1116', light: '#ffffff' } });
    return { secret: secret.match(/.{4}/g).join(' '), qr };
  }

  twoFactorConfirm(code) {
    this.requireUnlocked();
    if (!this.pendingTotp) throw new Error('Начните подключение заново');
    const step = c.verifyTotp(this.pendingTotp, code);
    if (step === null) throw new Error('Код не подошёл. Проверьте время на телефоне и попробуйте снова.');
    this.data.account.totpSecret = this.pendingTotp;
    this.data.account.totpLastStep = step;
    this.pendingTotp = null;
    this.persist();
    this.changed();
  }

  twoFactorDisable(code) {
    this.requireUnlocked();
    this.requireSecondFactor(code);
    delete this.data.account.totpSecret;
    delete this.data.account.totpLastStep;
    this.persist();
    this.changed();
  }

  // ---------- Восстановление и смена пароля ----------

  async recover(code, newMaster) {
    this.checkMasterStrength(newMaster);
    this.checkGuard('recovery');
    const json = this.readFile();
    let key;
    try {
      key = await this.unwrap(c.normalizeRecoveryCode(code), json.recovery, json.kdf);
      this.recordAttempt('recovery', true);
    } catch {
      this.recordAttempt('recovery', false);
      throw new Error('Код восстановления не подошёл');
    }
    // Использованный код сразу заменяется новым.
    const recoveryCode = c.newRecoveryCode();
    json.master = await this.wrap(newMaster, key);
    json.recovery = await this.wrap(c.normalizeRecoveryCode(recoveryCode), key);
    this.writeFile(json);
    this.recordAttempt('master', true);
    this.setUnlocked(key, JSON.parse(c.open(key, json.data, AAD_DATA)));
    return { recoveryCode };
  }

  async changeMaster(current, next, code) {
    this.requireUnlocked();
    this.checkMasterStrength(next);
    await this.keyFromMaster(current);
    this.requireSecondFactor(code);
    const json = this.readFile();
    json.master = await this.wrap(next, this.key);
    this.writeFile(json);
  }

  async newRecoveryCode(current, code) {
    this.requireUnlocked();
    await this.keyFromMaster(current);
    this.requireSecondFactor(code);
    const recoveryCode = c.newRecoveryCode();
    const json = this.readFile();
    json.recovery = await this.wrap(c.normalizeRecoveryCode(recoveryCode), this.key);
    this.writeFile(json);
    return { recoveryCode };
  }

  // ---------- Windows Hello ----------

  async helloEnable() {
    this.requireUnlocked();
    if (!(await hello.isAvailable())) throw new Error('Windows Hello на этом компьютере не настроен');
    if (!(await hello.verify('Horizon: включить вход в сейф по Windows Hello'))) throw new Error('Windows Hello не подтвердил вход');
    fs.writeFileSync(this.helloFile, this.safeStorage.encryptString(this.key.toString('hex')));
    this.changed();
  }

  helloDisable() {
    fs.rmSync(this.helloFile, { force: true });
    this.changed();
  }

  // ---------- Пароли ----------

  list() {
    this.requireUnlocked();
    return this.data.entries
      .map(({ id, origin, username, updated }) => ({ id, origin, username, updated }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
  }

  forOrigin(origin) {
    return this.list().filter((e) => e.origin === origin);
  }

  has(origin, username, password) {
    return Boolean(this.data && this.data.entries.some((e) => e.origin === origin && e.username === username && e.password === password));
  }

  get(id) {
    this.requireUnlocked();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) throw new Error('Запись не найдена');
    return entry;
  }

  save({ origin, username, password }) {
    this.requireUnlocked();
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Укажите адрес сайта, например https://example.com');
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Пароли сохраняются только для сайтов http и https');
    if (!password) throw new Error('Пароль пустой');
    const cleanOrigin = parsed.origin;
    const user = String(username || '');
    const existing = this.data.entries.find((e) => e.origin === cleanOrigin && e.username === user);
    if (existing) {
      existing.password = password;
      existing.updated = Date.now();
    } else {
      this.data.entries.push({
        id: crypto.randomUUID(),
        origin: cleanOrigin,
        username: user,
        password,
        created: Date.now(),
        updated: Date.now(),
      });
    }
    this.persist();
    this.changed();
  }

  remove(id) {
    this.requireUnlocked();
    this.data.entries = this.data.entries.filter((e) => e.id !== id);
    this.persist();
    this.changed();
  }

  // ---------- Перенос на новое устройство ----------

  async exportTo(file, master, code) {
    this.requireUnlocked();
    await this.keyFromMaster(master);
    this.requireSecondFactor(code);
    // Файл остаётся зашифрованным: без мастер-пароля или кода восстановления его не прочитать.
    fs.copyFileSync(this.file, file);
  }

  async importFrom(file, master, code) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error('Это не файл сейфа Horizon');
    }
    if (json.v !== 1 || !json.master || !json.recovery || !json.data) throw new Error('Это не файл сейфа Horizon');
    const key = await this.keyFromMaster(master, json);
    const data = JSON.parse(c.open(key, json.data, AAD_DATA));
    const secret = data.account && data.account.totpSecret;
    if (secret) {
      const step = c.verifyTotp(secret, code, data.account.totpLastStep ?? -1);
      if (step === null) throw new Error('Подключение нового устройства нужно подтвердить кодом из 2FAS');
      data.account.totpLastStep = step;
    }
    this.lock();
    fs.rmSync(this.helloFile, { force: true });
    json.data = c.seal(key, JSON.stringify(data), AAD_DATA);
    this.writeFile(json);
    this.setUnlocked(key, data);
  }
}

module.exports = { Vault };
