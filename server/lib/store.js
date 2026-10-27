// Хранилище сервера аккаунтов. В облаке — бесплатная база Neon (Postgres) или Upstash Redis,
// у себя на компьютере — JSON-файл. Везде одинаковые get/set/del/incr/keys.
const fs = require('node:fs');
const path = require('node:path');

class FileStore {
  constructor(file) {
    this.file = file;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }

  live(key) {
    const item = this.data[key];
    if (!item) return null;
    if (item.exp && item.exp < Date.now()) {
      delete this.data[key];
      return null;
    }
    return item;
  }

  async get(key) {
    const item = this.live(key);
    return item ? item.v : null;
  }

  async set(key, value, ttlSec) {
    this.data[key] = { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 };
    this.save();
  }

  async del(key) {
    delete this.data[key];
    this.save();
  }

  async keys(prefix) {
    return Object.keys(this.data).filter((k) => k.startsWith(prefix) && this.live(k));
  }

  async incr(key, ttlSec) {
    const item = this.live(key);
    const value = (item ? Number(item.v) : 0) + 1;
    this.data[key] = { v: value, exp: item && item.exp ? item.exp : ttlSec ? Date.now() + ttlSec * 1000 : 0 };
    this.save();
    return value;
  }
}

class UpstashStore {
  constructor(url, token) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async command(args) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await response.json();
    if (data.error) throw new Error(`Хранилище: ${data.error}`);
    return data.result;
  }

  async get(key) {
    const raw = await this.command(['GET', key]);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  }

  async set(key, value, ttlSec) {
    const args = ['SET', key, JSON.stringify(value)];
    if (ttlSec) args.push('EX', String(ttlSec));
    await this.command(args);
  }

  async del(key) {
    await this.command(['DEL', key]);
  }

  async keys(prefix) {
    const found = [];
    let cursor = '0';
    do {
      const pattern = prefix.replace(/[*?[\]\\]/g, (ch) => '\\' + ch) + '*';
      const [next, batch] = await this.command(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '500']);
      cursor = String(next);
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  async incr(key, ttlSec) {
    const value = await this.command(['INCR', key]);
    if (value === 1 && ttlSec) await this.command(['EXPIRE', key, String(ttlSec)]);
    return value;
  }
}

// Postgres (Neon) через HTTP: одна таблица «ключ — значение» со сроком жизни.
// Каждая операция — один атомарный запрос, поэтому одновременные запросы сотен людей не мешают друг другу.
class PgStore {
  constructor(url) {
    const { neon } = require('@neondatabase/serverless');
    this.sql = neon(url);
    this.ready = null;
  }

  init() {
    if (!this.ready) {
      this.ready = (async () => {
        await this.sql`CREATE TABLE IF NOT EXISTS horizon_kv (key text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz)`;
        await this.sql`CREATE INDEX IF NOT EXISTS horizon_kv_expires ON horizon_kv (expires_at) WHERE expires_at IS NOT NULL`;
      })().catch((error) => {
        this.ready = null;
        throw error;
      });
    }
    return this.ready;
  }

  // Изредка подчищаем просроченные записи (коды, сеансы, счётчики попыток).
  async sweep() {
    if (Math.random() < 0.02) await this.sql`DELETE FROM horizon_kv WHERE expires_at < now()`;
  }

  async get(key) {
    await this.init();
    const rows = await this.sql`SELECT value FROM horizon_kv WHERE key = ${key} AND (expires_at IS NULL OR expires_at > now())`;
    return rows.length ? rows[0].value : null;
  }

  async set(key, value, ttlSec) {
    await this.init();
    const json = JSON.stringify(value);
    const ttl = ttlSec ? Number(ttlSec) : null;
    await this.sql`INSERT INTO horizon_kv (key, value, expires_at)
      VALUES (${key}, ${json}::jsonb, CASE WHEN ${ttl}::int IS NULL THEN NULL ELSE now() + make_interval(secs => ${ttl}::int) END)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`;
    await this.sweep();
  }

  async del(key) {
    await this.init();
    await this.sql`DELETE FROM horizon_kv WHERE key = ${key}`;
  }

  async keys(prefix) {
    await this.init();
    const pattern = prefix.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
    const rows = await this.sql`SELECT key FROM horizon_kv WHERE key LIKE ${pattern} AND (expires_at IS NULL OR expires_at > now())`;
    return rows.map((r) => r.key);
  }

  // Атомарный счётчик: просроченный обнуляется, срок ставится при первом увеличении.
  async incr(key, ttlSec) {
    await this.init();
    const ttl = ttlSec ? Number(ttlSec) : null;
    const rows = await this.sql`INSERT INTO horizon_kv (key, value, expires_at)
      VALUES (${key}, '1'::jsonb, CASE WHEN ${ttl}::int IS NULL THEN NULL ELSE now() + make_interval(secs => ${ttl}::int) END)
      ON CONFLICT (key) DO UPDATE SET
        value = CASE WHEN horizon_kv.expires_at IS NOT NULL AND horizon_kv.expires_at <= now() THEN '1'::jsonb ELSE to_jsonb((horizon_kv.value #>> '{}')::int + 1) END,
        expires_at = CASE WHEN horizon_kv.expires_at IS NOT NULL AND horizon_kv.expires_at <= now() THEN EXCLUDED.expires_at ELSE horizon_kv.expires_at END
      RETURNING value`;
    return Number(rows[0].value);
  }
}

function createStore(env) {
  const pg = env.DATABASE_URL || env.POSTGRES_URL;
  if (pg) return new PgStore(pg);
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashStore(url, token);
  return new FileStore(env.HORIZON_STORE_FILE || path.join(__dirname, '..', 'data', 'store.json'));
}

module.exports = { createStore, FileStore, UpstashStore, PgStore };
