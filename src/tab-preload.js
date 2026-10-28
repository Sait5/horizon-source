// Скрипт вкладки: находит формы входа и подставляет пароль по команде браузера.
// Странице ничего не передаётся: у неё нет доступа к этому скрипту и к сейфу.
const { ipcRenderer } = require('electron');

// Вход по ключу доступа (passkey) выключен самим движком (ключ запуска disable-blink-features=WebAuth):
// окно «Безопасность Windows» с USB-ключом не появляется, а функции страниц не подменяются.

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
const USER_TYPES = new Set(['text', 'email', 'tel', '']);

function visible(el) {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function passwordFields() {
  return [...document.querySelectorAll('input[type="password"]')].filter(visible);
}

function usernameFor(passwordInput) {
  const scope = passwordInput.form || document;
  const byHint = scope.querySelector('input[autocomplete="username"], input[autocomplete="email"]');
  if (byHint && visible(byHint)) return byHint;
  const inputs = [...scope.querySelectorAll('input')];
  for (let i = inputs.indexOf(passwordInput) - 1; i >= 0; i--) {
    const input = inputs[i];
    if (USER_TYPES.has(input.type) && visible(input) && !input.readOnly) return input;
  }
  return null;
}

function setValue(input, value) {
  if (!input) return;
  input.focus();
  valueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

let reported = null;
function report() {
  const has = passwordFields().length > 0;
  if (has !== reported) {
    reported = has;
    ipcRenderer.send('pw:fields', has);
  }
}

let lastSent = '';
function capture(scope) {
  const field = [...(scope || document).querySelectorAll('input[type="password"]')].find((f) => f.value);
  if (!field) return;
  const user = usernameFor(field);
  const payload = { username: user ? user.value.trim() : '', password: field.value };
  const fingerprint = payload.username + '\n' + payload.password;
  if (fingerprint === lastSent) return;
  lastSent = fingerprint;
  ipcRenderer.send('pw:submitted', payload);
}

document.addEventListener('submit', (event) => capture(event.target), true);
document.addEventListener(
  'click',
  (event) => {
    const button = event.target.closest && event.target.closest('button, input[type="submit"], [role="button"]');
    if (button) capture(button.form || button.closest('form') || document);
  },
  true,
);
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) capture(event.target.form || document);
  },
  true,
);

let timer = null;
window.addEventListener('DOMContentLoaded', () => {
  report();
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(report, 400);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class'] });
});

// Стартовая странице Horizon перерисовывается, когда меняется оформление или сохранённые вкладки.
ipcRenderer.on('horizon:refresh', () => {
  if (location.protocol === 'horizon:') window.dispatchEvent(new Event('horizon-refresh'));
});

ipcRenderer.on('horizon:reveal', () => {
  if (location.protocol === 'horizon:') window.dispatchEvent(new Event('horizon-reveal'));
});
ipcRenderer.on('horizon:shown', () => {
  if (location.protocol === 'horizon:') window.dispatchEvent(new Event('horizon-shown'));
});
ipcRenderer.on('horizon:hidden', () => {
  if (location.protocol === 'horizon:') window.dispatchEvent(new Event('horizon-hidden'));
});
ipcRenderer.on('horizon:hold', () => {
  if (location.protocol === 'horizon:') window.dispatchEvent(new Event('horizon-hold'));
});

ipcRenderer.on('pw:fill', (_event, { origin, username, password }) => {
  // Вторая проверка сайта на случай, если страница сменилась, пока шла команда.
  if (location.origin !== origin) return;
  const field = passwordFields()[0];
  if (!field) return;
  setValue(usernameFor(field), username);
  setValue(field, password);
});
