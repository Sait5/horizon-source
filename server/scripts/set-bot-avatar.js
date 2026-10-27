// Ставит боту аватарку (кольцо восхода из заставки Horizon): node scripts/set-bot-avatar.js
const fs = require('node:fs');
const path = require('node:path');
const { loadEnvFile } = require('../lib/env-file');

const env = { ...loadEnvFile(), ...process.env };
(async () => {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Нет TELEGRAM_BOT_TOKEN');
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
  form.append('avatar', new Blob([fs.readFileSync(path.join(__dirname, '..', 'bot-avatar.jpg'))], { type: 'image/jpeg' }), 'avatar.jpg');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyProfilePhoto`, { method: 'POST', body: form });
  const data = await response.json();
  console.log(data.ok ? 'Аватарка бота установлена' : `Telegram ответил: ${data.description}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
