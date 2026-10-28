// Аккаунт Horizon в браузере: вход, регистрация, профиль, номер через Telegram, устройства.
// Токен входа хранится зашифрованным средствами Windows; пароль в браузере не сохраняется.
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');

class Account extends EventEmitter {
  constructor({ app, safeStorage, net, shell, nativeImage }) {
    super();
    this.deps = { safeStorage, net, shell, nativeImage };
    this.file = path.join(app.getPath('userData'), 'account.bin');
    this.base = (process.env.HORIZON_ACCOUNT_API || (pkg.horizon && pkg.horizon.accountApi) || '').replace(/\/$/, '');
    this.token = null;
    this.user = null;
  }

  load() {
    try {
      const data = JSON.parse(this.deps.safeStorage.decryptString(fs.readFileSync(this.file)));
      this.token = data.token || null;
      this.user = data.user || null;
    } catch {
      // Ещё не входили.
    }
  }

  save() {
    if (!this.token) {
      fs.rmSync(this.file, { force: true });
      return;
    }
    fs.writeFileSync(this.file, this.deps.safeStorage.encryptString(JSON.stringify({ token: this.token, user: this.user })));
  }

  changed() {
    this.emit('change', this.publicState());
  }

  publicState() {
    return { configured: Boolean(this.base), loggedIn: Boolean(this.token), user: this.user, phonePending: Boolean(this.phonePending) };
  }

  device() {
    return `Horizon · ${process.platform === 'darwin' ? 'Mac' : 'Windows'} · ${os.hostname()}`;
  }

  // Постоянный номер этого компьютера: повторный вход заменяет его прежний сеанс,
  // и в «Устройствах» один компьютер не появляется дважды.
  deviceId() {
    if (this.cachedDeviceId) return this.cachedDeviceId;
    const file = path.join(path.dirname(this.file), 'device-id');
    try {
      const saved = fs.readFileSync(file, 'utf8').trim();
      if (/^[a-f0-9-]{36}$/.test(saved)) return (this.cachedDeviceId = saved);
    } catch {
      // Ещё нет — создаём.
    }
    this.cachedDeviceId = crypto.randomUUID();
    try {
      fs.writeFileSync(file, this.cachedDeviceId);
    } catch {
      // Не записался — номер живёт до перезапуска.
    }
    return this.cachedDeviceId;
  }

  async request(method, route, body, { auth = false } = {}) {
    if (!this.base) throw new Error('Сервер аккаунтов ещё не подключён');
    let response;
    try {
      response = await this.deps.net.fetch(this.base + route, {
        method,
        headers: { 'Content-Type': 'application/json', ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
        cache: 'no-store',
        // Сервер не ответил за 25 секунд — не висим бесконечно, а говорим об этом.
        signal: AbortSignal.timeout(25000),
      });
    } catch (error) {
      if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error('Сервер аккаунтов не ответил за 25 секунд. Проверьте интернет (или выключите VPN) и попробуйте ещё раз.');
      }
      throw new Error('Нет связи с сервером аккаунтов. Проверьте интернет или VPN.');
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      throw new Error('Сервер аккаунтов ответил непонятно');
    }
    if (response.status === 401 && auth) {
      this.token = null;
      this.user = null;
      this.save();
      this.changed();
    }
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }

  accept(data) {
    if (data.token) {
      this.token = data.token;
      this.user = data.user;
      this.save();
      this.changed();
    }
    return { loggedIn: Boolean(data.token), needCode: Boolean(data.needCode), devCode: data.devCode };
  }

  // Без почтового сервиса сервер сразу входит в аккаунт; с почтой — просит код.
  async register(email, password, name, birthDate) {
    return this.accept(await this.request('POST', '/api/auth/register', { email, password, name, birthDate, device: this.device(), deviceId: this.deviceId() }));
  }

  async setBirthDate(birthDate) {
    const data = await this.request('POST', '/api/profile/birthdate', { birthDate }, { auth: true });
    this.user = data.user;
    this.save();
    this.changed();
    return this.publicState();
  }

  // Детский режим: аккаунт младше 18 лет.
  isKid() {
    return Boolean(this.token && this.user && this.user.adult === false);
  }

