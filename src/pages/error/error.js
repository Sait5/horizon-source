const params = new URLSearchParams(location.search);
const code = params.get('code') || '';
const url = params.get('url') || '';
const vpn = params.get('vpn') === '1';

const MESSAGES = {
  KIDS_BLOCKED: ['Сайт недоступен в детском режиме', 'Это сайт для взрослых (18+). В аккаунте младше 18 лет он закрыт.'],
  ERR_INTERNET_DISCONNECTED: ['Нет подключения к интернету', 'Проверьте Wi-Fi или кабель и попробуйте снова.'],
  ERR_NAME_NOT_RESOLVED: ['Сайт не найден', 'Проверьте, правильно ли написан адрес.'],
  ERR_CONNECTION_REFUSED: ['Сайт отказал в подключении', 'Возможно, сайт временно не работает.'],
  ERR_CONNECTION_TIMED_OUT: ['Сайт не отвечает', 'Сервер слишком долго не отвечал. Попробуйте позже.'],
  ERR_CERT_AUTHORITY_INVALID: ['Подключение не защищено', 'Сертификат сайта не прошёл проверку. Не вводите на этом сайте пароли и личные данные.'],
  ERR_CERT_DATE_INVALID: ['Подключение не защищено', 'Сертификат сайта просрочен. Не вводите на этом сайте пароли и личные данные.'],
  RENDERER_CRASHED: ['Вкладка аварийно закрылась', 'Страница упала или ей не хватило памяти. Остальные вкладки работают. Нажмите «Повторить», чтобы открыть её снова.'],
};

let [title, text] = MESSAGES[code] || ['Страница не открылась', 'Не удалось загрузить страницу.'];
if (vpn && /PROXY|TUNNEL|SOCKS/.test(code)) {
  title = 'Нет связи с VPN';
  text = 'Пока VPN включён, Horizon не открывает сайты напрямую, чтобы трафик не ушёл мимо VPN. Переподключите VPN или выключите его кнопкой VPN наверху.';
  document.getElementById('icon').classList.add('vpn');
} else if (vpn) {
  text += ' Запрос шёл через VPN.';
}

document.title = title;
document.getElementById('title').textContent = title;
document.getElementById('text').textContent = text;
document.getElementById('url').textContent = url;
document.getElementById('code').textContent = code;
document.getElementById('retry').addEventListener('click', () => {
  if (/^https?:\/\//i.test(url)) location.href = url;
  else location.reload();
});
