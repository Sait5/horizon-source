// Скачивает сетевое ядро sing-box (бесплатное, открытый код) с официальной страницы релизов GitHub
// и проверяет SHA-256, который GitHub публикует для каждого файла релиза.
// Windows — sing-box.exe; Mac — одно универсальное ядро для Intel и Apple M (склеивается через lipo).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VERSION = '1.14.4';
const CORE_DIR = path.join(__dirname, '..', 'core');
const MAC = process.platform === 'darwin';
const TARGET = path.join(CORE_DIR, MAC ? 'sing-box' : 'sing-box.exe');
// На машинах сборки GitHub запросы к API идут со служебным токеном — без него упираемся в лимит.
const headers = { 'User-Agent': 'horizon-setup', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

async function download(release, name, tmp) {
  const asset = (release.assets || []).find((a) => a.name === name);
  if (!asset) throw new Error(`В релизе v${VERSION} нет файла ${name}`);
  console.log('Скачиваю', asset.browser_download_url);
  const data = Buffer.from(await (await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'horizon-setup' } })).arrayBuffer());
  const actual = 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
  if (asset.digest && asset.digest !== actual) throw new Error(`Контрольная сумма не совпала: ждали ${asset.digest}, получили ${actual}`);
  console.log(asset.digest ? 'SHA-256 совпал' : 'GitHub не дал контрольную сумму, проверка пропущена', actual);
  const file = path.join(tmp, name);
  fs.writeFileSync(file, data);
  return file;
}

async function main() {
  if (fs.existsSync(TARGET)) {
    console.log('Ядро уже скачано:', TARGET);
    return;
  }
  const response = await fetch(`https://api.github.com/repos/SagerNet/sing-box/releases/tags/v${VERSION}`, { headers });
  const release = await response.json();
  if (!response.ok) throw new Error(`GitHub не отдал список файлов sing-box (${response.status}): ${release.message || ''}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-core-'));
  fs.mkdirSync(CORE_DIR, { recursive: true });

  if (MAC) {
    const parts = [];
    for (const arch of ['amd64', 'arm64']) {
      const name = `sing-box-${VERSION}-darwin-${arch}`;
      const archive = await download(release, `${name}.tar.gz`, tmp);
      execFileSync('tar', ['-xzf', archive, '-C', tmp]);
      parts.push(path.join(tmp, name, 'sing-box'));
      if (arch === 'arm64') fs.copyFileSync(path.join(tmp, name, 'LICENSE'), path.join(CORE_DIR, 'LICENSE-sing-box.txt'));
    }
    execFileSync('lipo', ['-create', '-output', TARGET, ...parts]);
    fs.chmodSync(TARGET, 0o755);
  } else {
    const name = `sing-box-${VERSION}-windows-amd64`;
    const zipPath = await download(release, `${name}.zip`, tmp);
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`]);
    fs.copyFileSync(path.join(tmp, name, 'sing-box.exe'), TARGET);
    fs.copyFileSync(path.join(tmp, name, 'LICENSE'), path.join(CORE_DIR, 'LICENSE-sing-box.txt'));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Готово:', TARGET);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
