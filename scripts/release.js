// Подписывает собранный установщик: создаёт dist/latest.json, который браузер проверяет перед обновлением.
// Порядок выпуска вручную: npm run dist → npm run release → загрузить установщик и latest.json в релиз GitHub.
// В автосборке закрытый ключ берётся из секрета HORIZON_UPDATE_KEY.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { signedPayload, verifyManifest } = require('../src/updater');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const file = `Horizon-Setup-${pkg.version}.exe`;
const installer = path.join(root, 'dist', file);
const privateKey = process.env.HORIZON_UPDATE_KEY || fs.readFileSync(path.join(root, 'keys', 'update-private.pem'), 'utf8');
const publicKey = fs.readFileSync(path.join(root, 'src', 'update-key.pub'), 'utf8');

if (!fs.existsSync(installer)) {
  console.error('Нет установщика', installer, '— сначала npm run dist');
  process.exit(1);
}
const manifest = {
  version: pkg.version,
  file,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),
};
manifest.signature = crypto.sign(null, signedPayload(manifest), privateKey).toString('base64');
if (!verifyManifest(manifest, publicKey)) throw new Error('Подпись не проверилась открытым ключом');
// Справочные поля (не подписываются): по ним автосборка понимает, вышел ли новый движок.
manifest.electron = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
manifest.commit = process.env.GITHUB_SHA || '';
fs.writeFileSync(path.join(root, 'dist', 'latest.json'), JSON.stringify(manifest, null, 2));
console.log('Готово: dist/latest.json для версии', pkg.version);
