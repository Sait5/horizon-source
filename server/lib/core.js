// Сервер аккаунтов Horizon: регистрация по почте, вход, профиль, сеансы на устройствах,
// подтверждение номера через Telegram-бота. Не зависит от хостинга: одинаково работает на Vercel и у себя.
const crypto = require('node:crypto');
const sec = require('./security');
const mail = require('./mail');
const telegram = require('./telegram');

const CODE_TTL = 15 * 60;
const SESSION_TTL = 90 * 24 * 3600;
const LINK_TTL = 10 * 60;
const DUMMY_HASH = sec.hashPassword('horizon-dummy-password');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email);
}

// Роли: владелец — один (назначается секретной командой боту или в настройках сервера),
// администраторов назначает владелец, остальные — пользователи.
// Номер и ник считаются только подтверждёнными через Telegram, поэтому их нельзя присвоить себе.
function isOwner(user, env) {
  if (user.role === 'owner') return true;
  const list = (value) => String(value || '').split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const phone = user.phone ? user.phone.replace(/\D/g, '') : '';
  if (phone && list(env.ADMIN_PHONES).map((p) => p.replace(/\D/g, '')).includes(phone)) return true;
  if (user.phone && user.telegramUsername && list(env.ADMIN_TELEGRAM).includes(user.telegramUsername.toLowerCase())) return true;
  return Boolean(user.emailVerified && list(env.ADMIN_EMAILS).includes(user.email));
}

function roleOf(user, env) {
  if (isOwner(user, env)) return 'owner';
  return user.role === 'admin' ? 'admin' : 'user';
}

function isAdmin(user, env) {
  return roleOf(user, env) !== 'user';
}

// Дата рождения: «ГГГГ-ММ-ДД», возраст от 5 до 120 лет.
function parseBirthDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) fail(400, 'Укажите дату рождения');
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCMonth() !== Number(m[2]) - 1 || date.getUTCDate() !== Number(m[3])) fail(400, 'Проверьте дату рождения');
  const age = ageOf(m[0]);
  if (age < 5 || age > 120) fail(400, 'Проверьте дату рождения');
  return m[0];
}

function ageOf(birthDate) {
  if (!birthDate) return null;
  const [y, mo, d] = birthDate.split('-').map(Number);
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age;
}

function publicUser(user, env = {}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: Boolean(user.emailVerified),
    phone: user.phone || null,
    phoneVerified: Boolean(user.phone),
    avatar: user.avatar || null,
    created: user.created,
    admin: isAdmin(user, env),
    role: roleOf(user, env),
    birthDate: user.birthDate || null,
    age: ageOf(user.birthDate),
    // До 18 лет — детский режим. Дату нельзя поменять самому, поэтому обойти его нельзя.
    adult: user.birthDate ? ageOf(user.birthDate) >= 18 : null,
  };
}

