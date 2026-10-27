// Просмотр картинки из выдачи: крупно, листание стрелками, скачивание в нужном размере и формате.
// Картинка загружается через браузер (/image), поэтому её можно пересохранить в JPEG, PNG или WEBP.
(function () {
  const FORMATS = [
    ['original', 'Как есть'],
    ['jpeg', 'JPEG'],
    ['png', 'PNG'],
    ['webp', 'WEBP'],
  ];
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tif' };
  const WIDTHS = [3840, 2560, 1920, 1280, 640, 320];

  let list = [];
  let index = 0;
  let root = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fileName(item, w, h, ext) {
    const base = (item.title || 'картинка').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'картинка';
    return `${base} ${w}x${h}.${ext}`;
  }

  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  // Картинка из blob → bitmap; SVG и редкие форматы — через <img>.
  async function decode(blob) {
    try {
      return await createImageBitmap(blob);
    } catch {
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    }
  }

  async function download(item, format, width, status) {
    status.textContent = 'Загружаю картинку…';
    const response = await fetch(`/image?url=${encodeURIComponent(item.full || item.thumb)}`);
    if (!response.ok) throw new Error((await response.text()) || 'Не удалось загрузить картинку');
    const blob = await response.blob();
    const type = blob.type || 'image/jpeg';
    const source = await decode(blob);
    const ow = source.width || source.naturalWidth;
    const oh = source.height || source.naturalHeight;
    const w = width === 'original' ? ow : Math.min(ow, Number(width));
    const h = Math.round((oh * w) / ow);
    if (format === 'original' && w === ow) {
      save(blob, fileName(item, ow, oh, EXT[type] || 'jpg'));
      status.textContent = 'Сохранено в «Загрузки»';
      return;
    }
    status.textContent = 'Готовлю файл…';
    const mime = format === 'original' ? (['image/png', 'image/webp', 'image/jpeg'].includes(type) ? type : 'image/png') : `image/${format}`;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#fff'; // у JPEG нет прозрачности — фон белый, а не чёрный
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
    if (!out) throw new Error('Не получилось сохранить в этом формате');
    save(out, fileName(item, w, h, EXT[mime]));
    status.textContent = 'Сохранено в «Загрузки»';
  }

  function close() {
    if (!root) return;
    root.classList.add('closing');
    const r = root;
    root = null;
    setTimeout(() => r.remove(), 160);
    document.removeEventListener('keydown', onKey);
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight') show(index + 1);
    if (event.key === 'ArrowLeft') show(index - 1);
  }

  function show(i) {
    if (!list.length) return;
    index = (i + list.length) % list.length;
    const item = list[index];
    if (!root) {
      root = el('div', 'viewer');
      root.addEventListener('mousedown', (e) => e.target === root && close());
      document.addEventListener('keydown', onKey);
      document.body.append(root);
    }
    const stage = el('div', 'viewer-stage');
    const img = new Image();
    img.alt = item.title || '';
    img.src = item.thumb || item.full;
    // Сначала быстрое превью, потом полная картинка
    if (item.full && item.full !== item.thumb) {
      const full = new Image();
      full.onload = () => (img.src = item.full);
      full.src = item.full;
    }
    stage.append(img);

    const prev = el('button', 'viewer-nav prev', '‹');
    prev.title = 'Предыдущая (←)';
    prev.addEventListener('click', () => show(index - 1));
    const next = el('button', 'viewer-nav next', '›');
    next.title = 'Следующая (→)';
    next.addEventListener('click', () => show(index + 1));
    const closeBtn = el('button', 'viewer-close', '✕');
    closeBtn.title = 'Закрыть (Esc)';
    closeBtn.addEventListener('click', close);

    const side = el('aside', 'viewer-side');
    side.append(el('h3', null, item.title || 'Картинка'));
    const meta = [item.author ? `Автор: ${item.author}` : null, item.width && item.height ? `Размер: ${item.width} × ${item.height}` : null].filter(Boolean);
    for (const line of meta) side.append(el('p', 'muted', line));

    const sizeSel = el('select', 'viewer-select');
    const ow = item.width || 0;
    sizeSel.append(new Option(ow ? `Оригинал — ${item.width} × ${item.height}` : 'Оригинал', 'original'));
    for (const w of WIDTHS) {
      if (ow && w >= ow) continue;
      const h = ow ? Math.round((item.height * w) / ow) : null;
      sizeSel.append(new Option(h ? `${w} × ${h}` : `Ширина ${w}`, String(w)));
    }
    const formatSel = el('select', 'viewer-select');
    for (const [value, label] of FORMATS) formatSel.append(new Option(label, value));

    const status = el('p', 'viewer-status');
    const dl = el('button', 'btn primary viewer-download', 'Скачать');
    dl.addEventListener('click', async () => {
      dl.disabled = true;
      try {
        await download(item, formatSel.value, sizeSel.value, status);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        dl.disabled = false;
      }
    });
    const label = (text, control) => {
      const box = el('label', 'viewer-field');
      box.append(el('span', null, text), control);
      return box;
    };
    side.append(label('Размер', sizeSel), label('Формат', formatSel), dl, status);
    if (/^https?:\/\//.test(item.page || '')) {
      const src = el('a', 'btn viewer-source', 'Открыть страницу с картинкой');
      src.href = item.page;
      side.append(src);
    }
    side.append(el('p', 'muted small', 'Картинки со свободной лицензией. При публикации указывайте автора.'));

    root.replaceChildren(stage, prev, next, closeBtn, side);
  }

  window.openViewer = (items, i) => {
    list = items;
    show(i);
  };
})();
