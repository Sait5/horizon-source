// Сервер аккаунтов у себя на компьютере: node dev.js
// Без настроек письма и сообщения бота не отправляются, а пишутся в журнал (режим разработки).
// Если задан TELEGRAM_BOT_TOKEN, бот работает через опрос Telegram — веб-адрес не нужен.
const http = require('node:http');
const { createApp } = require('./lib/core');
const { createStore } = require('./lib/store');
const telegram = require('./lib/telegram');
const { loadEnvFile } = require('./lib/env-file');

const env = { HORIZON_DEV: '1', ...loadEnvFile(), ...process.env };
const store = createStore(env);
const app = createApp({ store, env });
const port = Number(env.PORT || 8787);

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    let body = {};
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      body = {};
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const result = await app.handle({ method: req.method, path: url.pathname, headers: req.headers, body, ip: req.socket.remoteAddress });
    res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(result.json));
  });
});

server.listen(port, '127.0.0.1', () => console.log(`Сервер аккаунтов Horizon: http://127.0.0.1:${port}`));

async function poll() {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await telegram.callApi(env, 'deleteWebhook', {});
  let offset = 0;
  console.log('Telegram-бот слушает сообщения');
  for (;;) {
    try {
      const updates = await telegram.callApi(env, 'getUpdates', { offset, timeout: 25 });
      for (const update of updates) {
        offset = update.update_id + 1;
        await telegram.handleUpdate(update, { store, env, saveUser: (u) => store.set(`user:${u.id}`, u) });
      }
    } catch (error) {
      console.error(error.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
poll();
