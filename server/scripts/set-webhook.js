// Подключает бота к серверу на Vercel (один раз после выкладки):
// TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/set-webhook.js https://<ваш-сервер>.vercel.app
const base = (process.argv[2] || '').replace(/\/$/, '');
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret } = process.env;
if (!base || !token || !secret) {
  console.error('Нужны адрес сервера, TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET');
  process.exit(1);
}
(async () => {
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${base}/api/telegram`, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true }),
  });
  console.log(await response.json());
})();
