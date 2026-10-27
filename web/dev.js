// Сайт-приложение у себя на компьютере (для проверки): node web/dev.js → http://localhost:5190
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webp': 'image/webp' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const api = /^\/api\/([a-z]+)$/.exec(url.pathname);
    if (api) {
      const file = path.join(__dirname, 'api', api[1] + '.js');
      if (!fs.existsSync(file)) return res.writeHead(404).end();
      req.query = Object.fromEntries(url.searchParams);
      return require(file)(req, res);
    }
    let file = path.join(PUB, decodeURIComponent(url.pathname));
    if (!file.startsWith(PUB)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end('Не найдено');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(Number(process.env.PORT) || 5190, () => console.log('Сайт Horizon: http://localhost:' + (Number(process.env.PORT) || 5190)));