function createApp({ store, env }) {
  const secret = env.SERVER_SECRET || 'horizon-dev-secret';
  if (!env.SERVER_SECRET && env.VERCEL) console.warn('Не задан SERVER_SECRET — задайте его в настройках Vercel');

  async function limit(scope, key, max, windowSec) {
    const count = await store.incr(`rate:${scope}:${key}`, windowSec);
    if (count > max) fail(429, 'Слишком много попыток. Попробуйте позже.');
  }

  async function userByEmail(email) {
    const id = await store.get(`email:${email}`);
    return id ? store.get(`user:${id}`) : null;
  }

  const saveUser = (user) => store.set(`user:${user.id}`, user);

  async function sendEmailCode(email, purpose) {
    await limit('mail', email, 6, 3600);
    const code = sec.newCode();
    await store.set(`code:${purpose}:${email}`, { hash: sec.hashCode(code, email, secret), attempts: 0 }, CODE_TTL);
    await mail.sendCode(env, email, code, purpose);
    return code;
  }

  // Пока сервер работает у себя без почты, код показывается прямо в Horizon (только для проверки).
  const devCode = (code) => (env.HORIZON_DEV === '1' && !env.SMTP_HOST ? { devCode: code } : {});
  // Почту подтверждаем, только когда подключена отправка писем (SMTP) или идёт проверка у себя.
  // Без почты аккаунт работает сразу, а пароль восстанавливается кодом в Telegram.
  const verifyEmail = Boolean(env.SMTP_HOST) || env.HORIZON_DEV === '1';

  async function sendTelegramCode(user) {
    await limit('tgcode', user.id, 6, 3600);
    const code = sec.newCode();
    await store.set(`code:reset:${user.email}`, { hash: sec.hashCode(code, user.email, secret), attempts: 0 }, CODE_TTL);
    await telegram.sendText(env, user.telegramId, `Код для нового пароля в браузере Horizon: ${code}

Никому не сообщайте его. Если вы не просили сменить пароль — просто ничего не делайте.`);
  }

  async function checkEmailCode(email, purpose, code) {
    const key = `code:${purpose}:${email}`;
    const record = await store.get(key);
    if (!record) fail(400, 'Код устарел. Запросите новый.');
    if (record.attempts >= 5) {
      await store.del(key);
      fail(400, 'Слишком много неверных попыток. Запросите новый код.');
    }
    if (!sec.safeEqual(record.hash, sec.hashCode(String(code || '').trim(), email, secret))) {
      record.attempts++;
      await store.set(key, record, CODE_TTL);
      fail(400, 'Неверный код');
    }
    await store.del(key);
  }

  // Новый вход с того же компьютера заменяет его прежний сеанс, а не добавляет ещё одно «устройство».
  // Компьютер узнаётся по постоянному номеру (deviceId); у старых сеансов без номера — по названию.
  async function createSession(user, body, ip) {
    const device = String((body && body.device) || 'Horizon').slice(0, 100);
    const rawId = String((body && body.deviceId) || '');
    const deviceId = /^[a-f0-9-]{16,64}$/i.test(rawId) ? rawId : null;
    const token = sec.newToken();
    const hash = sec.sha256(token);
    const list = (await store.get(`sessions:${user.id}`)) || [];
    const keep = [];
    for (const h of list) {
      const old = await store.get(`session:${h}`);
      if (!old) continue;
      const sameDevice = Boolean(deviceId) && (old.deviceId === deviceId || (!old.deviceId && old.device === device));
      if (sameDevice) await store.del(`session:${h}`);
      else keep.push(h);
    }
    await store.set(`session:${hash}`, { userId: user.id, device, deviceId, created: Date.now(), lastSeen: Date.now(), ip }, SESSION_TTL);
    keep.push(hash);
    await store.set(`sessions:${user.id}`, keep.slice(-30));
    return token;
  }

  async function dropSessions(userId, keepHash = null) {
    const list = (await store.get(`sessions:${userId}`)) || [];
    for (const hash of list) if (hash !== keepHash) await store.del(`session:${hash}`);
    await store.set(`sessions:${userId}`, keepHash ? [keepHash] : []);
  }

  async function auth(headers) {
    const header = String(headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) fail(401, 'Нужно войти в аккаунт');
    const hash = sec.sha256(token);
    const session = await store.get(`session:${hash}`);
    if (!session) fail(401, 'Сеанс завершён. Войдите снова.');
    const user = await store.get(`user:${session.userId}`);
    if (!user) fail(401, 'Аккаунт не найден');
    if (user.blocked) fail(401, 'Аккаунт заблокирован администратором');
    if (Date.now() - session.lastSeen > 3600 * 1000) {
      session.lastSeen = Date.now();
      await store.set(`session:${hash}`, session, SESSION_TTL);
    }
    return { user, session, hash };
  }

  const routes = {
    // ---------- Регистрация и вход ----------
    'POST /api/auth/register': async ({ body, ip }) => {
      await limit('register', ip, 10, 3600);
      const email = normEmail(body.email);
      const name = String(body.name || '').trim().slice(0, 60);
      if (!validEmail(email)) fail(400, 'Проверьте адрес почты');
      if (!name) fail(400, 'Укажите имя');
      const problem = sec.passwordProblem(body.password);
      if (problem) fail(400, problem);
      const birthDate = parseBirthDate(body.birthDate);
      const existing = await userByEmail(email);
      // Без подтверждения почты нельзя перезаписать чужой аккаунт повторной регистрацией.
      if (existing && (existing.emailVerified || !verifyEmail)) fail(409, 'Эта почта уже зарегистрирована. Войдите или восстановите пароль.');
      const user = existing || { id: crypto.randomUUID(), email, created: Date.now() };
      Object.assign(user, { name, birthDate, passHash: sec.hashPassword(body.password), emailVerified: false });
      await saveUser(user);
      await store.set(`email:${email}`, user.id);
      if (!verifyEmail) return { token: await createSession(user, body, ip), user: publicUser(user, env) };
      return { needCode: true, ...devCode(await sendEmailCode(email, 'verify')) };
    },

    'POST /api/auth/verify-email': async ({ body, ip }) => {
      await limit('verify', ip, 30, 3600);
      const email = normEmail(body.email);
      const user = await userByEmail(email);
      if (!user) fail(400, 'Неверный код');
      await checkEmailCode(email, 'verify', body.code);
      user.emailVerified = true;
      await saveUser(user);
      return { token: await createSession(user, body, ip), user: publicUser(user, env) };
    },

    'POST /api/auth/resend': async ({ body, ip }) => {
      await limit('resend', ip, 10, 3600);
      const email = normEmail(body.email);
      const user = await userByEmail(email);
      if (user && !user.emailVerified) return { ok: true, ...devCode(await sendEmailCode(email, 'verify')) };
      return { ok: true };
    },

    'POST /api/auth/login': async ({ body, ip }) => {
      await limit('login-ip', ip, 40, 900);
      const email = normEmail(body.email);
      await limit('login', email, 10, 900);
      const user = await userByEmail(email);
      // Проверка пароля идёт и для несуществующей почты — по времени ответа нельзя узнать, есть ли аккаунт.
      const ok = sec.checkPassword(body.password, user ? user.passHash : DUMMY_HASH);
      if (!user || !ok) fail(401, 'Неверная почта или пароль');
      if (user.blocked) fail(403, 'Аккаунт заблокирован администратором');
      if (!user.emailVerified && verifyEmail) {
        return { needCode: true, ...devCode(await sendEmailCode(email, 'verify')) };
      }
      return { token: await createSession(user, body, ip), user: publicUser(user, env) };
    },

    'POST /api/auth/forgot': async ({ body, ip }) => {
      await limit('forgot', ip, 10, 3600);
      const email = normEmail(body.email);
      const user = await userByEmail(email);
      if (!verifyEmail) {
        // Без почты код приходит от бота в Telegram — если к аккаунту привязан номер.
        if (user && user.telegramId) await sendTelegramCode(user).catch(() => {});
        return { ok: true, via: 'telegram' };
      }
      if (user) return { ok: true, ...devCode(await sendEmailCode(email, 'reset')) };
      return { ok: true }; // ответ одинаковый — не раскрываем, есть ли такая почта
    },

    'POST /api/auth/reset': async ({ body, ip }) => {
      await limit('reset', ip, 20, 3600);
      const email = normEmail(body.email);
      const user = await userByEmail(email);
      if (!user) fail(400, 'Неверный код');
      const problem = sec.passwordProblem(body.password);
      if (problem) fail(400, problem);
      await checkEmailCode(email, 'reset', body.code);
      user.passHash = sec.hashPassword(body.password);
      if (verifyEmail) user.emailVerified = true; // код пришёл на почту — значит, она настоящая
      await saveUser(user);
      await dropSessions(user.id); // после сброса пароля все старые сеансы завершаются
      return { token: await createSession(user, body, ip), user: publicUser(user, env) };
    },

    'POST /api/auth/logout': async ({ headers }) => {
      const { user, hash } = await auth(headers);
      await store.del(`session:${hash}`);
      const list = (await store.get(`sessions:${user.id}`)) || [];
      await store.set(`sessions:${user.id}`, list.filter((h) => h !== hash));
      return { ok: true };
    },

    // ---------- Профиль ----------
    'GET /api/profile': async ({ headers }) => ({ user: publicUser((await auth(headers)).user, env) }),

    'POST /api/profile': async ({ headers, body }) => {
      const { user } = await auth(headers);
      if (body.name !== undefined) {
        const name = String(body.name).trim().slice(0, 60);
        if (!name) fail(400, 'Имя не может быть пустым');
        user.name = name;
      }
      if (body.avatar !== undefined) {
        if (body.avatar === null) delete user.avatar;
        else if (typeof body.avatar === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.avatar) && body.avatar.length <= 200000) user.avatar = body.avatar;
        else fail(400, 'Картинка должна быть PNG, JPG или WEBP до 150 КБ');
      }
      await saveUser(user);
      return { user: publicUser(user, env) };
    },

    // Дату рождения указывают один раз (для старых аккаунтов без неё). Сменить её потом нельзя.
    'POST /api/profile/birthdate': async ({ headers, body }) => {
      const { user } = await auth(headers);
      if (user.birthDate) fail(400, 'Дата рождения уже указана, изменить её нельзя.');
      user.birthDate = parseBirthDate(body.birthDate);
      await saveUser(user);
      return { user: publicUser(user, env) };
    },

    'POST /api/profile/password': async ({ headers, body }) => {
      const { user, hash } = await auth(headers);
      if (!sec.checkPassword(body.current, user.passHash)) fail(400, 'Текущий пароль неверный');
      const problem = sec.passwordProblem(body.password);
      if (problem) fail(400, problem);
      user.passHash = sec.hashPassword(body.password);
      await saveUser(user);
      await dropSessions(user.id, hash); // на других устройствах придётся войти заново
      return { ok: true };
    },

    'POST /api/profile/delete': async ({ headers, body }) => {
      const { user } = await auth(headers);
      if (!sec.checkPassword(body.password, user.passHash)) fail(400, 'Неверный пароль');
      await dropSessions(user.id);
      await store.del(`sessions:${user.id}`);
      await store.del(`email:${user.email}`);
      if (user.phone) await store.del(`phone:${user.phone}`);
      await store.del(`user:${user.id}`);
      return { ok: true };
    },

    // ---------- Устройства ----------
    'GET /api/sessions': async ({ headers }) => {
      const { user, hash } = await auth(headers);
      const list = (await store.get(`sessions:${user.id}`)) || [];
      const sessions = [];
      const alive = [];
      for (const h of list) {
        const s = await store.get(`session:${h}`);
        if (!s) continue;
        alive.push(h);
        sessions.push({ id: h.slice(0, 16), device: s.device, created: s.created, lastSeen: s.lastSeen, current: h === hash });
      }
      if (alive.length !== list.length) await store.set(`sessions:${user.id}`, alive);
      return { sessions: sessions.reverse() };
    },

    'POST /api/sessions/revoke': async ({ headers, body }) => {
      const { user } = await auth(headers);
      const list = (await store.get(`sessions:${user.id}`)) || [];
      const target = list.find((h) => h.slice(0, 16) === String(body.id));
      if (!target) fail(404, 'Сеанс не найден');
      await store.del(`session:${target}`);
      await store.set(`sessions:${user.id}`, list.filter((h) => h !== target));
      return { ok: true };
    },

    // ---------- Телефон через Telegram ----------
    'POST /api/phone/start': async ({ headers }) => {
      const { user } = await auth(headers);
      const bot = await telegram.botUsername(env);
      if (!bot) fail(503, 'Telegram-бот ещё не подключён к серверу');
      const nonce = crypto.randomBytes(16).toString('base64url');
      await store.set(`tglink:${nonce}`, { userId: user.id }, LINK_TTL);
      // web — Telegram прямо в браузере, без установки приложения.
      const tgAddress = `tg://resolve?domain=${bot}&start=${nonce}`;
      return {
        link: `https://t.me/${bot}?start=${nonce}`,
        web: `https://web.telegram.org/k/#?tgaddr=${encodeURIComponent(tgAddress)}`,
        bot,
        expiresIn: LINK_TTL,
      };
    },

    'POST /api/phone/remove': async ({ headers }) => {
      const { user } = await auth(headers);
      if (user.phone) await store.del(`phone:${user.phone}`);
      if (user.telegramId) await store.del(`tg:${user.telegramId}`);
      delete user.phone;
      delete user.phoneVerifiedAt;
      delete user.telegramId;
      delete user.telegramUsername;
      await saveUser(user);
      return { user: publicUser(user, env) };
    },

    // Сюда Telegram присылает сообщения боту. Без секретного заголовка запрос отклоняется.
    'POST /api/telegram': async ({ headers, body }) => {
      const expected = env.TELEGRAM_WEBHOOK_SECRET || (env.HORIZON_DEV === '1' ? 'dev' : '');
      if (!expected || !sec.safeEqual(headers['x-telegram-bot-api-secret-token'] || '', expected)) fail(403, 'Нет доступа');
      await telegram.handleUpdate(body, { store, env, saveUser });
      return { ok: true };
    },

    // ---------- Администратор ----------
    // Видит список аккаунтов, может заблокировать аккаунт и завершить его сеансы.
    // Паролей, сейфа и VPN-ключей пользователей на сервере нет — их не может увидеть никто.
    'GET /api/admin/users': async ({ headers }) => {
      const { user: me } = await auth(headers);
      if (!isAdmin(me, env)) fail(403, 'Только для администратора');
      // Список строится по самим записям аккаунтов — без общего списка, который могли бы
      // перезаписать одновременные регистрации.
      const index = (await store.keys('user:')).map((key) => key.slice(5));
      const users = [];
      for (const id of index) {
        const u = await store.get(`user:${id}`);
        if (!u) continue;
        const sessions = ((await store.get(`sessions:${id}`)) || []).length;
        users.push({
          id: u.id,
          name: u.name,
          email: u.email,
          emailVerified: Boolean(u.emailVerified),
          phone: u.phone ? telegram.maskPhone(u.phone) : null,
          created: u.created,
          blocked: Boolean(u.blocked),
          admin: isAdmin(u, env),
          role: roleOf(u, env),
          age: ageOf(u.birthDate),
          sessions,
        });
      }
      return { users: users.sort((a, b) => b.created - a.created) };
    },

    'POST /api/admin/block': async ({ headers, body }) => {
      const { user: me } = await auth(headers);
      if (!isAdmin(me, env)) fail(403, 'Только для администратора');
      const target = await store.get(`user:${String(body.id)}`);
      if (!target) fail(404, 'Аккаунт не найден');
      if (target.id === me.id) fail(400, 'Нельзя заблокировать самого себя');
      // Владельца не может заблокировать никто, админа — только владелец.
      if (isOwner(target, env)) fail(403, 'Владельца заблокировать нельзя');
      if (isAdmin(target, env) && !isOwner(me, env)) fail(403, 'Администратора может заблокировать только владелец');
      target.blocked = Boolean(body.blocked);
      await saveUser(target);
      if (target.blocked) await dropSessions(target.id);
      return { ok: true };
    },

    'POST /api/admin/logout': async ({ headers, body }) => {
      const { user: me } = await auth(headers);
      if (!isAdmin(me, env)) fail(403, 'Только для администратора');
      const target = await store.get(`user:${String(body.id)}`);
      if (target && isOwner(target, env) && !isOwner(me, env)) fail(403, 'Сеансы владельца завершать нельзя');
      await dropSessions(String(body.id));
      return { ok: true };
    },

    // Выдать или снять админку может только владелец.
    'POST /api/admin/role': async ({ headers, body }) => {
      const { user: me } = await auth(headers);
      if (!isOwner(me, env)) fail(403, 'Только владелец назначает администраторов');
      const target = await store.get(`user:${String(body.id)}`);
      if (!target) fail(404, 'Аккаунт не найден');
      if (isOwner(target, env)) fail(400, 'Роль владельца не меняется');
      if (body.role !== 'admin' && body.role !== 'user') fail(400, 'Неизвестная роль');
      target.role = body.role;
      await saveUser(target);
      return { ok: true };
    },

    'GET /api/health': async () => ({ ok: true, mail: Boolean(env.SMTP_HOST), verifyEmail, telegram: Boolean(env.TELEGRAM_BOT_TOKEN) }),
  };

  if (env.HORIZON_DEV === '1') {
    routes['GET /api/dev/outbox'] = async () => ({ outbox: mail.outbox, telegram: telegram.sentLog });
  }

  async function handle({ method, path, headers = {}, body, ip }) {
    const route = routes[`${method} ${String(path).replace(/\/+$/, '')}`];
    if (!route) return { status: 404, json: { error: 'Не найдено' } };
    try {
      return { status: 200, json: await route({ headers, body: body && typeof body === 'object' ? body : {}, ip: ip || 'unknown' }) };
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, json: { error: error.message } };
      console.error(error);
      return { status: 500, json: { error: 'Ошибка сервера. Попробуйте позже.' } };
    }
  }

  return { handle };
}

module.exports = { createApp };
