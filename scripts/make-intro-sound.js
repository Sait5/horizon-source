// Звук заставки «Восход над горизонтом» — синтезируется целиком в коде, без чужих записей.
// Привязан к кадрам анимации (30 к/с): солнце встаёт 0,4–1,9 с, линия раскрывается в 2,0 с,
// буквы расходятся 2,5–3,5 с, видео кончается в 4 с и растворяется к 4,7 с.
// Запуск: node scripts/make-intro-sound.js → src/assets/intro-sound.wav
const fs = require('node:fs');
const path = require('node:path');

const RATE = 44100;
const LENGTH = 6.2;
const N = Math.round(RATE * LENGTH);
const L = new Float64Array(N);
const R = new Float64Array(N);

// Повторяемый «случайный» шум — звук одинаковый при каждой сборке.
let seed = 20261027;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296 * 2 - 1;
};

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// Огибающая: нарастание a..b, держится, спад c..d.
const env = (t, a, b, c, d) => smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));

// ---------- Море: мягкий шум с медленными накатами ----------
{
  let b0 = 0, b1 = 0, lp = 0, lp2 = 0, dcIn = 0, dcOut = 0;
  for (let i = 0; i < N; i++) {
    const t = i / RATE;
    const white = rand();
    b0 = 0.995 * b0 + white * 0.05; // «коричневый» шум
    b1 = 0.9 * b1 + white * 0.1;
    const cutoff = 0.02 + 0.015 * Math.sin(t * 2 * Math.PI * 0.35);
    lp += (b0 + b1 * 0.3 - lp) * cutoff;
    lp2 += (lp - lp2) * 0.08;
    // Убираем постоянную составляющую, чтобы шум не «сдвигал» звук.
    dcOut = lp2 - dcIn + 0.995 * dcOut;
    dcIn = lp2;
    const swell = 0.65 + 0.35 * Math.sin(t * 2 * Math.PI * 0.28 - 1.2);
    const v = dcOut * swell * env(t, 0, 0.9, 4.4, 6.0) * 0.9;
    L[i] += v;
    R[i] += v * 0.9;
  }
}

// ---------- Тёплый аккорд, растущий вместе с солнцем (ре мажор с ноной) ----------
const CHORD = [146.83, 220.0, 293.66, 369.99, 440.0, 554.37, 659.25];
CHORD.forEach((freq, k) => {
  const pan = (k / (CHORD.length - 1)) * 1.2 - 0.6;
  const start = 0.25 + k * 0.12; // ноты вступают снизу вверх, как поднимается солнце
  const level = 0.11 / (1 + k * 0.18);
  for (let voice = 0; voice < 2; voice++) {
    const detune = voice ? 1.0018 : 0.9983;
    let phase = rand() * Math.PI;
    for (let i = 0; i < N; i++) {
      const t = i / RATE;
      const e = env(t, start, start + 1.7, 3.9, 6.0);
      if (!e) continue;
      phase += (2 * Math.PI * freq * detune) / RATE;
      const bright = smooth((t - 0.4) / 1.8) * 0.55; // «фильтр» открывается к восходу
      const v = (Math.sin(phase) + bright * 0.35 * Math.sin(2 * phase) + bright * 0.12 * Math.sin(3 * phase)) * level * e;
      L[i] += v * (1 - pan) * 0.5;
      R[i] += v * (1 + pan) * 0.5;
    }
  }
});

// ---------- Нарастание перед раскрытием линии ----------
{
  let hp = 0, prev = 0, bp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / RATE;
    const e = env(t, 1.0, 1.98, 1.98, 2.25);
    if (!e) continue;
    const white = rand();
    hp = 0.97 * (hp + white - prev);
    prev = white;
    bp += (hp - bp) * 0.35;
    const v = bp * e * e * 0.07;
    L[i] += v;
    R[i] += v;
  }
}

