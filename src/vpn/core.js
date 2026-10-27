// Управляет процессом sing-box: запускает его только на 127.0.0.1 со случайным портом и паролем.
const { spawn, execFile } = require('node:child_process');
const CORE_NAME = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

function corePath(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'core', CORE_NAME)
    : path.join(__dirname, '..', '..', 'core', CORE_NAME);
}

function buildConfig(outbound, { port, username, password }) {
  return {
    log: { level: 'warn', timestamp: false },
    dns: { servers: [{ type: 'local', tag: 'local' }] },
    inbounds: [
      {
        type: 'http',
        tag: 'browser',
        listen: '127.0.0.1',
        listen_port: port,
        users: [{ username, password }],
      },
    ],
    // Прямого выхода в конфигурации нет: если сервер недоступен, запросы не уходят мимо VPN.
    outbounds: [outbound],
    route: { final: 'proxy', default_domain_resolver: 'local' },
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port, child, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) return reject(new Error('Ядро VPN завершилось при запуске'));
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error('Ядро VPN не запустилось вовремя'));
        else setTimeout(attempt, 120);
      });
    };
    attempt();
  });
}

class Core extends EventEmitter {
  constructor(app) {
    super();
    this.app = app;
    this.child = null;
    this.credentials = null;
    this.log = [];
    this.pidFile = path.join(app.getPath('userData'), 'vpn-core.pid');
  }

  get running() {
    return Boolean(this.child && this.child.exitCode === null);
  }

  // Если браузер в прошлый раз упал, его ядро могло остаться работать — закрываем только его.
  cleanupStale() {
    let pid;
    try {
      pid = Number(fs.readFileSync(this.pidFile, 'utf8'));
    } catch {
      return Promise.resolve();
    }
    fs.rmSync(this.pidFile, { force: true });
    if (!pid) return Promise.resolve();
    return new Promise((resolve) => {
      // Закрываем ядро, оставшееся от прошлого запуска, — только если по этому номеру всё ещё sing-box.
      const check = process.platform === 'win32'
        ? ['tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']]
        : ['ps', ['-p', String(pid), '-o', 'comm=']];
      execFile(check[0], check[1], { windowsHide: true }, (_err, out) => {
        if (out && /sing-box(\.exe)?/i.test(out)) {
          try {
            process.kill(pid);
          } catch {
            // Процесс уже закрыт.
          }
        }
        resolve();
      });
    });
  }

  async start(outbound) {
    await this.stop();
    const exe = corePath(this.app);
    if (!fs.existsSync(exe)) throw new Error(`Не найдено ядро VPN (core/${CORE_NAME}). Запустите npm run core.`);

    const credentials = {
      port: await freePort(),
      username: crypto.randomBytes(9).toString('base64url'),
      password: crypto.randomBytes(24).toString('base64url'),
    };
    const config = JSON.stringify(buildConfig(outbound, credentials));

    this.log = [];
    // Конфигурация с ключами передаётся через stdin и не пишется на диск.
    const child = spawn(exe, ['run', '-c', 'stdin', '--disable-color'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const collect = (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.log.push(line.trim());
        if (this.log.length > 50) this.log.shift();
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('exit', (code) => {
      if (this.child === child) {
        this.child = null;
        this.credentials = null;
        fs.rmSync(this.pidFile, { force: true });
        this.emit('exit', { code, reason: this.lastError() });
      }
    });
    child.stdin.end(config);
    fs.writeFileSync(this.pidFile, String(child.pid));

    try {
      await waitForPort(credentials.port, child, 8000);
    } catch (error) {
      const reason = this.lastError();
      await this.stop();
      throw new Error(reason ? `${error.message}: ${reason}` : error.message);
    }
    this.credentials = credentials;
    return credentials;
  }

  lastError() {
    const line = [...this.log].reverse().find((l) => /FATAL|ERROR/.test(l)) || this.log[this.log.length - 1] || '';
    return line.replace(/^(FATAL|ERROR|WARN)\[\d+\]\s*/, '');
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.credentials = null;
    fs.rmSync(this.pidFile, { force: true });
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(resolve, 2000);
    });
  }
}

module.exports = { Core, buildConfig, corePath };
