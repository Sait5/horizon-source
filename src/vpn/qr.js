// Поиск QR-кода с конфигурацией: в буфере обмена, на экране или в файле с картинкой.
const jsQR = require('jsqr');

function decodeImage(image) {
  if (!image || image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = 255;
  }
  const result = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  return result ? result.data : null;
}

async function fromScreen({ desktopCapturer, screen }) {
  const largest = screen.getAllDisplays().reduce(
    (max, d) => ({
      width: Math.max(max.width, Math.round(d.size.width * d.scaleFactor)),
      height: Math.max(max.height, Math.round(d.size.height * d.scaleFactor)),
    }),
    { width: 0, height: 0 },
  );
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: largest });
  for (const source of sources) {
    const text = decodeImage(source.thumbnail);
    if (text) return text;
  }
  return null;
}

module.exports = { decodeImage, fromScreen };
