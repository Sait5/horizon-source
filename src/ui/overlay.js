// Панели поверх страницы: VPN, сейф паролей, подстановка и сохранение пароля.
const panel = document.getElementById('panel');
const api = window.overlay;

const ICONS = {
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />',
  key: '<circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" />',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />',
  close: '<path d="M6 6l12 12M18 6L6 18" />',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />',
  refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19 4v4h-4" />',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" />',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  qr: '<rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14h2v2M20 14v6h-6" />',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />',
  image: '<rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" />',
  search: '<circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />',
  user: '<circle cx="12" cy="9" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" />',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 17h2" />',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />',
  up: '<path d="M6 15l6-6 6 6" />',
  down: '<path d="M6 9l6 6 6-6" />',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
  globe: '<circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.5 2.7 2.5 13.3 0 16M12 4c-2.5 2.7-2.5 13.3 0 16" />',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" />',
  hello: '<circle cx="12" cy="10" r="3" /><path d="M6 19a6 6 0 0 1 12 0M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />',
};

let mode = null;
let payload = {};
let vpn = null;
let vault = null;
let entries = [];
let form = {};
let note = { text: '', kind: '' };
let view = '';
let busy = false;
let recoveryCode = null;
let tfa = null;
let revealed = {};
let confirmDelete = null;

// ---------- Мелкие помощники ----------

function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" class="${cls}">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = Boolean(value);
    else if (key === 'style') el.style.cssText = value; // через CSSOM: строгая CSP запрещает атрибут style

    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function field(name, { type = 'text', placeholder = '', mono = false, autofocus = false, onEnter } = {}) {
  return h('input', {
    class: 'input' + (mono ? ' mono' : ''),
    type,
    placeholder,
    autocomplete: type === 'password' ? 'new-password' : 'off',
    spellcheck: 'false',
    value: form[name] || '',
    'data-name': name,
    'data-autofocus': autofocus ? '1' : null,
    onInput: (e) => (form[name] = e.target.value),
    onKeydown: onEnter ? (e) => e.key === 'Enter' && !busy && onEnter() : null,
  });
}

function button(label, onClick, { kind = '', iconName = null, disabled = false, title = null } = {}) {
  return h(
    'button',
    { class: `btn ${kind}`, disabled: disabled || busy, title, onClick },
    iconName ? icon(iconName) : null,
    label,
  );
}

function iconButton(name, title, onClick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, title, 'aria-label': title, onClick }, icon(name));
}

