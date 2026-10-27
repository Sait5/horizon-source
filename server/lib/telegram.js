// Telegram-бот Horizon: подтверждает номер телефона бесплатно.
// Человек открывает бота по ссылке из профиля, нажимает «Поделиться номером», и Telegram сам
// присылает его настоящий номер — подделать чужой нельзя, потому что бот сверяет отправителя.
const sentLog = []; // только для разработки и проверок без настоящего бота

async function callApi(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram: ${data.description}`);
  return data.result;
}

async function fakeApi(_env, method, payload) {
  sentLog.push({ method, ...payload });
  if (sentLog.length > 100) sentLog.shift();
  return {};
}

function transport(env) {
  return env.TELEGRAM_BOT_TOKEN ? callApi : fakeApi;
}

let cachedUsername = null;
async function botUsername(env) {
  if (env.TELEGRAM_BOT_USERNAME) return env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
  if (!env.TELEGRAM_BOT_TOKEN) return env.HORIZON_DEV === '1' ? 'HorizonDevBot' : null;
  if (!cachedUsername) cachedUsername = (await callApi(env, 'getMe', {})).username;
  return cachedUsername;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? '+' + digits : null;
}

function maskPhone(phone) {
  return `${phone.slice(0, phone.length - 10)} *** ***-${phone.slice(-4, -2)}-${phone.slice(-2)}`;
}

const SHARE_BUTTON = { keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
const NO_KEYBOARD = { remove_keyboard: true };

async function handleUpdate(update, { store, env, saveUser }) {
  const msg = update && update.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private' || !msg.from) return;
  const send = transport(env);
  const reply = (text, markup) => send(env, 'sendMessage', { chat_id: msg.chat.id, text, ...(markup ? { reply_markup: markup } : {}) });

  if (typeof msg.text === 'string' && msg.text.startsWith('/start')) {
    const nonce = msg.text.split(/\s+/)[1];
    if (!nonce) {
      return reply('Это бот браузера Horizon для подтверждения номера телефона. Откройте профиль в Horizon и нажмите «Подтвердить номер через Telegram».');
    }
    const link = await store.get(`tglink:${nonce}`);
    if (!link) return reply('Ссылка устарела. Откройте профиль в Horizon и нажмите «Подтвердить номер» ещё раз.');
    await store.del(`tglink:${nonce}`);
    await store.set(`tgpending:${msg.chat.id}`, { userId: link.userId, fromId: msg.from.id }, 600);
    // Показываем, к какому аккаунту привяжется номер, — чтобы по чужой ссылке не подтвердить свой номер чужому.
    const owner = await store.get(`user:${link.userId}`);
    const email = owner ? owner.email.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c) : 'аккаунт';
    return reply(`Подтвердить номер для аккаунта Horizon ${email}?\n\nЕсли это ваш аккаунт — нажмите «📱 Поделиться номером» ниже. Если нет — просто ничего не нажимайте.`, SHARE_BUTTON);
  }

  // «/owner КОД» — один раз назначает владельца: того, чей номер уже подтверждён в Horizon этим Telegram.
  // Код знает только хозяин сервера (OWNER_CLAIM_CODE в настройках Vercel). После назначения команда не работает.
  if (typeof msg.text === 'string' && /^\/owner(\s|$)/.test(msg.text)) {
    const attempts = await store.incr(`rate:owner:${msg.from.id}`, 3600);
    const code = msg.text.split(/\s+/)[1] || '';
    const expected = String(env.OWNER_CLAIM_CODE || '');
    const crypto = require('node:crypto');
    const same = expected.length > 0 && code.length === expected.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected));
    if (attempts > 5 || !same) return reply('Команда не распознана.');
    if (await store.get('owner')) return reply('Владелец уже назначен.');
    const userId = await store.get(`tg:${msg.from.id}`);
    const user = userId && (await store.get(`user:${userId}`));
    if (!user) return reply('Сначала войдите в аккаунт Horizon и подтвердите номер через этого бота, потом пришлите команду ещё раз.');
    user.role = 'owner';
    await saveUser(user);
    await store.set('owner', user.id);
    return reply(`👑 Готово: аккаунт ${user.name || user.email} — владелец Horizon. Перезайдите в профиль, чтобы увидеть панель управления.`);
  }

  if (typeof msg.text === 'string' && /^\/help(\s|$)/.test(msg.text)) {
    return reply(
      'Я бот браузера Horizon.\n\n' +
        '📱 Подтверждаю номер: в Horizon откройте профиль → «Подтвердить через Telegram», здесь нажмите «Поделиться номером».\n' +
        '🔑 Присылаю код для нового пароля: в Horizon нажмите «Забыли пароль?» — код придёт сюда, если номер подтверждён.\n\n' +
        'Сам я никому не пишу и ваш номер никому не передаю.',
    );
  }

  if (msg.contact) {
    const pending = await store.get(`tgpending:${msg.chat.id}`);
    if (!pending) return reply('Сначала откройте профиль в Horizon и нажмите «Подтвердить номер через Telegram».', NO_KEYBOARD);
    // Принимаем только собственный номер, отправленный кнопкой, а не пересланный чужой контакт.
    if (msg.contact.user_id !== msg.from.id || pending.fromId !== msg.from.id) {
      return reply('Отправьте свой номер кнопкой «📱 Поделиться номером», а не чужой контакт.', SHARE_BUTTON);
    }
    const phone = normalizePhone(msg.contact.phone_number);
    if (!phone) return reply('Не удалось прочитать номер. Попробуйте ещё раз.', SHARE_BUTTON);
    const owner = await store.get(`phone:${phone}`);
    if (owner && owner !== pending.userId) return reply('Этот номер уже привязан к другому аккаунту Horizon.', NO_KEYBOARD);
    const user = await store.get(`user:${pending.userId}`);
    if (!user) return reply('Аккаунт не найден.', NO_KEYBOARD);
    if (user.phone && user.phone !== phone) await store.del(`phone:${user.phone}`);
    user.phone = phone;
    user.phoneVerifiedAt = Date.now();
    user.telegramId = msg.from.id;
    user.telegramUsername = msg.from.username || null;
    await saveUser(user);
    await store.set(`phone:${phone}`, user.id);
    await store.set(`tg:${msg.from.id}`, user.id);
    await store.del(`tgpending:${msg.chat.id}`);
    return reply(`✅ Номер ${maskPhone(phone)} подтверждён. Можно вернуться в Horizon.`, NO_KEYBOARD);
  }

  return reply('Нажмите кнопку «📱 Поделиться номером» или откройте ссылку из Horizon заново.');
}

// Сообщение пользователю от бота (например, код для нового пароля).
async function sendText(env, chatId, text) {
  if (!chatId) return;
  await transport(env)(env, 'sendMessage', { chat_id: chatId, text });
}

module.exports = { sendText, handleUpdate, botUsername, callApi, normalizePhone, maskPhone, sentLog };
