// Точка входа для Vercel: все запросы /api/* приходят сюда (см. vercel.json).
const { createApp } = require('../lib/core');
const { createStore } = require('../lib/store');

let app = null;

module.exports = async (req, res) => {
  app = app || createApp({ store: createStore(process.env), env: process.env });
  const url = new URL(req.url, 'http://localhost');
  const routed = url.searchParams.get('path');
  const path = url.pathname === '/api' && routed ? `/api/${routed}` : url.pathname;
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  const result = await app.handle({ method: req.method, path, headers: req.headers, body, ip });
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status).json(result.json);
};