// Дата рождения тремя списками: день, месяц, год — понятнее и надёжнее календаря.
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function birthPicker(name) {
  const [y0, m0, d0] = String(form[name] || '').split('-');
  const sync = () => {
    const y = form[name + 'Y'];
    const m = form[name + 'M'];
    const d = form[name + 'D'];
    form[name] = y && m && d ? `${y}-${m}-${d}` : '';
  };
  const select = (part, placeholder, options, initial) => {
    if (form[name + part] === undefined && initial) form[name + part] = initial;
    const el = h('select', { class: 'input birth-part', 'aria-label': placeholder, onChange: (e) => { form[name + part] = e.target.value; sync(); } },
      h('option', { value: '' }, placeholder),
      options.map(([value, label]) => h('option', { value, selected: form[name + part] === value ? true : null }, label)));
    return el;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const year = new Date().getFullYear();
  const box = h('div', { class: 'birth' },
    select('D', 'День', Array.from({ length: 31 }, (_, i) => [pad(i + 1), String(i + 1)]), d0),
    select('M', 'Месяц', MONTHS.map((m, i) => [pad(i + 1), m]), m0),
    select('Y', 'Год', Array.from({ length: 110 }, (_, i) => [String(year - 5 - i), String(year - 5 - i)]), y0));
  sync();
  return box;
}

function noteEl() {
  return h('div', { class: `note ${note.kind}`, role: 'status' }, note.text);
}

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function formatBytes(n) {
  if (!n) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function action(fn, okText) {
  busy = true;
  // Пока ждём сервер, видно, что идёт работа (кнопки неактивны).
  note = { text: 'Подождите, отправляю…', kind: '' };
  render();
  const waiting = note;
  try {
    const result = await fn();
    if (note === waiting) note = { text: '', kind: '' }; // «Подождите…» убираем, если действие не написало своё
    const text = typeof okText === 'function' ? okText(result) : okText;
    if (text) note = { text, kind: 'ok' };
  } catch (error) {
    note = { text: error.message, kind: 'error' };
  }
  busy = false;
  render();
}

async function refreshVault() {
  vault = await api.call('vault.status');
  entries = vault.unlocked ? await api.call('vault.list') : [];
  if (mode === 'fill' && vault.unlocked) payload.entries = await api.call('fill.list');
}

// ---------- Отрисовка ----------

function render() {
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.name : null;
  panel.className = 'panel open';
  panel.style.left = panel.style.right = '';
  const isModal = mode === 'vault' || mode === 'account';
  document.body.classList.toggle('modal', isModal);

  let content;
  if (mode === 'suggest') {
    panel.classList.add('dropdown', 'suggest');
    const a = payload.anchor || {};
    panel.style.left = `${Math.max(8, a.left || 8)}px`;
    panel.style.width = `${Math.min(a.width || 600, window.innerWidth - 16)}px`;
    panel.replaceChildren(renderSuggest());
    return;
  }
  panel.style.width = '';
  if (mode === 'find') {
    panel.classList.add('find');
    panel.replaceChildren(renderFind());
    const input = panel.querySelector('input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return;
  }
  if (mode === 'vpn') content = renderVpn();
  else if (mode === 'downloads') content = renderDownloads();
  else if (mode === 'vault') content = renderVault();
  else if (mode === 'account') content = renderAccount();
  else if (mode === 'fill') content = renderFill();
  else if (mode === 'save') content = renderSave();
  else {
    panel.className = 'panel';
    return;
  }

  if (isModal) {
    panel.classList.add('modal');
  } else {
    panel.classList.add('dropdown');
    const a = payload.anchor || {};
    if (a.right !== undefined) panel.style.right = `${Math.max(8, window.innerWidth - a.right)}px`;
    else panel.style.left = `${Math.max(8, Math.min(a.left || 8, window.innerWidth - 388))}px`;
  }
  panel.replaceChildren(...[content].flat(Infinity).filter(Boolean));

  const target =
    (focused && panel.querySelector(`[data-name="${focused}"]`)) || panel.querySelector('[data-autofocus="1"]');
  if (target) {
    target.focus();
    if (target.setSelectionRange && target.type !== 'checkbox') target.setSelectionRange(target.value.length, target.value.length);
  }
}

function head(title, iconName, ...extra) {
  return h('div', { class: 'head' }, icon(iconName, 'icon'), h('h2', null, title), extra, iconButton('close', 'Закрыть', () => api.close()));
}

// ---------- VPN ----------

function renderVpn() {
  const s = vpn;
  const statusText = {
    off: 'Выключен',
    connecting: 'Подключение…',
    on: s.ip ? `Подключён · IP ${s.ip}` : 'Подключён',
    lost: 'Соединение потеряно',
    error: 'Не удалось подключиться',
  }[s.status];

  const toggle = h('button', {
    class: 'switch' + (s.enabled ? ' on' : ''),
    role: 'switch',
    'aria-checked': String(s.enabled),
    title: s.enabled ? 'Выключить VPN' : 'Включить VPN',
    disabled: busy || (!s.enabled && !s.configs.length),
    onClick: () => action(() => api.call('vpn.setEnabled', !s.enabled)),
  });

  const problem =
    s.enabled && (s.status === 'lost' || s.status === 'error')
      ? h(
          'div',
          { class: 'alert' },
          h('p', null, s.message || 'Нет связи с сервером VPN.'),
          h('p', { class: 'muted small' }, 'Прямое подключение заблокировано, чтобы трафик не ушёл мимо VPN.'),
          h(
            'div',
            { class: 'row' },
            button('Переподключить', () => action(() => api.call('vpn.reconnect')), { kind: 'primary' }),
            button('Выключить VPN', () => action(() => api.call('vpn.setEnabled', false))),
          ),
        )
      : null;

  return [
    h('div', { class: 'head' }, icon('shield', 'icon'), h('h2', null, 'Horizon VPN'), toggle),
    h('div', { class: 'status' }, h('span', { class: `dot ${s.status}` }), h('span', null, statusText)),
    problem,
    h(
      'div',
      { class: 'scroll' },
      h(
        'div',
        { class: 'section' },
        h(
          'div',
          { class: 'row', style: 'margin-bottom: 8px' },
          h('p', { class: 'section-title', style: 'flex:1;margin:0' }, `Серверы${s.configs.length ? ` · ${s.configs.length}` : ''}`),
          s.configs.length > 1
            ? button('Проверить задержку', () => action(() => api.call('vpn.ping'), (p) => {
                const alive = Object.values(p).filter((v) => v !== null);
                return alive.length ? `Отвечают ${alive.length} из ${Object.keys(p).length}, лучший — ${Math.min(...alive)} мс` : 'Ни один сервер не ответил';
              }), { kind: 'ghost' })
            : null,
        ),
        renderServers(),
      ),
      renderAdd(),
    ),
    h(
      'div',
      { class: 'section' },
      h('p', { class: 'muted small' }, 'Через VPN идёт только трафик Horizon. Остальные программы Windows работают напрямую.'),
      s.status === 'on'
        ? button('Проверить связь', () => action(() => api.call('vpn.test'), (ms) => `Сервер ответил за ${ms} мс`), { kind: 'ghost' })
        : null,
    ),
  ];
}

function serverRow(config) {
  const selected = config.id === vpn.selectedId;
  return h(
    'div',
    {
      class: 'server' + (selected ? ' selected' : ''),
      onClick: () => !selected && action(() => api.call('vpn.select', config.id)),
    },
    h('span', { class: 'radio' }),
    h('span', { class: 'server-name', title: config.name }, config.name),
    pingBadge(vpn.pings[config.id]),
    h('span', { class: 'badge' }, config.protocol),
    iconButton('trash', 'Удалить', (e) => {
      e.stopPropagation();
      action(() => api.call('vpn.remove', config.id));
    }, 'danger'),
  );
}

function pingBadge(ms) {
  if (ms === undefined) return null;
  if (ms === null) return h('span', { class: 'ping bad', title: 'Сервер не ответил' }, 'нет ответа');
  return h('span', { class: 'ping ' + (ms < 150 ? 'good' : ms < 400 ? 'mid' : 'bad'), title: 'Задержка до сервера' }, `${ms} мс`);
}

function renderServers() {
  if (!vpn.configs.length) {
    return h('div', { class: 'empty' }, 'Пока нет серверов. Добавьте ссылку, подписку или QR-код ниже.');
  }
  const manual = vpn.configs.filter((c) => !c.subscriptionId);
  const groups = [];
  if (manual.length) {
    if (vpn.subscriptions.length) groups.push(h('div', { class: 'group-head' }, h('span', { class: 'group-title' }, 'Добавленные вручную')));
    groups.push(manual.map(serverRow));
  }
  for (const sub of vpn.subscriptions) {
    const info = sub.info || {};
    const used = (info.upload || 0) + (info.download || 0);
    const parts = [];
    if (info.total || used) parts.push(`${formatBytes(used)} из ${info.total ? formatBytes(info.total) : '∞'}`);
    // Дата 2099+ у панелей означает «бессрочно».
    if (info.expire && new Date(info.expire * 1000).getFullYear() < 2099) parts.push(`до ${new Date(info.expire * 1000).toLocaleDateString('ru-RU')}`);
    groups.push(
      h(
        'div',
        { class: 'group-head' },
        h('span', { class: 'group-title', title: sub.title }, sub.title),
        parts.length ? h('span', { class: 'muted small' }, parts.join(' · ')) : null,
        iconButton('refresh', 'Обновить подписку', () =>
          action(() => api.call('vpn.refreshSubscription', sub.id), (r) => `Подписка обновлена: ${r.added} новых`),
        ),
        iconButton('trash', 'Удалить подписку', () => action(() => api.call('vpn.removeSubscription', sub.id)), 'danger'),
      ),
      vpn.configs.filter((c) => c.subscriptionId === sub.id).map(serverRow),
    );
  }
  return groups;
}

function addedText(result) {
  const skipped = result.skipped ? `, пропущено ${result.skipped}${result.reason ? ` (${result.reason})` : ''}` : '';
  return result.title ? `Подписка «${result.title}»: ${result.added} серверов${skipped}` : `Добавлено серверов: ${result.added}${skipped}`;
}

function renderAdd() {
  const add = () =>
    action(async () => {
      const result = await api.call('vpn.importText', form.vpnAdd || '');
      form.vpnAdd = '';
      return result;
    }, addedText);
  return h(
    'div',
    { class: 'section' },
    h('p', { class: 'section-title' }, 'Добавить'),
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'row' },
        field('vpnAdd', { placeholder: 'vless://, vmess://, ss://… или адрес подписки', mono: true, onEnter: add }),
        button('Добавить', add, { kind: 'primary' }),
      ),
      h(
        'div',
        { class: 'row wrap' },
        button('QR из буфера', () => action(() => api.call('vpn.importQr', 'clipboard'), addedText), { iconName: 'qr' }),
        button('QR с экрана', () => action(() => api.call('vpn.importQr', 'screen'), addedText), { iconName: 'screen' }),
        button('QR из файла', () => action(() => api.call('vpn.importQrFile'), (r) => (r ? addedText(r) : '')), { iconName: 'image' }),
      ),
    ),
    noteEl(),
  );
}

// ---------- Сейф: общие экраны ----------

function unlockForm({ compact = false } = {}) {
  const unlock = () =>
    action(async () => {
      await api.call('vault.unlock', form.master || '');
      form.master = '';
      await refreshVault();
    });
  return h(
    'div',
    { class: 'stack' },
    field('master', { type: 'password', placeholder: 'Мастер-пароль', autofocus: true, onEnter: unlock }),
    h(
      'div',
      { class: 'row' },
      button('Открыть сейф', unlock, { kind: 'primary' }),
      vault.helloEnabled
        ? button('Windows Hello', () =>
            action(async () => {
              await api.call('vault.unlockHello');
              await refreshVault();
            }), { iconName: 'hello' })
        : null,
    ),
    compact ? null : noteEl(),
  );
}

