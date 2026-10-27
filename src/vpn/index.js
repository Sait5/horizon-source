// VPN-расширение Horizon: конфигурации, подписки и переключатель. Через VPN идёт только трафик браузера.
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Core } = require('./core');
const { parseLink, parseSubscriptionBody, decodeBase64 } = require('./links');
const qr = require('./qr');
const { deviceHeaders } = require('./device');

// Несуществующий прокси: пока VPN включён, но не подключён, вкладки никуда не ходят напрямую.
const BLACKHOLE = 'http://127.0.0.1:9';
const PROBE_URL = 'https://www.gstatic.com/generate_204';
const IP_URL = 'https://api.ipify.org';

class Vpn extends EventEmitter {
  constructor(deps) {
    super();
    this.deps = deps; // { app, session, safeStorage, net, desktopCapturer, screen, clipboard, nativeImage }
    this.core = new Core(deps.app);
    this.file = path.join(deps.app.getPath('userData'), 'vpn.bin');
    this.data = { enabled: false, selectedId: null, configs: [], subscriptions: [] };
    this.status = 'off';
    this.message = '';
    this.ip = null;
    this.failures = 0;
    this.retries = 0;
    this.healthTimer = null;
    this.connectSeq = 0;

    this.core.on('exit', ({ reason }) => this.onCoreExit(reason));
  }

  // ---------- Хранение (зашифровано средствами Windows) ----------

  load() {
    try {
      const raw = fs.readFileSync(this.file);
      const json = JSON.parse(this.deps.safeStorage.decryptString(raw));
      this.data = { ...this.data, ...json };
    } catch {
      // Нет файла или его нельзя расшифровать на этой учётной записи — начинаем с пустого списка.
    }
  }

