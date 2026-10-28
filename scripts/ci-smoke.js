// Пробный запуск собранного Horizon на машине сборки: программа сама проверяет себя (HORIZON_SELFTEST),
// сохраняет снимки окна в dist/smoke-*.png и закрывается. Запуск: node scripts/ci-smoke.js <исполняемый файл>
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exe = process.argv[2];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-smoke-'));
const outDir = path.resolve('dist');

// На машине сборки macOS спросила бы доступ к «Связке ключей» и ждала нажатия — используем пробную связку Chromium.
const child = spawn(exe, process.platform === 'darwin' ? ['--use-mock-keychain'] : [], {
  env: { ...process.env, HORIZON_PROFILE_DIR: profile, HORIZON_NO_INTRO: '1', HORIZON_TRACE: '1', HORIZON_SELFTEST: outDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const output = [];
const keep = (chunk) => output.push(...String(chunk).split(/\r?\n/).filter((l) => l && !/XPC error/.test(l)));
child.stdout.on('data', keep);
child.stderr.on('data', keep);

// Программа сама закрывается через ~15 секунд после открытия окна; ждём не больше 2 минут.
const timer = setTimeout(() => {
  console.log('Программа не закрылась сама за 2 минуты — останавливаю.');
  child.kill('SIGKILL');
}, 120000);

child.on('exit', (code) => {
  clearTimeout(timer);
  console.log(['Журнал запуска:', ...output.filter((l) => /^\[(запуск|ошибка)\]/.test(l))].join('\n'));
  const line = output.find((l) => l.startsWith('[самопроверка]'));
  let failures = 0;
  const check = (ok, label, extra = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  };
  if (!line) {
    check(false, 'самопроверка выполнилась', `код выхода ${code}`);
    console.log(['Последние строки программы:', ...output.slice(-40)].join('\n'));
  } else {
    const r = JSON.parse(line.slice('[самопроверка] '.length));
    check(r.window, 'окно браузера открылось');
    check(/^horizon:\/\/start/.test(r.url || ''), 'открылась главная', r.url);
    check(r.page && r.page.search && r.page.tiles >= 1, 'на главной есть поиск и плитки', JSON.stringify(r.page));
    check(r.page && Array.isArray(r.page.video) && r.page.video[0] >= 1 && !r.page.video[1], 'видео волн открывается', JSON.stringify(r.page && r.page.video));
    check(Number(r.popular) > 10, 'внутренние данные браузера отвечают', String(r.popular));
    check(r.platform === process.platform, 'интерфейс знает свою систему', r.platform);
    for (const name of ['start', 'ui']) {
      const file = path.join(outDir, `smoke-${name}.png`);
      check(fs.existsSync(file), `снимок «${name}» сохранён`, r[`${name}Shot`] || '');
    }
  }
  console.log(`Итог пробного запуска: ошибок ${failures}`);
  process.exit(failures ? 1 : 0);
});
