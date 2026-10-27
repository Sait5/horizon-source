// Письма с кодами. Отправка через любой SMTP (например, Gmail с паролем приложения или Brevo — бесплатно).
// Без настроек SMTP письмо не отправляется, а код пишется в журнал сервера (режим разработки).
let transporter = null;

function getTransporter(env) {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 465),
      secure: Number(env.SMTP_PORT || 465) === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
}

const outbox = []; // только для разработки и проверок

function codeLetter(code, purpose) {
  const title = purpose === 'reset' ? 'Сброс пароля Horizon' : 'Код подтверждения Horizon';
  const action = purpose === 'reset' ? 'сбросить пароль' : 'подтвердить почту';
  const text = `${title}\n\nВаш код: ${code}\n\nВведите его в Horizon, чтобы ${action}. Код действует 15 минут.\nЕсли это были не вы — просто удалите письмо.`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#1b2230">
    <h2 style="margin:0 0 12px">${title}</h2>
    <p>Введите этот код в Horizon, чтобы ${action}:</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px;background:#f2f4f7;border-radius:12px;text-align:center">${code}</div>
    <p style="color:#5f6b7c;font-size:13px">Код действует 15 минут. Если это были не вы — просто удалите письмо.</p>
  </div>`;
  return { subject: title, text, html };
}

async function sendCode(env, email, code, purpose) {
  const letter = codeLetter(code, purpose);
  const t = getTransporter(env);
  if (!t) {
    outbox.push({ email, code, purpose, at: Date.now() });
    if (outbox.length > 50) outbox.shift();
    console.log(`[почта, режим разработки] ${email}: ${letter.subject} — код ${code}`);
    return;
  }
  await t.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, to: email, subject: letter.subject, text: letter.text, html: letter.html });
}

module.exports = { sendCode, outbox };