  async verifyEmail(email, code) {
    return this.accept(await this.request('POST', '/api/auth/verify-email', { email, code, device: this.device(), deviceId: this.deviceId() }));
  }

  resend(email) {
    return this.request('POST', '/api/auth/resend', { email });
  }

  async login(email, password) {
    return this.accept(await this.request('POST', '/api/auth/login', { email, password, device: this.device(), deviceId: this.deviceId() }));
  }

  forgot(email) {
    return this.request('POST', '/api/auth/forgot', { email });
  }

  async reset(email, code, password) {
    return this.accept(await this.request('POST', '/api/auth/reset', { email, code, password, device: this.device(), deviceId: this.deviceId() }));
  }

  async logout() {
    this.stopPhoneWatch();
    try {
      if (this.token) await this.request('POST', '/api/auth/logout', {}, { auth: true });
    } finally {
      this.token = null;
      this.user = null;
      this.save();
      this.changed();
    }
  }

  async refresh() {
    if (!this.token) return this.publicState();
    const data = await this.request('GET', '/api/profile', null, { auth: true });
    this.user = data.user;
    this.save();
    this.changed();
    return this.publicState();
  }

  async updateProfile(patch) {
    const data = await this.request('POST', '/api/profile', patch, { auth: true });
    this.user = data.user;
    this.save();
    this.changed();
  }

  // Аватар: картинка обрезается до квадрата 160×160 и сжимается, чтобы весить немного.
  async setAvatarFromFile(file) {
    const image = this.deps.nativeImage.createFromPath(file);
    if (image.isEmpty()) throw new Error('Не удалось открыть картинку');
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
    const jpeg = square.resize({ width: 160, height: 160, quality: 'best' }).toJPEG(85);
    await this.updateProfile({ avatar: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
  }

  // Ссылка на бота. Telegram откроется во вкладке Horizon (Telegram Web) — ничего скачивать не нужно.
  // Пока человек подтверждает номер, браузер сам раз в 3 секунды проверяет, пришло ли подтверждение.
  async phoneStart() {
    const data = await this.request('POST', '/api/phone/start', {}, { auth: true });
    this.watchPhone(data.expiresIn * 1000);
    return data;
  }

  watchPhone(durationMs) {
    clearInterval(this.phoneTimer);
    this.phonePending = true;
    this.changed();
    const until = Date.now() + durationMs;
    this.phoneTimer = setInterval(async () => {
      if (!this.token || Date.now() > until) return this.stopPhoneWatch();
      try {
        await this.refresh();
        if (this.user && this.user.phone) {
          this.stopPhoneWatch();
          this.emit('phone-verified', this.user.phone);
        }
      } catch {
        // Нет связи — пробуем снова.
      }
    }, 3000);
  }

  stopPhoneWatch() {
    clearInterval(this.phoneTimer);
    this.phoneTimer = null;
    if (this.phonePending) {
      this.phonePending = false;
      this.changed();
    }
  }

  // ---------- Администратор ----------

  async adminUsers() {
    return (await this.request('GET', '/api/admin/users', null, { auth: true })).users;
  }

  adminBlock(id, blocked) {
    return this.request('POST', '/api/admin/block', { id, blocked }, { auth: true });
  }

  adminRole(id, role) {
    return this.request('POST', '/api/admin/role', { id, role });
  }

  adminLogout(id) {
    return this.request('POST', '/api/admin/logout', { id }, { auth: true });
  }

  async phoneRemove() {
    const data = await this.request('POST', '/api/phone/remove', {}, { auth: true });
    this.user = data.user;
    this.save();
    this.changed();
  }

  async sessions() {
    return (await this.request('GET', '/api/sessions', null, { auth: true })).sessions;
  }

  revoke(id) {
    return this.request('POST', '/api/sessions/revoke', { id }, { auth: true });
  }

  changePassword(current, password) {
    return this.request('POST', '/api/profile/password', { current, password }, { auth: true });
  }

  async deleteAccount(password) {
    await this.request('POST', '/api/profile/delete', { password }, { auth: true });
    this.token = null;
    this.user = null;
    this.save();
    this.changed();
  }
}

module.exports = { Account };