function codeScreen() {
  return h(
    'div',
    { class: 'center' },
    icon('key', 'hero-icon'),
    h('h3', null, 'Код восстановления'),
    h('p', { class: 'muted' }, 'Запишите его на бумагу или сохраните отдельно от компьютера. Только этим кодом можно вернуть пароли, если забудете мастер-пароль. Код показывается один раз.'),
    h('div', { class: 'code-box' }, recoveryCode),
    h(
      'div',
      { class: 'stack', style: 'margin-top: 12px' },
      button('Скопировать', () => action(() => api.call('clipboard.write', recoveryCode), 'Скопировано'), { iconName: 'copy' }),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: form.codeSaved, onChange: (e) => { form.codeSaved = e.target.checked; render(); } }),
        h('span', { style: 'text-align: left' }, 'Я записал код и храню его отдельно'),
      ),
      button('Готово', async () => {
        recoveryCode = null;
        form.codeSaved = false;
        view = '';
        note = { text: '', kind: '' };
        await refreshVault();
        render();
      }, { kind: 'primary', disabled: !form.codeSaved }),
    ),
    noteEl(),
  );
}

function createScreen() {
  const create = () =>
    action(async () => {
      if ((form.m1 || '') !== (form.m2 || '')) throw new Error('Пароли не совпадают');
      const result = await api.call('vault.create', form.m1 || '');
      form.m1 = form.m2 = '';
      recoveryCode = result.recoveryCode;
      view = 'code';
      await refreshVault();
    });
  return h(
    'div',
    { class: 'center' },
    icon('key', 'hero-icon'),
    h('h3', null, 'Создайте сейф паролей'),
    h('p', { class: 'muted' }, 'Пароли хранятся только на этом компьютере в зашифрованном виде. Мастер-пароль нельзя восстановить, поэтому после создания вы получите код восстановления.'),
    h(
      'div',
      { class: 'stack' },
      field('m1', { type: 'password', placeholder: 'Мастер-пароль (от 10 символов)', autofocus: true }),
      field('m2', { type: 'password', placeholder: 'Повторите мастер-пароль', onEnter: create }),
      button('Создать сейф', create, { kind: 'primary' }),
      h('button', { class: 'link', onClick: () => { view = 'import'; note = {}; render(); } }, 'Перенести сейф с другого устройства'),
    ),
    noteEl(),
  );
}

function unlockScreen() {
  return h(
    'div',
    { class: 'center' },
    icon('lock', 'hero-icon'),
    h('h3', null, 'Сейф закрыт'),
    unlockForm(),
    h(
      'div',
      { class: 'stack' },
      h('button', { class: 'link', onClick: () => { view = 'recover'; note = {}; render(); } }, 'Забыли мастер-пароль?'),
      h('button', { class: 'link', onClick: () => { view = 'import'; note = {}; render(); } }, 'Перенести сейф с другого устройства'),
    ),
  );
}

function recoverScreen() {
  const recover = () =>
    action(async () => {
      if ((form.r1 || '') !== (form.r2 || '')) throw new Error('Пароли не совпадают');
      const result = await api.call('vault.recover', form.rcode || '', form.r1 || '');
      form.rcode = form.r1 = form.r2 = '';
      recoveryCode = result.recoveryCode;
      view = 'code';
      await refreshVault();
    });
  return h(
    'div',
    { class: 'center' },
    icon('key', 'hero-icon'),
    h('h3', null, 'Восстановление по коду'),
    h('p', { class: 'muted' }, 'Введите код восстановления и придумайте новый мастер-пароль. После этого старый код перестанет работать и вы получите новый.'),
    h(
      'div',
      { class: 'stack' },
      field('rcode', { placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', mono: true, autofocus: true }),
      field('r1', { type: 'password', placeholder: 'Новый мастер-пароль' }),
      field('r2', { type: 'password', placeholder: 'Повторите новый мастер-пароль', onEnter: recover }),
      button('Восстановить', recover, { kind: 'primary' }),
      h('button', { class: 'link', onClick: () => { view = ''; note = {}; render(); } }, 'Назад'),
    ),
    noteEl(),
  );
}

function importScreen() {
  const run = () =>
    action(async () => {
      if (!form.importFile) throw new Error('Сначала выберите файл');
      await api.call('vault.import', form.importFile, form.imMaster || '', form.imCode || '');
      form.importFile = form.imMaster = form.imCode = '';
      view = '';
      await refreshVault();
    }, 'Сейф перенесён');
  return h(
    'div',
    { class: 'center' },
    icon('key', 'hero-icon'),
    h('h3', null, 'Перенос с другого устройства'),
    h('p', { class: 'muted' }, 'Выберите файл сейфа, сохранённый в Horizon на другом компьютере. Если там включено подтверждение 2FAS, понадобится код с телефона.'),
    vault.exists ? h('p', { class: 'note error' }, 'Сейф на этом компьютере будет заменён загруженным.') : null,
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'row' },
        button('Выбрать файл', () =>
          action(async () => {
            const file = await api.call('dialog.openVault');
            if (file) form.importFile = file;
          })),
        h('span', { class: 'muted small', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, form.importFile ? form.importFile.split(/[\\/]/).pop() : 'Файл не выбран'),
      ),
      field('imMaster', { type: 'password', placeholder: 'Мастер-пароль этого сейфа' }),
      field('imCode', { placeholder: 'Код из 2FAS (если включён)', mono: true, onEnter: run }),
      button('Перенести', run, { kind: 'primary' }),
      h('button', { class: 'link', onClick: () => { view = ''; note = {}; render(); } }, 'Назад'),
    ),
    noteEl(),
  );
}

// ---------- Сейф: открытый ----------

function renderVault() {
  let body;
  if (view === 'code' && recoveryCode) body = codeScreen();
  else if (view === 'import') body = importScreen();
  else if (!vault.exists) body = createScreen();
  else if (!vault.unlocked) body = view === 'recover' ? recoverScreen() : unlockScreen();
  else return [
    head(
      'Сейф паролей',
      'key',
      button('Закрыть сейф', () => action(async () => { await api.call('vault.lock'); await refreshVault(); }), { kind: 'ghost', iconName: 'lock' }),
    ),
    h(
      'div',
      { class: 'tabs' },
      [['passwords', 'Пароли'], ['security', 'Безопасность'], ['transfer', 'Перенос']].map(([id, label]) =>
        h('button', {
          class: 'tab' + ((form.vaultTab || 'passwords') === id ? ' active' : ''),
          onClick: () => { form.vaultTab = id; note = {}; render(); },
        }, label),
      ),
    ),
    h('div', { class: 'scroll' }, h('div', { class: 'section' }, renderVaultTab())),
  ];
  return [head('Сейф паролей', 'key'), h('div', { class: 'scroll' }, body)];
}

function renderVaultTab() {
  const tab = form.vaultTab || 'passwords';
  if (tab === 'security') return securityTab();
  if (tab === 'transfer') return transferTab();
  return passwordsTab();
}

