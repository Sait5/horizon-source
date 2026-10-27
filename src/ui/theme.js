// Переводит цвета темы в CSS-переменные. Общий файл для панели браузера и всплывающих панелей.
function applyTheme(p) {
  if (!p) return;
  const vars = {
    '--bg': p.bg,
    '--strip': p.strip,
    '--toolbar': p.toolbar,
    '--panel': p.panel,
    '--panel-2': p.panel2,
    '--tab-hover': p.hover,
    '--hover': p.hover,
    '--field': p.field,
    '--field-focus': p.field,
    '--line': p.line,
    '--text': p.text,
    '--muted': p.muted,
    '--disabled': p.disabled,
    '--accent': p.accent,
    '--accent-ink': p.accentInk,
    '--accent-soft': p.accentSoft,
    '--accent-faint': p.accentFaint,
    '--r': `${p.radius}px`,
  };
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.classList.toggle('light', Boolean(p.light));
}
