// Проверяет токен и оформляет бота: описание, короткое «о боте» и команда /start — на русском.
// Запуск: node scripts/setup-bot.js (токен берётся из server/.env.local или переменных окружения).
const { loadEnvFile } = require('../lib/env-file');
const { callApi } = require('../lib/telegram');

const env = { ...loadEnvFile(), ...process.env };

(async () => {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Нет TELEGRAM_BOT_TOKEN');
  const me = await callApi(env, 'getMe', {});
  console.log(`Бот работает: @${me.username} (${me.first_name})`);
  await callApi(env, 'setMyDescription', {
    description:
      'Бот браузера Horizon. Подтверждает номер телефона для аккаунта Horizon.\n\n' +
      'Откройте профиль в Horizon и нажмите «Подтвердить через Telegram», затем здесь — «📱 Поделиться номером». ' +
      'Номер передаёт сам Telegram. Больше бот ничего не делает и сам никому не пишет.',
  });
  await callApi(env, 'setMyShortDescription', { short_description: 'Подтверждение номера и восстановление пароля для браузера Horizon' });
  await callApi(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Начать' }, { command: 'help', description: 'Что умеет бот' }] });
  console.log('Описание и команды установлены');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