function passwordsTab() {
  const query = (form.search || '').toLowerCase();
  const list = entries.filter((e) => !query || e.origin.toLowerCase().includes(query) || e.username.toLowerCase().includes(query));
  const save = () =>
    action(async () => {
      let origin = (form.newSite || '').trim();
      if (origin && !/^https?:\/\//i.test(origin)) origin = 'https://' + origin;
      await api.call('vault.save', { origin, username: form.newUser || '', password: form.newPass || '' });
      form.newSite = form.newUser = form.newPass = '';
      form.adding = false;
      await refreshVault();
    }, 'Пароль сохранён');

  return [
    h(
      'div',
      { class: 'row' },
      field('search', { placeholder: 'Поиск по сайтам и логинам' }),
      button(form.adding ? 'Отмена' : 'Добавить', () => { form.adding = !form.adding; render(); }, { iconName: form.adding ? null : 'plus' }),
    ),
    form.adding
      ? h(
          'div',
          { class: 'card stack', style: 'margin-top: 10px' },
          field('newSite', { placeholder: 'Сайт, например example.com', autofocus: true }),
          field('newUser', { placeholder: 'Логин или почта' }),
          field('newPass', { type: 'password', placeholder: 'Пароль', onEnter: save }),
          h('div', null, button('Сохранить', save, { kind: 'primary' })),
        )
      : null,
    noteEl(),
    list.length
      ? list.map((entry) =>
          h(
            'div',
            { class: 'entry' },
            h('div', { class: 'avatar' }, hostOf(entry.origin).replace(/^www\./, '').charAt(0).toUpperCase()),
            h(
              'div',
              { class: 'entry-main' },
              h('div', null, hostOf(entry.origin)),
              h('div', { class: 'muted small' }, entry.username || '(без логина)'),
              revealed[entry.id] ? h('div', { class: 'secret small' }, revealed[entry.id]) : null,
            ),
            iconButton(revealed[entry.id] ? 'eyeOff' : 'eye', revealed[entry.id] ? 'Скрыть' : 'Показать', () =>
              action(async () => {
                if (revealed[entry.id]) delete revealed[entry.id];
                else revealed[entry.id] = await api.call('vault.reveal', entry.id);
              }),
            ),
            iconButton('copy', 'Скопировать пароль', () =>
              action(() => api.call('vault.copy', entry.id), 'Пароль скопирован. Буфер обмена очистится через 30 секунд.'),
            ),
            confirmDelete === entry.id
              ? button('Удалить?', () =>
                  action(async () => {
                    confirmDelete = null;
                    await api.call('vault.remove', entry.id);
                    await refreshVault();
                  }), { kind: 'danger' })
              : iconButton('trash', 'Удалить', () => { confirmDelete = entry.id; render(); }, 'danger'),
          ),
        )
      : h('div', { class: 'empty' }, entries.length ? 'Ничего не найдено' : 'Сохранённых паролей пока нет. Horizon предложит сохранить пароль, когда вы войдёте на сайт.'),
  ];
}

function codeField(name) {
  return vault.twoFactor ? field(name, { placeholder: 'Код из 2FAS', mono: true }) : null;
}

function securityTab() {
  const tfaCard = h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('strong', null, 'Подтверждение с телефона (2FAS)'), h('span', { class: 'pill' + (vault.twoFactor ? ' on' : '') }, vault.twoFactor ? 'Включено' : 'Выключено')),
    h('p', { class: 'muted small' }, 'Код из 2FAS нужен, чтобы перенести сейф на новое устройство, сменить мастер-пароль, создать новый код восстановления или отключить эту защиту. Обычный вход на сайты подтверждать не нужно. Секреты 2FAS остаются на телефоне.'),
    vault.twoFactor
      ? h(
          'div',
          { class: 'row' },
          field('tfaOff', { placeholder: 'Код из 2FAS', mono: true }),
          button('Отключить', () =>
            action(async () => {
              await api.call('vault.tfaDisable', form.tfaOff || '');
              form.tfaOff = '';
              await refreshVault();
            }, 'Подтверждение с телефона отключено'), { kind: 'danger' }),
        )
      : tfa
        ? h(
            'div',
            { class: 'row', style: 'align-items: flex-start; gap: 14px' },
            h('img', { class: 'qr', src: tfa.qr, alt: 'QR-код для 2FAS' }),
            h(
              'div',
              { class: 'stack', style: 'flex: 1' },
              h('p', { class: 'small' }, '1. Откройте 2FAS, нажмите «+» и отсканируйте QR-код.'),
              h('p', { class: 'small' }, '2. Или введите ключ вручную:'),
              h('div', { class: 'secret small' }, tfa.secret),
              field('tfaCode', { placeholder: '6 цифр из 2FAS', mono: true, autofocus: true }),
              button('Подтвердить', () =>
                action(async () => {
                  await api.call('vault.tfaConfirm', form.tfaCode || '');
                  tfa = null;
                  form.tfaCode = '';
                  await refreshVault();
                }, 'Телефон подключён'), { kind: 'primary' }),
            ),
          )
        : button('Подключить телефон', () => action(async () => { tfa = await api.call('vault.tfaBegin'); }), { kind: 'primary' }),
  );

  const helloCard = h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('strong', null, 'Windows Hello'), h('span', { class: 'pill' + (vault.helloEnabled ? ' on' : '') }, vault.helloEnabled ? 'Включено' : 'Выключено')),
    vault.helloAvailable
      ? [
          h('p', { class: 'muted small' }, 'Сейф можно открывать лицом, отпечатком или ПИН-кодом Windows Hello вместо мастер-пароля.'),
          vault.helloEnabled
            ? button('Отключить', () => action(async () => { await api.call('vault.helloDisable'); await refreshVault(); }))
            : button('Включить', () => action(async () => { await api.call('vault.helloEnable'); await refreshVault(); }, 'Windows Hello включён'), { kind: 'primary' }),
        ]
      : h('p', { class: 'muted small' }, 'На этом компьютере Windows Hello не настроен. Его можно включить в параметрах Windows → Учётные записи → Варианты входа, а потом вернуться сюда.'),
  );

  const masterCard = h(
    'div',
    { class: 'card stack' },
    h('strong', null, 'Сменить мастер-пароль'),
    field('cmCur', { type: 'password', placeholder: 'Текущий мастер-пароль' }),
    field('cmNew', { type: 'password', placeholder: 'Новый мастер-пароль' }),
    field('cmNew2', { type: 'password', placeholder: 'Повторите новый' }),
    codeField('cmCode'),
    h('div', null, button('Сменить', () =>
      action(async () => {
        if ((form.cmNew || '') !== (form.cmNew2 || '')) throw new Error('Пароли не совпадают');
        await api.call('vault.changeMaster', form.cmCur || '', form.cmNew || '', form.cmCode || '');
        form.cmCur = form.cmNew = form.cmNew2 = form.cmCode = '';
      }, 'Мастер-пароль изменён'))),
  );

  const recoveryCard = h(
    'div',
    { class: 'card stack' },
    h('strong', null, 'Новый код восстановления'),
    h('p', { class: 'muted small' }, 'Если старый код потерян или мог попасть к кому-то, создайте новый — старый сразу перестанет работать.'),
    field('rcMaster', { type: 'password', placeholder: 'Мастер-пароль' }),
    codeField('rcCode'),
    h('div', null, button('Создать новый код', () =>
      action(async () => {
        const result = await api.call('vault.newRecovery', form.rcMaster || '', form.rcCode || '');
        form.rcMaster = form.rcCode = '';
        recoveryCode = result.recoveryCode;
        view = 'code';
      }))),
  );

  return [
    noteEl(),
    tfaCard,
    helloCard,
    masterCard,
    recoveryCard,
    h('p', { class: 'muted small', style: 'margin-top: 12px' }, 'Сейф закрывается сам через 15 минут и при блокировке Windows.'),
  ];
}

