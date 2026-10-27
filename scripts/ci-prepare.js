// Для автосборки на GitHub: решает, нужен ли новый выпуск, и проставляет номер версии и адрес обновлений.
// Плановый запуск выпускает версию, только если вышел новый Electron (исправления Chromium) или изменился код.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const electron = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const repo = process.env.GITHUB_REPOSITORY;
const commit = process.env.GITHUB_SHA || '';
const event = process.env.GITHUB_EVENT_NAME || '';

async function previousManifest() {
  const headers = { 'User-Agent': 'horizon-ci', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (!response.ok) return null;
  const release = await response.json();
  const asset = (release.assets || []).find((a) => a.name === 'latest.json');
  if (!asset) return null;
  return (await fetch(asset.browser_download_url, { headers })).json();
}

function output(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
  console.log(lines);
}

(async () => {
  const previous = await previousManifest();
  const unchanged = previous && previous.electron === electron && previous.commit === commit;
  if (event === 'schedule' && unchanged) {
    output({ release: 'false', electron });
    console.log('Новых исправлений нет — выпуск не нужен');
    return;
  }
  const [major, minor] = pkg.version.split('.');
  const version = `${major}.${minor}.${process.env.GITHUB_RUN_NUMBER || 0}`;
  pkg.version = version;
  pkg.horizon = { ...(pkg.horizon || {}), updateRepo: repo };
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  output({ release: 'true', version, electron });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