  save() {
    const encrypted = this.deps.safeStorage.encryptString(JSON.stringify(this.data));
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, encrypted);
  }

  // ---------- Состояние для интерфейса (без ключей и адресов серверов) ----------

  publicState() {
    return {
      enabled: this.data.enabled,
      status: this.status,
      message: this.message,
      ip: this.ip,
      pings: this.pings || {},
      selectedId: this.data.selectedId,
      configs: this.data.configs.map((c) => ({
        id: c.id,
        name: c.name,
        protocol: c.protocol,
        subscriptionId: c.subscriptionId || null,
      })),
      subscriptions: this.data.subscriptions.map((s) => ({
        id: s.id,
        title: s.title,
        info: s.info || null,
        updatedAt: s.updatedAt,
        count: this.data.configs.filter((c) => c.subscriptionId === s.id).length,
      })),
    };
  }

  setStatus(status, message = '') {
    this.status = status;
    this.message = message;
    this.emit('change', this.publicState());
  }

  // ---------- Запуск браузера ----------

  async init() {
    this.load();
    await this.core.cleanupStale();
    if (this.data.enabled) {
      // До первой вкладки закрываем прямой выход, затем подключаемся.
      await this.applyProxy(BLACKHOLE);
      this.connect();
    }
    this.refreshStaleSubscriptions();
  }

  async applyProxy(rules) {
    const { session } = this.deps;
    if (rules) await session.setProxy({ mode: 'fixed_servers', proxyRules: rules, proxyBypassRules: '' });
    else await session.setProxy({ mode: 'direct' });
    await session.closeAllConnections();
  }

  // Учётные данные для запросов вкладок к локальному ядру (событие login).
  proxyCredentials(authInfo) {
    const creds = this.core.credentials;
    if (!creds || !authInfo.isProxy) return null;
    if (authInfo.host !== '127.0.0.1' || Number(authInfo.port) !== creds.port) return null;
    return creds;
  }

  get protectsTraffic() {
    return this.data.enabled;
  }

  // ---------- Подключение ----------

  async setEnabled(enabled) {
    if (enabled) {
      if (!this.selected()) throw new Error('Сначала добавьте и выберите сервер');
      this.data.enabled = true;
      this.save();
      await this.connect();
    } else {
      this.data.enabled = false;
      this.save();
      await this.disconnect();
    }
  }

  selected() {
    return this.data.configs.find((c) => c.id === this.data.selectedId) || null;
  }

  async connect() {
    const seq = ++this.connectSeq;
    const config = this.selected();
    this.stopHealth();
    this.ip = null;
    if (!config) {
      await this.applyProxy(BLACKHOLE);
      this.setStatus('error', 'Сервер не выбран');
      return;
    }
    this.setStatus('connecting');
    await this.applyProxy(BLACKHOLE);
    try {
      const creds = await this.core.start(config.outbound);
      if (seq !== this.connectSeq) return;
      await this.applyProxy(`http://127.0.0.1:${creds.port}`);
      this.failures = 0;
      this.setStatus('on');
      this.startHealth();
      this.refreshIp();
    } catch (error) {
      if (seq !== this.connectSeq) return;
      this.setStatus('error', error.message);
    }
  }

  async disconnect() {
    this.connectSeq++;
    this.stopHealth();
    this.retries = 0;
    this.ip = null;
    await this.core.stop();
    await this.applyProxy(null);
    this.setStatus('off');
  }

  async onCoreExit(reason) {
    if (!this.data.enabled) return;
    this.stopHealth();
    this.ip = null;
    await this.applyProxy(BLACKHOLE);
    this.setStatus('lost', reason ? `Ядро VPN остановилось: ${reason}` : 'Ядро VPN остановилось');
    this.emit('lost');
    if (this.retries < 3) {
      this.retries++;
      setTimeout(() => {
        if (this.data.enabled && this.status === 'lost') this.connect();
      }, 2000 * this.retries);
    }
  }

  // ---------- Проверка связи ----------

  request(url, timeoutMs = 8000) {
    const { net, session } = this.deps;
    return new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (!done) {
          done = true;
          resolve(result);
        }
      };
      const req = net.request({ url, session, useSessionCookies: false, cache: 'no-store' });
      req.on('login', (authInfo, callback) => {
        const creds = this.proxyCredentials(authInfo);
        if (creds) callback(creds.username, creds.password);
        else callback();
      });
      req.on('response', (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => finish({ ok: res.statusCode < 400, body: Buffer.concat(chunks).toString() }));
        res.on('error', () => finish({ ok: false }));
      });
      req.on('error', () => finish({ ok: false }));
      setTimeout(() => {
        req.abort();
        finish({ ok: false });
      }, timeoutMs);
      req.end();
    });
  }

  startHealth() {
    this.stopHealth();
    this.healthTimer = setInterval(() => this.checkHealth(), 20000);
  }

  stopHealth() {
    clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  async checkHealth() {
    if (!this.core.running) return;
    const { ok } = await this.request(PROBE_URL);
    if (ok) {
      this.failures = 0;
      this.retries = 0;
      if (this.status === 'lost') {
        this.setStatus('on');
        this.refreshIp();
      }
      return;
    }
    this.failures++;
    if (this.failures >= 2 && this.status === 'on') {
      this.ip = null;
      this.setStatus('lost', 'Сервер VPN не отвечает. Прямое подключение заблокировано.');
      this.emit('lost');
    }
  }

  async refreshIp() {
    const { ok, body } = await this.request(IP_URL);
    if (ok && /^[\d.:a-f]+$/i.test(body.trim()) && this.status === 'on') {
      this.ip = body.trim();
      this.emit('change', this.publicState());
    }
  }

  async test() {
    if (this.status !== 'on' && this.status !== 'lost') throw new Error('VPN не подключён');
    const started = Date.now();
    const { ok } = await this.request(PROBE_URL);
    if (!ok) throw new Error('Сервер не ответил');
    return Date.now() - started;
  }

  // ---------- Добавление конфигураций ----------

  addConfigs(items, subscriptionId = null) {
    let added = 0;
    for (const item of items) {
      const existing = this.data.configs.find((c) => c.id === item.id);
      if (existing) continue;
      this.data.configs.push({ ...item, subscriptionId });
      added++;
    }
    if (!this.selected() && this.data.configs.length) this.data.selectedId = this.data.configs[0].id;
    return added;
  }

  // Текст из поля «Добавить»: ссылки (по одной в строке) или адрес подписки.
  async importText(text) {
    const value = String(text || '').trim();
    if (!value) throw new Error('Вставьте ссылку или адрес подписки');
    if (/^https?:\/\//i.test(value) && !value.includes('\n')) return this.addSubscription(value);

    const { results, errors } = parseSubscriptionBody(value);
    if (!results.length) throw new Error(errors[0] || 'Не нашлось ни одной конфигурации');
    const added = this.addConfigs(results);
    this.save();
    this.emit('change', this.publicState());
    return { added, skipped: errors.length, reason: errors[0] };
  }

  async fetchSubscription(url) {
    const { net, app } = this.deps;
    const headers = deviceHeaders(app);
    const get = (ua) => net.fetch(url, { headers: { 'User-Agent': ua, ...headers }, cache: 'no-store' });
    let response = await get('Horizon/0.1');
    let body = await response.text();
    if (/^\s*<(!doctype|html)/i.test(body)) {
      // Некоторые панели для незнакомых программ показывают веб-страницу, а список ссылок отдают клиентам v2rayN.
      response = await get('v2rayN/7.0');
      body = await response.text();
    }
    if (!response.ok) throw new Error(`Подписка ответила ошибкой ${response.status}`);

    let title = response.headers.get('profile-title') || '';
    if (title.startsWith('base64:')) title = decodeBase64(title.slice(7));
    const info = {};
    for (const part of (response.headers.get('subscription-userinfo') || '').split(';')) {
      const [key, val] = part.split('=').map((s) => s && s.trim());
      if (key && val && /^\d+$/.test(val)) info[key] = Number(val);
    }
    const { results, errors } = parseSubscriptionBody(body);
    if (!results.length) throw new Error(errors[0] || 'В подписке нет поддерживаемых конфигураций');
    return { title, info, results, errors };
  }

  async addSubscription(url) {
    const parsedUrl = new URL(url);
    const id = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
    const { title, info, results, errors } = await this.fetchSubscription(url);
    const existing = this.data.subscriptions.find((s) => s.id === id);
    const sub = existing || { id, url };
    sub.title = title || parsedUrl.hostname;
    sub.info = info;
    sub.updatedAt = Date.now();
    if (!existing) this.data.subscriptions.push(sub);

    // Список серверов подписки заменяется целиком; выбранный сервер сохраняется, если он остался в списке.
    const previous = this.selected();
    this.data.configs = this.data.configs.filter((c) => c.subscriptionId !== id);
    const added = this.addConfigs(results, id);
    if (!previous || previous.subscriptionId === id) {
      const fresh = this.data.configs.filter((c) => c.subscriptionId === id);
      const same = previous && (fresh.find((c) => c.id === previous.id) || fresh.find((c) => c.name === previous.name));
      this.data.selectedId = (same || fresh[0] || this.data.configs[0] || {}).id || null;
    }
    this.save();
    this.emit('change', this.publicState());
    if (this.data.enabled && previous && previous.id !== this.data.selectedId) this.connect();
    return { added, skipped: errors.length, reason: errors[0], title: sub.title };
  }

  // Задержка до каждого сервера: время TCP-подключения к его порту (без включения VPN).
  async pingAll() {
    const tcp = require('node:net');
    const ping = (c) =>
      new Promise((resolve) => {
        const started = Date.now();
        const socket = tcp.connect({ host: c.outbound.server, port: c.outbound.server_port });
        const done = (ms) => {
          socket.destroy();
          resolve(ms);
        };
        socket.setTimeout(3000, () => done(null));
        socket.once('connect', () => done(Date.now() - started));
        socket.once('error', () => done(null));
      });
    const queue = [...this.data.configs];
    this.pings = {};
    const worker = async () => {
      while (queue.length) {
        const c = queue.shift();
        this.pings[c.id] = await ping(c);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    this.emit('change', this.publicState());
    return this.pings;
  }

  // Подписки обновляются сами раз в 12 часов (при запуске браузера).
  async refreshStaleSubscriptions() {
    // Списки, сохранённые прошлой версией (без номера устройства), обновляются сразу.
    const migrate = this.data.format !== 2;
    this.data.format = 2;
    for (const sub of this.data.subscriptions) {
      if (!migrate && Date.now() - (sub.updatedAt || 0) < 12 * 3600 * 1000) continue;
      try {
        await this.addSubscription(sub.url);
      } catch {
        // Нет сети или подписка недоступна — оставляем прежний список.
      }
    }
  }

  async refreshSubscription(id) {
    const sub = this.data.subscriptions.find((s) => s.id === id);
    if (!sub) throw new Error('Подписка не найдена');
    return this.addSubscription(sub.url);
  }

  async importQr(source) {
    const { clipboard, desktopCapturer, screen, nativeImage } = this.deps;
    let text = null;
    if (source === 'clipboard') {
      text = qr.decodeImage(clipboard.readImage());
      if (!text) throw new Error('В буфере обмена нет картинки с QR-кодом');
    } else if (source === 'screen') {
      text = await qr.fromScreen({ desktopCapturer, screen });
      if (!text) throw new Error('На экране не найден QR-код. Откройте его крупнее и попробуйте снова.');
    } else if (typeof source === 'object' && source.file) {
      text = qr.decodeImage(nativeImage.createFromPath(source.file));
      if (!text) throw new Error('На картинке не найден QR-код');
    }
    return this.importText(text);
  }

  // ---------- Удаление ----------

  async select(id) {
    if (!this.data.configs.some((c) => c.id === id)) return;
    this.data.selectedId = id;
    this.save();
    this.emit('change', this.publicState());
    if (this.data.enabled) await this.connect();
  }

  async remove(id) {
    this.data.configs = this.data.configs.filter((c) => c.id !== id);
    await this.afterRemove(id);
  }

  async removeSubscription(id) {
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.id !== id);
    this.data.configs = this.data.configs.filter((c) => c.subscriptionId !== id);
    await this.afterRemove(null);
  }

  async afterRemove() {
    if (!this.selected()) {
      this.data.selectedId = this.data.configs[0] ? this.data.configs[0].id : null;
      if (this.data.enabled && !this.data.selectedId) {
        this.data.enabled = false;
        await this.disconnect();
      } else if (this.data.enabled) {
        await this.connect();
      }
    }
    this.save();
    this.emit('change', this.publicState());
  }

  async shutdown() {
    this.stopHealth();
    await this.core.stop();
  }
}

module.exports = { Vpn };