function transferTab() {
  return [
    noteEl(),
    h(
      'div',
      { class: 'card stack' },
      h('strong', null, 'Перенести на другое устройство'),
      h('p', { class: 'muted small' }, 'Сохраните файл сейфа и откройте его в Horizon на другом компьютере: Сейф → «Перенести сейф с другого устройства». Файл остаётся зашифрованным: без мастер-пароля его никто не прочитает.'),
      field('exMaster', { type: 'password', placeholder: 'Мастер-пароль' }),
      codeField('exCode'),
      h('div', null, button('Сохранить файл сейфа', () =>
        action(async () => {
          const saved = await api.call('vault.export', form.exMaster || '', form.exCode || '');
          form.exMaster = form.exCode = '';
          return saved;
        }, (saved) => (saved ? 'Файл сейфа сохранён' : '')), { kind: 'primary' })),
    ),
    h(
      'div',
      { class: 'card stack' },
      h('strong', null, 'Загрузить сейф с другого устройства'),
      h('div', null, button('Загрузить', () => { view = 'import'; note = {}; render(); })),
    ),
    h('p', { class: 'muted small', style: 'margin-top: 12px' }, 'Синхронизации через сервер пока нет: файл переносится вручную, и прочитать его можете только вы.'),
  ];
}

// ---------- Подстановка и сохранение пароля ----------

function renderFill() {
  const host = hostOf(payload.origin || '');
  let body;
  if (!vault.exists) {
    body = [h('p', { class: 'muted' }, 'Сейф паролей ещё не создан.'), button('Создать сейф', () => api.call('overlay.openVault'), { kind: 'primary' })];
  } else if (!vault.unlocked) {
    body = [h('p', { class: 'muted' }, 'Откройте сейф, чтобы подставить пароль.'), unlockForm()];
  } else if (!(payload.entries || []).length) {
    body = h('p', { class: 'muted' }, 'Для этого сайта нет сохранённых паролей.');
  } else {
    body = payload.entries.map((entry) =>
      h(
        'div',
        { class: 'entry' },
        h('div', { class: 'avatar' }, (entry.username || '?').charAt(0).toUpperCase()),
        h('div', { class: 'entry-main' }, h('div', null, entry.username || '(без логина)')),
        button('Подставить', () => action(async () => { await api.call('fill.apply', entry.id); api.close(); }), { kind: 'primary' }),
      ),
    );
  }
  return [
    head(host || 'Пароли', 'key'),
    h('div', { class: 'section' }, body, vault.unlocked ? noteEl() : null),
    h('div', { class: 'section' }, h('button', { class: 'link', onClick: () => api.call('overlay.openVault') }, 'Все пароли')),
  ];
}

function renderSave() {
  const pending = payload.pending || {};
  const save = () =>
    action(async () => {
      if (!vault.unlocked) {
        await api.call('vault.unlock', form.master || '');
        form.master = '';
      }
      await api.call('save.confirm');
      api.close();
    });
  let body;
  if (!vault.exists) {
    body = [h('p', { class: 'muted' }, 'Чтобы сохранять пароли, сначала создайте сейф.'), button('Создать сейф', () => api.call('overlay.openVault'), { kind: 'primary' })];
  } else {
    body = [
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'muted small' }, 'Логин'),
        h('div', null, pending.username || '(без логина)'),
        h('div', { class: 'muted small', style: 'margin-top: 6px' }, 'Пароль'),
        h('div', null, '••••••••'),
      ),
      !vault.unlocked ? h('div', { style: 'margin-top: 10px' }, field('master', { type: 'password', placeholder: 'Мастер-пароль сейфа', autofocus: true, onEnter: save })) : null,
      h(
        'div',
        { class: 'row', style: 'margin-top: 10px' },
        button('Сохранить', save, { kind: 'primary' }),
        button('Не сейчас', async () => { await api.call('save.dismiss'); api.close(); }, { kind: 'ghost' }),
      ),
      noteEl(),
    ];
  }
  return [head(`Сохранить пароль для ${hostOf(payload.origin || '')}?`, 'key'), h('div', { class: 'section' }, body)];
}

// ---------- Аккаунт Horizon ----------

let accountState = null;
let accountView = 'login';
let phoneLink = null;
let phoneTimer = null;
let sessionsList = null;
let resendAt = 0;
let resetVia = 'mail';

function stopPhonePolling() {
  clearInterval(phoneTimer);
  phoneTimer = null;
}

async function openAccount() {
  form = {};
  note = { text: '', kind: '' };
  phoneLink = null;
  sessionsList = null;
  stopPhonePolling();
  accountState = await api.call('account.state');
  accountView = 'login';
  render();
  if (payload.phoneVerified) note = { text: 'Номер подтверждён через Telegram', kind: 'ok' };
  if (accountState.loggedIn) {
    api.call('account.refresh').catch(() => {});
    loadSessions();
    adminUsers = null;
    if (accountState.user && accountState.user.admin) loadAdminUsers();
  }
}

async function loadSessions() {
  try {
    sessionsList = await api.call('account.sessions');
  } catch {
    sessionsList = [];
  }
  if (mode === 'account') render();
}

function maskPhone(phone) {
  return phone ? `${phone.slice(0, phone.length - 10)} *** ***-${phone.slice(-4, -2)}-${phone.slice(-2)}` : '';
}

function goView(view) {
  accountView = view;
  note = { text: '', kind: '' };
  render();
}

// Сервер запущен у себя без почты: код показываем прямо здесь, чтобы можно было проверить вход.
function showDevCode(result) {
  if (result && result.devCode) note = { text: `Режим проверки (почта ещё не подключена): код ${result.devCode}`, kind: 'ok' };
}

function authScreen(title, text, fields, submitLabel, onSubmit, links) {
  return h(
    'div',
    { class: 'center' },
    icon('user', 'hero-icon'),
    h('h3', null, title),
    text ? h('p', { class: 'muted' }, text) : null,
    h('div', { class: 'stack' }, fields, button(submitLabel, onSubmit, { kind: 'primary' }), links),
    noteEl(),
  );
}

