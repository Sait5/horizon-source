// Заставка при запуске. Когда она закончилась или её пропустили, страница плавно
// растворяется и сообщает браузеру об этом сменой заголовка на «done».
const video = document.getElementById('video');
const sound = document.getElementById('sound');
const params = new URLSearchParams(location.search);
let finished = false;

// Звук идёт вместе с картинкой: стартует, когда видео действительно заиграло.
if (params.get('sound')) {
  sound.src = params.get('sound');
  sound.volume = 0.85;
}

function fadeOutSound(ms) {
  if (!sound.src || sound.paused) return;
  const from = sound.volume;
  const started = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - started) / ms);
    sound.volume = from * (1 - k);
    if (k < 1) requestAnimationFrame(step);
    else sound.pause();
  };
  requestAnimationFrame(step);
}

function finish() {
  if (finished) return;
  finished = true;
  document.body.classList.add('leaving');
  document.title = 'leaving';
  // Досмотрели до конца — звук сам тихо дозвучит; пропустили — быстро уводим громкость.
  fadeOutSound(video.ended ? 650 : 450);
  setTimeout(() => (document.title = 'done'), 700);
}

video.src = params.get('src') || '';
video.addEventListener('playing', () => {
  video.classList.add('playing');
  if (sound.src && sound.paused && !finished) {
    sound.currentTime = video.currentTime;
    sound.play().catch(() => {});
  }
});
video.addEventListener('ended', finish);
video.addEventListener('error', finish);
// Запуск может прерваться, пока видео ещё грузится, — тогда просто пробуем снова, когда оно готово.
video.autoplay = true;
video.addEventListener('canplay', () => video.paused && video.play().catch(() => {}));
video.play().catch(() => {});

document.getElementById('skip').addEventListener('click', finish);
window.addEventListener('keydown', finish);
window.addEventListener('mousedown', (event) => {
  if (event.target.id !== 'skip') finish();
});
