// Пробный запуск собранного Horizon на машине сборки: программа открывается, главная и поиск работают,
// снимки окна сохраняются в dist/smoke-*.png. Запуск: node scripts/ci-smoke.js <путь к исполняемому файлу>
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exe = process.argv[2];
const PORT = 9333;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-smoke-'));

async function targets() {
  return (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(5000) })).json();
}

async function call(target, method, params = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    setTimeout(() => reject(new Error('отладочный порт не ответил')), 10000);
  });
  // Ни один шаг проверки не ждёт дольше 20 секунд
  const result = await new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error(`${method}: нет ответа 20 с`)), 20000);
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id === 1) resolve(d.result || d.error);
    };
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return result;
}

const evaluate = async (target, expression) => (await call(target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

async function shot(target, name) {
  const r = await call(target, 'Page.captureScreenshot', { format: 'png' });
  if (r && r.data) fs.writeFileSync(path.join('dist', `smoke-${name}.png`), Buffer.from(r.data, 'base64'));
}

(async () => {
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, '--enable-logging=stderr'], {
    env: { ...process.env, HORIZON_PROFILE_DIR: profile, HORIZON_NO_INTRO: '1', HORIZON_TRACE: '1', ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Всё, что программа пишет при запуске, — в журнал проверки (последние строки покажем при ошибке)
  const output = [];
  const keep = (chunk) => output.push(...String(chunk).split(/\r?\n/).filter(Boolean));
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = null;
  child.on('exit', (code, signal) => (exited = `код ${code} ${signal || ''}`));

  let failures = 0;
  const check = (ok, label, extra = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  };
  try {
    let list = [];
    console.log('Жду, пока откроется программа…');
    for (let i = 0; i < 45 && !exited; i++) {
      try {
        list = await targets();
        if (list.some((t) => t.url.startsWith('horizon://start'))) break;
      } catch {
        // Программа ещё запускается.
      }
      await wait(1000);
    }
    const start = list.find((t) => t.url.startsWith('horizon://start'));
    check(Boolean(start), 'программа открылась, главная загрузилась', exited ? `программа закрылась: ${exited}` : '');
    if (!start) console.log(['Последние строки программы:', ...output.slice(-60)].join('\n'));
    if (start) {
      await wait(4000);
      const page = await evaluate(start, `({ title: document.title, search: !!document.getElementById('query'), tiles: document.querySelectorAll('.tile').length, video: (() => { const v = document.getElementById('liveA'); return v ? [v.readyState, v.error && v.error.message] : null; })() })`);
      check(page.search && page.tiles >= 1, 'на главной есть поиск и плитки', JSON.stringify(page));
      check(page.video && page.video[0] >= 1 && !page.video[1], 'видео волн открывается', JSON.stringify(page.video));
      await shot(start, 'start');
      const api = await evaluate(start, `fetch('/popular.json').then(r => r.json()).then(l => l.length)`);
      check(api > 10, 'внутренние данные браузера отвечают', String(api));
    }
    const ui = list.find((t) => t.url.includes('ui/index.html'));
    check(Boolean(ui), 'окно браузера (вкладки и адресная строка) на месте');
    if (ui) {
      const platform = await evaluate(ui, 'document.documentElement.dataset.platform');
      check(platform === 'darwin' || process.platform !== 'darwin', 'интерфейс знает, что он на Mac', platform);
      await shot(ui, 'ui');
    }
  } catch (error) {
    failures++;
    console.log('ОШИБКА', error.message);
    console.log(['Последние строки программы:', ...output.slice(-40)].join('\n'));
  } finally {
    child.kill();
  }
  console.log(`Итог пробного запуска: ошибок ${failures}`);
  process.exit(failures ? 1 : 0);
})();