function accountAuth() {
  const email = () => (form.accEmail || '').trim();
  const afterLogin = async (result) => {
    if (result.needCode) {
      resendAt = Date.now() + 60000;
      goView('code');
      showDevCode(result);
      return '';
    }
    accountState = await api.call('account.state');
    loadSessions();
    return 'Вы вошли';
  };
  const link = (label, view) => h('button', { class: 'link', onClick: () => goView(view) }, label);

  if (accountView === 'register') {
    const submit = () =>
      action(async () => {
        if ((form.accPass || '') !== (form.accPass2 || '')) throw new Error('Пароли не совпадают');
        if (!form.accBirth) throw new Error('Укажите дату рождения');
        return afterLogin(await api.call('account.register', email(), form.accPass || '', form.accName || '', form.accBirth));
      });
    return authScreen(
      'Регистрация',
      'Аккаунт нужен, чтобы ваш профиль и номер телефона были подтверждены. Пароли из сейфа на сервер не отправляются.',
      [
        field('accName', { placeholder: 'Имя', autofocus: true }),
        field('accEmail', { placeholder: 'Почта' }),
        h('label', { class: 'muted small', style: 'text-align:left;margin-bottom:-4px' }, 'Дата рождения — до 18 лет включается детский режим'),
        birthPicker('accBirth'),
        field('accPass', { type: 'password', placeholder: 'Пароль (от 8 символов)' }),
        field('accPass2', { type: 'password', placeholder: 'Повторите пароль', onEnter: submit }),
      ],
      'Зарегистрироваться',
      submit,
      link('Уже есть аккаунт? Войти', 'login'),
    );
  }

  if (accountView === 'code') {
    const submit = () => action(async () => afterLogin(await api.call('account.verify', email(), form.accCode || '')));
    const wait = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    return authScreen(
      'Подтвердите почту',
      `Мы отправили код из 6 цифр на ${email()}. Если письма нет, проверьте «Спам».`,
      [field('accCode', { placeholder: 'Код из письма', mono: true, autofocus: true, onEnter: submit })],
      'Подтвердить',
      submit,
      [
        h('button', {
          class: 'link',
          disabled: wait > 0,
          onClick: () =>
            action(async () => {
              await api.call('account.resend', email());
              resendAt = Date.now() + 60000;
            }, 'Код отправлен ещё раз'),
        }, wait > 0 ? `Отправить ещё раз можно через ${wait} с` : 'Отправить код ещё раз'),
        link('Назад', 'login'),
      ],
    );
  }

  if (accountView === 'forgot') {
    const submit = () =>
      action(async () => {
        const result = await api.call('account.forgot', email());
        resetVia = result && result.via === 'telegram' ? 'telegram' : 'mail';
        goView('reset');
        showDevCode(result);
      });
    return authScreen('Восстановление пароля', 'Пришлём код для нового пароля: на почту или от бота в Telegram, если к аккаунту привязан номер.', [field('accEmail', { placeholder: 'Почта', autofocus: true, onEnter: submit })], 'Отправить код', submit, link('Назад', 'login'));
  }

  if (accountView === 'reset') {
    const submit = () =>
      action(async () => {
        if ((form.accPass || '') !== (form.accPass2 || '')) throw new Error('Пароли не совпадают');
        return afterLogin(await api.call('account.reset', email(), form.accCode || '', form.accPass || ''));
      });
    return authScreen(
      'Новый пароль',
      resetVia === 'telegram'
        ? `Если к аккаунту ${email()} привязан номер, бот Horizon прислал код в Telegram.`
        : `Если почта ${email()} зарегистрирована, на неё пришёл код.`,
      [
        field('accCode', { placeholder: resetVia === 'telegram' ? 'Код из Telegram' : 'Код из письма', mono: true, autofocus: true }),
        field('accPass', { type: 'password', placeholder: 'Новый пароль' }),
        field('accPass2', { type: 'password', placeholder: 'Повторите пароль', onEnter: submit }),
      ],
      'Сменить пароль',
      submit,
      link('Назад', 'login'),
    );
  }

  const submit = () => action(async () => afterLogin(await api.call('account.login', email(), form.accPass || '')));
  return authScreen(
    'Вход в аккаунт',
    'Аккаунт не обязателен: сайты, YouTube и почта работают и без него. Он нужен для профиля и подтверждённого номера.',
    [field('accEmail', { placeholder: 'Почта', autofocus: true }), field('accPass', { type: 'password', placeholder: 'Пароль', onEnter: submit })],
    'Войти',
    submit,
    [link('Создать аккаунт', 'register'), link('Забыли пароль?', 'forgot')],
  );
}

// Telegram открывается во вкладке Horizon, окно профиля закрывается; когда бот подтвердит номер,
// профиль откроется сам. QR-код — запасной путь, если удобнее с телефона.
function startPhone() {
  return action(() => api.call('account.phoneStart', { openTab: true }));
}

function showPhoneQr() {
  return action(async () => {
    phoneLink = await api.call('account.phoneStart', { openTab: false });
  });
}

let adminUsers = null;

async function loadAdminUsers() {
  try {
    adminUsers = await api.call('account.adminUsers');
  } catch {
    adminUsers = [];
  }
  if (mode === 'account') render();
}

const ROLE_NAMES = { owner: 'Владелец', admin: 'Админ', user: 'Пользователь' };

function adminCard() {
  const users = adminUsers || [];
  const me = accountState.user || {};
  const iAmOwner = me.role === 'owner';
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, icon('shield'), h('strong', null, `Пользователи${adminUsers ? ` · ${users.length}` : ''}`), h('span', { class: 'pill on' }, ROLE_NAMES[me.role] || 'Администратор')),
    h('p', { class: 'muted small' }, iAmOwner
      ? 'Вы владелец: видите аккаунты, можете выдать или снять админку, заблокировать аккаунт и завершить его сеансы. Пароли, сейф и VPN-ключи пользователей не хранятся на сервере — их не видит никто.'
      : 'Вы видите аккаунты и можете блокировать пользователей или завершать их сеансы. Пароли, сейф и VPN-ключи пользователей не хранятся на сервере — их не видит никто.'),
    adminUsers === null
      ? h('p', { class: 'muted small' }, 'Загрузка…')
      : users.map((u) =>
          h(
            'div',
            { class: 'row', style: 'padding:8px 0;border-top:1px solid var(--line)' },
            h('div', { class: 'avatar' }, (u.name || u.email).charAt(0).toUpperCase()),
            h(
              'div',
              { class: 'entry-main' },
              h('div', null, u.name, u.role && u.role !== 'user' ? ` · ${ROLE_NAMES[u.role].toLowerCase()}` : '', u.blocked ? ' · заблокирован' : ''),
              h('div', { class: 'muted small' }, [u.email, u.phone, u.age !== null && u.age !== undefined ? `${u.age} лет${u.age < 18 ? ' (детский режим)' : ''}` : 'возраст не указан', `устройств: ${u.sessions}`, new Date(u.created).toLocaleDateString('ru-RU')].filter(Boolean).join(' · ')),
            ),
            u.role === 'owner' || u.id === me.id || (u.admin && !iAmOwner)
              ? null
              : [
                  iAmOwner
                    ? button(u.role === 'admin' ? 'Снять админку' : 'Сделать админом', () =>
                        action(async () => {
                          await api.call('account.adminRole', u.id, u.role === 'admin' ? 'user' : 'admin');
                          await loadAdminUsers();
                        }, u.role === 'admin' ? 'Админка снята' : 'Теперь это администратор'), { kind: 'ghost' })
                    : null,
                  button(u.blocked ? 'Разблокировать' : 'Заблокировать', () =>
                    action(async () => {
                      await api.call('account.adminBlock', u.id, !u.blocked);
                      await loadAdminUsers();
                    }), { kind: u.blocked ? '' : 'danger' }),
                  u.sessions ? button('Выйти везде', () => action(async () => { await api.call('account.adminLogout', u.id); await loadAdminUsers(); }, 'Сеансы завершены'), { kind: 'ghost' }) : null,
                ],
          ),
        ),
  );
}

