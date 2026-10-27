// Автообновление: новые версии берутся из релизов GitHub и проверяются подписью Ed25519.
// Своя подпись бесплатна и не требует покупного сертификата: установщик без верной подписи не запустится.
// Обновление скачивается в фоне, а ставится по кнопке «Обновить» или само при закрытии браузера.
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pkg = require('../package.json');

const PUBLIC_KEY_FILE = path.join(__dirname, 'update-key.pub');
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function isNewer(candidate, current) {
  const a = String(candidate).split('.').map(Number);
  const b = String(current).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function signedPayload(manifest) {
  return Buffer.from(`${manifest.version}\n${manifest.file}\n${manifest.sha256}`);
}

function verifyManifest(manifest, publicKeyPem) {
  if (!manifest || !manifest.version || !manifest.file || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '')) return false;
  if (!/^[\w.-]+\.exe$/.test(manifest.file)) return false;
  try {
    return crypto.verify(null, signedPayload(manifest), publicKeyPem, Buffer.from(manifest.signature || '', 'base64'));
  } catch {
    return false;
  }
}

class Updater extends EventEmitter {
  constructor() {
    super();
    this.status = 'idle'; // idle | disabled | checking | latest | downloading | ready | error
    this.message = '';
    this.version = null;
    this.file = null;
    this.installing = false;
  }

  publicState() {
    return { status: this.status, message: this.message, version: this.version, current: this.app ? this.app.getVersion() : pkg.version };
  }

  set(status, message = '') {
    this.status = status;
    this.message = message;
    this.emit('change', this.publicState());
  }

  start({ app }) {
    if (process.platform !== 'win32') return;
    this.app = app;
    this.repo = pkg.horizon && pkg.horizon.updateRepo;
    if (!app.isPackaged) return this.set('disabled', 'Обновления работают в установленной версии Horizon');
    if (!this.repo || !fs.existsSync(PUBLIC_KEY_FILE)) return this.set('disabled', 'Сервер обновлений ещё не подключён');
    this.publicKey = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8');
    setTimeout(() => this.check(), 10000);
    setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  async check() {
    if (this.status === 'disabled' || this.status === 'checking' || this.status === 'downloading' || this.status === 'ready') {
      return this.publicState();
    }
    const { net } = require('electron');
    const headers = { 'User-Agent': 'Horizon-Updater', Accept: 'application/vnd.github+json' };
    this.set('checking');
    try {
      // HORIZON_UPDATE_API — только для проверки обновлений на тестовом сервере.
      const api = process.env.HORIZON_UPDATE_API || 'https://api.github.com';
      const response = await net.fetch(`${api}/repos/${this.repo}/releases/latest`, { headers });
      if (response.status === 404) return this.set('latest', 'Выпусков пока нет');
      const release = await response.json();
      const assets = release.assets || [];
      const manifestAsset = assets.find((a) => a.name === 'latest.json');
      if (!manifestAsset) return this.set('latest');
      const manifest = await (await net.fetch(manifestAsset.browser_download_url, { headers })).json();
      if (!isNewer(manifest.version, this.app.getVersion())) return this.set('latest');
      if (!verifyManifest(manifest, this.publicKey)) throw new Error('Подпись обновления не совпала — обновление отклонено');

      const installerAsset = assets.find((a) => a.name === manifest.file);
      if (!installerAsset) throw new Error('В выпуске нет установщика');
      this.version = manifest.version;
      this.set('downloading');
      const data = Buffer.from(await (await net.fetch(installerAsset.browser_download_url, { headers })).arrayBuffer());
      if (crypto.createHash('sha256').update(data).digest('hex') !== manifest.sha256) {
        throw new Error('Скачанный установщик повреждён или подменён — обновление отклонено');
      }
      this.file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-update-')), manifest.file);
      fs.writeFileSync(this.file, data);
      this.set('ready');
    } catch (error) {
      this.set('error', error.message);
    }
    return this.publicState();
  }

  // Ставит скачанное обновление: сразу с перезапуском или тихо после закрытия браузера.
  install({ restart }) {
    if (this.status !== 'ready' || !this.file || this.installing) return false;
    this.installing = true;
    const args = restart ? ['/S', '--force-run'] : ['/S'];
    spawn(this.file, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
}

module.exports = { Updater, isNewer, verifyManifest, signedPayload };
