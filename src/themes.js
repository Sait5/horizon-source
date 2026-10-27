// Темы оформления: цвета панелей, акцент и фоны стартовой страницы.

const PRESETS = {
  graphite: { name: 'Графит', bg: '#0e1116', toolbar: '#171b22', field: '#0e1116', line: '#262c36', text: '#e6eaf0', muted: '#8a94a3' },
  midnight: { name: 'Полночь', bg: '#0a0f1d', toolbar: '#121a2e', field: '#0a0f1d', line: '#222c47', text: '#e7ecf7', muted: '#8b97b5' },
  black: { name: 'Чёрная', bg: '#000000', toolbar: '#0e0e0e', field: '#000000', line: '#232323', text: '#ededed', muted: '#8a8a8a' },
  forest: { name: 'Лес', bg: '#0b1310', toolbar: '#13201b', field: '#0b1310', line: '#23362e', text: '#e4efe9', muted: '#8aa397' },
  wine: { name: 'Гранат', bg: '#140b0f', toolbar: '#21131a', field: '#140b0f', line: '#3a2330', text: '#f1e6ea', muted: '#a68a96' },
  light: { name: 'Светлая', bg: '#e9edf2', toolbar: '#ffffff', field: '#eef1f5', line: '#d6dce5', text: '#1b2230', muted: '#5f6b7c', light: true },
};

const ACCENTS = ['#f2a65a', '#5b9cff', '#a78bfa', '#4ade80', '#f472b6', '#f87171', '#22d3ee', '#facc15'];

const GRADIENTS = {
  aurora: {
    name: 'Сияние',
    css: 'radial-gradient(1100px 620px at 12% 8%, #1d6b66 0%, transparent 62%), radial-gradient(900px 560px at 88% 26%, #3b2a7a 0%, transparent 62%), radial-gradient(900px 640px at 50% 105%, #0f3a5a 0%, transparent 62%), #090e18',
  },
  dusk: { name: 'Закат', css: 'linear-gradient(160deg, #1b1035 0%, #4a1f4f 48%, #a8504a 100%)' },
  ocean: { name: 'Океан', css: 'linear-gradient(180deg, #06121f 0%, #0b2c4a 55%, #14597a 100%)' },
  forest: { name: 'Хвоя', css: 'linear-gradient(170deg, #07130e 0%, #12352a 60%, #2d5a3d 100%)' },
  ember: { name: 'Угли', css: 'radial-gradient(900px 600px at 72% 92%, #7a2a12 0%, transparent 62%), linear-gradient(180deg, #120a08, #1d0f0b)' },
  violet: { name: 'Фиалка', css: 'radial-gradient(1000px 700px at 20% 90%, #5b21b6 0%, transparent 60%), radial-gradient(800px 600px at 90% 10%, #be185d 0%, transparent 55%), #0d0a1a' },
  steel: { name: 'Сталь', css: 'linear-gradient(180deg, #1a1e25 0%, #0c0e12 100%)' },
};

// Обои из заставки: последний кадр «Восхода» — главная страница продолжает анимацию.
const BUILTIN = {
  sunrise: { name: 'Восход', file: 'wallpaper-sunrise.jpg', video: 'waves-sunrise.mp4' },
};

const DEFAULT_APPEARANCE = {
  preset: 'graphite',
  accent: '#f2a65a',
  background: { type: 'builtin', value: 'sunrise' },
  dim: 0.08,
  blur: 0,
  radius: 10,
  showClock: true,
  showTiles: true,
  sidebar: true,
  introEveryLaunch: true,
  introSound: true,
};

const HEX = /^#[0-9a-f]{6}$/i;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Проверяет и дополняет настройки: в файл и в интерфейс попадают только известные значения.
function normalizeAppearance(input = {}) {
  const d = DEFAULT_APPEARANCE;
  const bg = input.background || d.background;
  let background = d.background;
  if (bg.type === 'gradient' && GRADIENTS[bg.value]) background = { type: 'gradient', value: bg.value };
  else if (bg.type === 'color' && HEX.test(bg.value)) background = { type: 'color', value: bg.value };
  else if (bg.type === 'image' && /^[\w.-]+$/.test(bg.value || '')) background = { type: 'image', value: bg.value, version: Number(bg.version) || 0 };
  else if (bg.type === 'theme') background = { type: 'theme' };
  else if (bg.type === 'builtin' && BUILTIN[bg.value]) background = { type: 'builtin', value: bg.value };
  return {
    preset: PRESETS[input.preset] ? input.preset : d.preset,
    accent: HEX.test(input.accent || '') ? input.accent.toLowerCase() : d.accent,
    background,
    dim: clamp(input.dim, 0, 0.8, d.dim),
    blur: clamp(input.blur, 0, 30, d.blur),
    radius: clamp(input.radius, 0, 20, d.radius),
    showClock: input.showClock !== undefined ? Boolean(input.showClock) : d.showClock,
    showTiles: input.showTiles !== undefined ? Boolean(input.showTiles) : d.showTiles,
    sidebar: input.sidebar !== undefined ? Boolean(input.sidebar) : d.sidebar,
    introEveryLaunch: input.introEveryLaunch !== undefined ? Boolean(input.introEveryLaunch) : d.introEveryLaunch,
    introSound: input.introSound !== undefined ? Boolean(input.introSound) : d.introSound,
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a, b, amount) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

function rgba(hex, alpha) {
  return `rgba(${hexToRgb(hex).join(', ')}, ${alpha})`;
}

// Готовые цвета для интерфейса из настроек.
function palette(appearance) {
  const p = PRESETS[appearance.preset];
  const accent = appearance.accent;
  return {
    light: Boolean(p.light),
    bg: p.bg,
    strip: p.bg,
    toolbar: p.toolbar,
    panel: p.toolbar,
    panel2: mix(p.toolbar, p.text, p.light ? 0.04 : 0.05),
    hover: mix(p.toolbar, p.text, p.light ? 0.06 : 0.07),
    field: p.field,
    line: p.line,
    text: p.text,
    muted: p.muted,
    disabled: mix(p.muted, p.toolbar, 0.45),
    accent,
    accentInk: luminance(accent) > 0.45 ? '#15110b' : '#ffffff',
    accentSoft: rgba(accent, 0.35),
    accentFaint: rgba(accent, 0.12),
    radius: appearance.radius,
  };
}

module.exports = { PRESETS, ACCENTS, GRADIENTS, BUILTIN, DEFAULT_APPEARANCE, normalizeAppearance, palette, luminance };