function accountProfile() {
  const user = accountState.user || {};
  const avatar = h(
    'button',
    { class: 'acc-avatar', title: 'Сменить фото', onClick: () => action(() => api.call('account.avatar')) },
    user.avatar ? h('img', { src: user.avatar, alt: '' }) : (user.name || '?').charAt(0).toUpperCase(),
  );

  const phoneCard = h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, icon('phone'), h('strong', null, 'Телефон'), h('span', { class: 'pill' + (user.phone ? ' on' : '') }, user.phone ? 'Подтверждён' : 'Не подтверждён')),
    user.phone
      ? h('div', { class: 'row' }, h('span', { style: 'flex:1' }, maskPhone(user.phone), h('span', { class: 'muted small' }, ' · через Telegram')), button('Отвязать', () => action(() => api.call('account.phoneRemove')), { kind: 'ghost' }))
      : [
          accountState.phonePending
            ? h('p', { class: 'small' }, 'Ждём подтверждения: во вкладке Telegram нажмите в боте «📱 Поделиться номером». Профиль обновится сам.')
            : h('p', { class: 'muted small' }, 'Номер подтверждается бесплатно через Telegram прямо в браузере — ничего скачивать не нужно. Бот получает номер от самого Telegram, подделать чужой нельзя.'),
          h(
            'div',
            { class: 'row wrap' },
            button(accountState.phonePending ? 'Открыть Telegram ещё раз' : 'Подтвердить через Telegram', startPhone, { kind: 'primary' }),
            phoneLink ? null : button('С телефона по QR-коду', showPhoneQr, { kind: 'ghost' }),
          ),
          phoneLink
            ? h(
                'div',
                { class: 'row', style: 'align-items:flex-start;gap:14px;margin-top:10px' },
                h('img', { class: 'qr', src: phoneLink.qr, alt: 'QR-код для Telegram' }),
                h('p', { class: 'small muted', style: 'flex:1' }, `Наведите камеру телефона на код, откроется бот @${phoneLink.bot}. Нажмите в нём «📱 Поделиться номером». Код действует 10 минут.`),
              )
            : null,
        ],
  );

  const devices = h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, icon('screen'), h('strong', null, 'Устройства')),
    sessionsList === null
      ? h('p', { class: 'muted small' }, 'Загрузка…')
      : sessionsList.map((s) =>
          h(
            'div',
            { class: 'row', style: 'padding:6px 0' },
            h('div', { class: 'entry-main' }, h('div', null, s.device), h('div', { class: 'muted small' }, s.current ? 'Это устройство' : `Был активен ${new Date(s.lastSeen).toLocaleString('ru-RU')}`)),
            s.current ? null : button('Отключить', () => action(async () => { await api.call('account.revoke', s.id); await loadSessions(); }, 'Устройство отключено'), { kind: 'ghost' }),
          ),
        ),
  );

  const password = h(
    'div',
    { class: 'card stack' },
    h('strong', null, 'Сменить пароль'),
    field('pwCur', { type: 'password', placeholder: 'Текущий пароль' }),
    field('pwNew', { type: 'password', placeholder: 'Новый пароль' }),
    field('pwNew2', { type: 'password', placeholder: 'Повторите новый' }),
    h('div', null, button('Сменить', () =>
      action(async () => {
        if ((form.pwNew || '') !== (form.pwNew2 || '')) throw new Error('Пароли не совпадают');
        await api.call('account.password', form.pwCur || '', form.pwNew || '');
        form.pwCur = form.pwNew = form.pwNew2 = '';
        await loadSessions();
      }, 'Пароль изменён. На других устройствах нужно войти заново.'))),
  );

  const danger = h(
    'div',
    { class: 'row wrap', style: 'margin-top:12px' },
    button('Выйти из аккаунта', () => action(async () => { await api.call('account.logout'); accountState = await api.call('account.state'); goView('login'); }), { iconName: 'logout' }),
    form.deleting
      ? [
          field('delPass', { type: 'password', placeholder: 'Пароль для удаления' }),
          button('Удалить навсегда', () => action(async () => { await api.call('account.delete', form.delPass || ''); accountState = await api.call('account.state'); goView('login'); }), { kind: 'danger' }),
        ]
      : button('Удалить аккаунт', () => { form.deleting = true; render(); }, { kind: 'ghost' }),
  );

  return h(
    'div',
    { class: 'section' },
    h(
      'div',
      { class: 'acc-top' },
      avatar,
      h(
        'div',
        { class: 'stack', style: 'flex:1' },
        h('div', { class: 'row' }, field('accNameEdit', { placeholder: user.name || 'Имя' }), button('Сохранить', () => action(async () => { await api.call('account.update', { name: form.accNameEdit || user.name }); form.accNameEdit = ''; }, 'Имя сохранено'))),
        h('div', { class: 'muted small' }, user.email, user.emailVerified ? ' · почта подтверждена ✓' : '', user.admin ? h('span', { class: 'pill on', style: 'margin-left:8px' }, user.role === 'owner' ? 'Владелец' : 'Администратор') : null),
        user.age !== null && user.age !== undefined
          ? h('div', { class: 'muted small' }, `Возраст: ${user.age}`, user.adult === false ? h('span', { class: 'pill', style: 'margin-left:8px' }, 'Детский режим') : null)
          : null,
        user.avatar ? h('button', { class: 'link small', onClick: () => action(() => api.call('account.update', { avatar: null })) }, 'Убрать фото') : null,
      ),
    ),
    noteEl(),
    user.adult === false
      ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('shield'), h('strong', null, 'Детский режим')), h('p', { class: 'muted small' }, 'Аккаунту меньше 18 лет: сайты для взрослых не открываются, в поиске нет материалов 18+, VPN недоступен. С 18 лет ограничения снимутся сами.'))
      : null,
    !user.birthDate
      ? h('div', { class: 'card' },
          h('div', { class: 'card-head' }, icon('user'), h('strong', null, 'Укажите дату рождения')),
          h('p', { class: 'muted small' }, 'Нужна один раз: до 18 лет включается детский режим. Изменить дату потом нельзя.'),
          h('div', { class: 'row' }, birthPicker('accBirthSet'), button('Сохранить', () => action(async () => {
            if (!form.accBirthSet) throw new Error('Укажите дату рождения');
            accountState = await api.call('account.setBirthDate', form.accBirthSet);
          }, 'Дата рождения сохранена'), { kind: 'primary' })))
      : null,
    phoneCard,
    devices,
    user.admin ? adminCard() : null,
    password,
    danger,
  );
}

function renderAccount() {
  if (!accountState) return [head('Аккаунт', 'user'), h('div', { class: 'section' }, 'Загрузка…')];
  let body;
  if (!accountState.configured) {
    body = h('div', { class: 'center' }, icon('user', 'hero-icon'), h('h3', null, 'Аккаунты скоро'), h('p', { class: 'muted' }, 'Сервер аккаунтов Horizon ещё не подключён. Когда он заработает, здесь появятся вход и регистрация.'));
  } else if (accountState.loggedIn) {
    body = accountProfile();
  } else {
    body = accountAuth();
  }
  return [head(accountState.loggedIn ? 'Профиль' : 'Аккаунт Horizon', 'user'), h('div', { class: 'scroll' }, body)];
}

api.onAccount((state) => {
  accountState = state;
  if (mode === 'account' && !busy) render();
});

// ---------- Подсказки адресной строки ----------