// ---------- Мягкий низкий удар в 2,0 с ----------
{
  const t0 = 2.0;
  let phase = 0;
  for (let i = Math.round(t0 * RATE); i < N; i++) {
    const t = i / RATE - t0;
    const freq = 48 + 40 * Math.exp(-t * 9);
    phase += (2 * Math.PI * freq) / RATE;
    const v = Math.sin(phase) * Math.exp(-t * 2.2) * smooth(t / 0.012) * 0.42;
    L[i] += v;
    R[i] += v;
  }
}

// ---------- Колокольчики: линия (2,0 с) и надпись (2,55 с) ----------
function bell(t0, freq, level, pan, decay = 2.6) {
  const partials = [[1, 1], [2.0, 0.42], [2.76, 0.32], [5.4, 0.12], [8.93, 0.05]];
  for (const [ratio, amp] of partials) {
    let phase = rand() * Math.PI;
    for (let i = Math.round(t0 * RATE); i < N; i++) {
      const t = i / RATE - t0;
      phase += (2 * Math.PI * freq * ratio) / RATE;
      const v = Math.sin(phase) * amp * level * Math.exp((-t * decay * (1 + ratio * 0.35)) / 1.6) * smooth(t / 0.004);
      L[i] += v * (1 - pan) * 0.5;
      R[i] += v * (1 + pan) * 0.5;
    }
  }
}
bell(2.0, 880.0, 0.16, -0.1);
bell(2.0, 1318.5, 0.07, 0.25);
bell(2.55, 1108.73, 0.09, 0.35);

// ---------- Искры, пока расходятся буквы ----------
[[2.62, 1760.0, -0.5], [2.8, 2217.46, 0.4], [2.98, 2637.02, -0.2], [3.16, 3520.0, 0.55], [3.36, 2637.02, -0.45]].forEach(([t0, f, pan]) => bell(t0, f, 0.028, pan, 4.5));

// ---------- Реверберация (Freeverb) ----------
function reverb(input, combDelays, allDelays, feedback, damp) {
  const out = new Float64Array(input.length);
  for (const d of combDelays) {
    const buf = new Float64Array(d);
    let idx = 0, store = 0;
    for (let i = 0; i < input.length; i++) {
      const y = buf[idx];
      store = y * (1 - damp) + store * damp;
      buf[idx] = input[i] + store * feedback;
      idx = (idx + 1) % d;
      out[i] += y;
    }
  }
  for (const d of allDelays) {
    const buf = new Float64Array(d);
    let idx = 0;
    for (let i = 0; i < input.length; i++) {
      const b = buf[idx];
      const y = -out[i] + b;
      buf[idx] = out[i] + b * 0.5;
      idx = (idx + 1) % d;
      out[i] = y;
    }
  }
  return out;
}
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLS = [556, 441, 341, 225];
const wetL = reverb(L, COMBS, ALLS, 0.86, 0.3);
const wetR = reverb(R, COMBS.map((d) => d + 23), ALLS.map((d) => d + 23), 0.86, 0.3);

// ---------- Сведение: громкость −3 дБ, мягкий ограничитель, затухание в конце ----------
let peak = 0;
const mixL = new Float64Array(N);
const mixR = new Float64Array(N);
for (let i = 0; i < N; i++) {
  mixL[i] = L[i] * 0.75 + wetL[i] * 0.05;
  mixR[i] = R[i] * 0.75 + wetR[i] * 0.05;
  peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]));
}
const gain = 0.7 / peak;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const t = i / RATE;
  const fade = 1 - smooth((t - (LENGTH - 0.6)) / 0.6);
  const l = Math.tanh(mixL[i] * gain * 1.1) * fade;
  const r = Math.tanh(mixR[i] * gain * 1.1) * fade;
  pcm.writeInt16LE(Math.round(l * 32767), i * 4);
  pcm.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const out = path.join(__dirname, '..', 'src', 'assets', 'intro-sound.wav');
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log('Звук заставки:', out, `${(pcm.length / 1024 / 1024).toFixed(2)} МБ`);
