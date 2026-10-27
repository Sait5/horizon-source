// Идентификатор устройства для подписок с привязкой к устройствам (заголовки x-hwid, как в панелях Remnawave/Marzban).
// Это случайный номер этой установки Horizon: из него нельзя узнать ничего о компьютере.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let cached = null;

function deviceId(app) {
  if (cached) return cached;
  const file = path.join(app.getPath('userData'), 'device.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (/^[a-f0-9]{32}$/.test(saved.hwid)) cached = saved.hwid;
  } catch {
    // Первый запуск.
  }
  if (!cached) {
    cached = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hwid: cached }));
  }
  return cached;
}

function deviceHeaders(app) {
  return {
    'x-hwid': deviceId(app),
    'x-device-os': 'Windows',
    'x-ver-os': os.release().split('.')[0],
    'x-device-model': 'Horizon Browser',
  };
}

module.exports = { deviceId, deviceHeaders };