const SUGGEST_LABELS = {
  tab: 'Вкладка',
  bookmark: 'Сохранено',
  history: 'Были здесь',
  site: 'Сайт',
  'site-search': 'Поиск на сайте',
  url: 'Адрес',
  calc: 'Калькулятор',
  related: 'Похожий',
  search: 'Поиск',
};

function suggestIcon(item) {
  const box = h('span', { class: 'sg-icon' + (item.type === 'search' ? ' accent' : '') });
  const glyph = item.type === 'search' || item.type === 'site-search' ? 'search' : item.type === 'calc' ? 'calc' : 'globe';
  box.append(icon(glyph));
  const src = item.favicon || (item.host && item.type !== 'search' && item.type !== 'calc' ? `https://${item.host}/favicon.ico` : null);
  if (src) {
    const img = new Image();
    img.alt = '';
    img.onload = () => {
      if (img.naturalWidth > 1) box.replaceChildren(img);
    };
    img.src = src;
  }
  return box;
}

function renderSuggest() {
  const items = payload.items || [];
  return h(
    'div',
    { class: 'sg-list', role: 'listbox' },
    items.map((item, index) =>
      h(
        'div',
        {
          class: 'sg-row' + (index === payload.index ? ' selected' : '') + (item.type === 'calc' ? ' calc' : ''),
          role: 'option',
          onMousedown: (e) => {
            e.preventDefault();
            if (item.type !== 'calc') api.call('suggest.pick', index);
          },
        },
        suggestIcon(item),
        h('span', { class: 'sg-main' }, h('span', { class: 'sg-title' }, item.title), item.subtitle ? h('span', { class: 'sg-sub' }, item.subtitle) : null),
        h('span', { class: 'sg-type' }, item.category && item.type === 'site' ? item.category : SUGGEST_LABELS[item.type] || ''),
      ),
    ),
  );
}

// ---------- Поиск по странице ----------

let findResult = null;

function renderFind() {
  const go = (forward) => api.call('find.query', form.find || '', forward);
  const counter = h('span', { class: 'find-count' }, form.find ? (findResult ? `${findResult.current} из ${findResult.total}` : '…') : '');
  return h(
    'div',
    { class: 'find-bar' },
    h('input', {
      class: 'input',
      placeholder: 'Найти на странице',
      value: form.find || '',
      spellcheck: 'false',
      onInput: (e) => {
        form.find = e.target.value;
        findResult = null;
        go(true);
        counter.textContent = form.find ? '…' : '';
      },
      onKeydown: (e) => {
        if (e.key === 'Enter') go(!e.shiftKey);
        if (e.key === 'Escape') api.call('find.stop');
      },
    }),
    counter,
    iconButton('up', 'Предыдущее (Shift+Enter)', () => go(false)),
    iconButton('down', 'Следующее (Enter)', () => go(true)),
    iconButton('close', 'Закрыть (Esc)', () => api.call('find.stop')),
  );
}

api.onFind((result) => {
  findResult = result;
  const counter = panel.querySelector('.find-count');
  if (counter && mode === 'find') counter.textContent = result.total ? `${result.current} из ${result.total}` : 'Не найдено';
});

// ---------- Загрузки ----------

let downloadsList = [];

function downloadStatus(d) {
  if (d.state === 'progressing') return d.total ? `${formatBytes(d.received)} из ${formatBytes(d.total)}` : `${formatBytes(d.received)}…`;
  if (d.state === 'completed') return `Готово · ${formatBytes(d.total || d.received)}`;
  if (d.state === 'cancelled') return 'Отменено';
  return 'Не удалось скачать';
}

function renderDownloads() {
  const rows = downloadsList.map((d) => {
    const progress = d.state === 'progressing' && d.total ? h('div', { class: 'dl-bar' }, h('span', { style: `width:${Math.round((d.received / d.total) * 100)}%` })) : null;
    const confirm = form.confirmOpen === d.id;
    return h(
      'div',
      { class: 'dl-row' },
      h('div', { class: 'avatar' }, (d.name.split('.').pop() || '?').slice(0, 3).toUpperCase()),
      h(
        'div',
        { class: 'entry-main' },
        h('div', { title: d.name }, d.name),
        h('div', { class: 'muted small' }, downloadStatus(d)),
        d.dangerous && d.state === 'completed' ? h('div', { class: 'small', style: 'color: var(--amber); white-space: normal' }, 'Это программа — открывайте, только если доверяете сайту') : null,
        progress,
      ),
      d.state === 'progressing' ? iconButton('close', 'Отменить', () => action(() => api.call('downloads.cancel', d.id))) : null,
      d.state === 'completed'
        ? [
            confirm
              ? button('Открыть всё равно', () => action(async () => { form.confirmOpen = null; await api.call('downloads.open', d.id, true); }), { kind: 'danger' })
              : button('Открыть', () =>
                  action(async () => {
                    const result = await api.call('downloads.open', d.id, false);
                    if (result && result.needsConfirm) form.confirmOpen = d.id;
                  })),
            iconButton('folder', 'Показать в папке', () => api.call('downloads.show', d.id)),
          ]
        : null,
    );
  });
  return [
    head('Загрузки', 'download', downloadsList.some((d) => d.state !== 'progressing') ? button('Очистить список', () => action(() => api.call('downloads.clear')), { kind: 'ghost' }) : null),
    h('div', { class: 'scroll' }, h('div', { class: 'section' }, rows.length ? rows : h('div', { class: 'empty' }, 'Загрузок пока нет'), noteEl())),
    h('div', { class: 'section' }, h('p', { class: 'muted small' }, 'Файлы сохраняются в папку «Загрузки».')),
  ];
}

api.onDownloads((list) => {
  downloadsList = list;
  if (mode === 'downloads' && !busy) render();
});

api.onSuggest((data) => {
  if (mode !== 'suggest') return;
  payload.items = data.items;
  payload.index = data.index;
  render();
});

// ---------- События ----------

api.onOpen(async (nextMode, nextPayload) => {
  mode = nextMode;
  payload = nextPayload || {};
  if (mode === 'suggest') {
    render();
    return;
  }
  if (mode === 'find') {
    form = { find: '' };
    findResult = null;
    render();
    return;
  }
  if (mode === 'downloads') {
    form = {};
    note = { text: '', kind: '' };
    downloadsList = await api.call('downloads.list');
    render();
    return;
  }
  if (mode === 'account') {
    openAccount();
    return;
  }
  form = {};
  note = { text: '', kind: '' };
  view = '';
  busy = false;
  tfa = null;
  revealed = {};
  confirmDelete = null;
  if (!recoveryCode) view = '';
  else view = 'code';
  try {
    if (mode === 'vpn') vpn = await api.call('vpn.state');
    await refreshVault();
  } catch (error) {
    note = { text: error.message, kind: 'error' };
  }
  render();
});

api.onVpn((state) => {
  vpn = state;
  if (mode === 'vpn') render();
});

api.onVault(async () => {
  if (mode === 'vault' || mode === 'fill' || mode === 'save') {
    await refreshVault();
    if (!vault.unlocked) revealed = {};
    render();
  }
});

api.onTheme(applyTheme);

document.getElementById('backdrop').addEventListener('mousedown', () => api.close());
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (mode === 'find') api.call('find.stop');
  else api.close();
});
