// Разбор ссылок конфигураций (те же форматы, что у HAPP и v2rayN) в исходящее соединение sing-box.
const crypto = require('node:crypto');

const PROTOCOL_NAMES = {
  vless: 'VLESS',
  vmess: 'VMess',
  trojan: 'Trojan',
  shadowsocks: 'Shadowsocks',
  socks: 'SOCKS5',
  hysteria2: 'Hysteria2',
  tuic: 'TUIC',
};

function fail(message) {
  throw new Error(message);
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function decodeBase64(text) {
  const clean = text.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(clean, 'base64').toString('utf8');
}

function looksLikeIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function toPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('В ссылке неверный порт');
  return port;
}

function splitList(value) {
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

function isOn(value) {
  return value === '1' || value === 'true';
}

// Делит ссылку вида scheme://userinfo@host:port/?query#name на части.
function splitUri(raw) {
  const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/is.exec(raw.trim());
  if (!match) fail('Это не ссылка конфигурации');
  let rest = match[2];
  let name = '';
  const hashAt = rest.indexOf('#');
  if (hashAt >= 0) {
    name = safeDecode(rest.slice(hashAt + 1)).trim();
    rest = rest.slice(0, hashAt);
  }
  let query = '';
  const queryAt = rest.indexOf('?');
  if (queryAt >= 0) {
    query = rest.slice(queryAt + 1);
    rest = rest.slice(0, queryAt);
  }
  const at = rest.lastIndexOf('@');
  const userinfo = at >= 0 ? rest.slice(0, at) : '';
  const hostPort = (at >= 0 ? rest.slice(at + 1) : rest).split('/')[0];
  const hp = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostPort);
  return {
    scheme: match[1].toLowerCase(),
    userinfo,
    hasUserinfo: at >= 0,
    host: hp ? hp[1].replace(/^\[|\]$/g, '') : '',
    port: hp && hp[2] ? toPort(hp[2]) : null,
    params: new URLSearchParams(query),
    name,
    body: rest,
  };
}

function buildTls({ security, sni, host, fp, alpn, insecure, pbk, sid }) {
  if (!security || security === 'none') return undefined;
  if (security !== 'tls' && security !== 'reality' && security !== 'xtls') fail(`Неизвестный режим защиты: ${security}`);
  const serverName = sni || (host && !looksLikeIp(host) ? host : undefined);
  const tls = { enabled: true };
  if (serverName) tls.server_name = serverName;
  if (insecure) tls.insecure = true;
  if (alpn) tls.alpn = alpn;
  if (security === 'reality') {
    if (!pbk) fail('В ссылке Reality нет публичного ключа (pbk)');
    tls.utls = { enabled: true, fingerprint: fp || 'chrome' };
    tls.reality = { enabled: true, public_key: pbk, short_id: sid || '' };
  } else if (fp) {
    tls.utls = { enabled: true, fingerprint: fp };
  }
  return tls;
}

function buildTransport({ type, path, host, serviceName, headerType }) {
  switch (type || 'tcp') {
    case 'tcp':
    case 'raw':
      if (headerType === 'http') {
        return { type: 'http', method: 'GET', path: path || '/', ...(host ? { host: splitList(host) } : {}) };
      }
      return undefined;
    case 'ws': {
      const transport = { type: 'ws', path: path || '/' };
      const early = /[?&]ed=(\d+)/.exec(transport.path);
      if (early) {
        transport.path = transport.path.replace(/[?&]ed=\d+/, '') || '/';
        transport.max_early_data = Number(early[1]);
        transport.early_data_header_name = 'Sec-WebSocket-Protocol';
      }
      if (host) transport.headers = { Host: host };
      return transport;
    }
    case 'grpc':
      return { type: 'grpc', service_name: serviceName || path || '' };
    case 'http':
    case 'h2':
      return { type: 'http', path: path || '/', ...(host ? { host: splitList(host) } : {}) };
    case 'httpupgrade':
      return { type: 'httpupgrade', path: path || '/', ...(host ? { host } : {}) };
    case 'xhttp':
    case 'splithttp':
      return fail('Транспорт XHTTP пока не поддерживается ядром sing-box');
    default:
      return fail(`Транспорт «${type}» не поддерживается`);
  }
}

function withExtras(outbound, extras) {
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined) outbound[key] = value;
  }
  return outbound;
}

function commonFromParams(uri) {
  const p = uri.params;
  return {
    security: p.get('security'),
    sni: p.get('sni') || p.get('peer'),
    host: p.get('host'),
    fp: p.get('fp'),
    alpn: splitList(safeDecode(p.get('alpn') || '')),
    insecure: isOn(p.get('allowInsecure')) || isOn(p.get('insecure')),
    pbk: p.get('pbk'),
    sid: p.get('sid'),
    type: p.get('type'),
    path: p.get('path') !== null ? safeDecode(p.get('path')) : undefined,
    serviceName: p.get('serviceName') !== null ? safeDecode(p.get('serviceName')) : undefined,
    headerType: p.get('headerType'),
  };
}

function parseVless(uri) {
  if (!uri.userinfo || !uri.host || !uri.port) fail('В ссылке VLESS не хватает данных');
  const c = commonFromParams(uri);
  return withExtras(
    { type: 'vless', server: uri.host, server_port: uri.port, uuid: safeDecode(uri.userinfo) },
    {
      flow: uri.params.get('flow') || undefined,
      packet_encoding: 'xudp',
      tls: buildTls({ ...c, host: c.host || uri.host }),
      transport: buildTransport(c),
    },
  );
}

function parseTrojan(uri) {
  if (!uri.userinfo || !uri.host || !uri.port) fail('В ссылке Trojan не хватает данных');
  const c = commonFromParams(uri);
  return withExtras(
    { type: 'trojan', server: uri.host, server_port: uri.port, password: safeDecode(uri.userinfo) },
    {
      tls: buildTls({ ...c, security: c.security || 'tls', host: c.host || uri.host }),
      transport: buildTransport(c),
    },
  );
}

function parseVmess(raw) {
  let data;
  try {
    data = JSON.parse(decodeBase64(raw.slice('vmess://'.length).split('#')[0]));
  } catch {
    fail('Ссылку VMess не удалось прочитать');
  }
  if (!data.add || !data.port || !data.id) fail('В ссылке VMess не хватает данных');
  const net = data.net || 'tcp';
  const outbound = withExtras(
    {
      type: 'vmess',
      server: String(data.add),
      server_port: toPort(data.port),
      uuid: data.id,
      security: data.scy || 'auto',
      alter_id: Number(data.aid) || 0,
    },
    {
      packet_encoding: 'xudp',
      tls: buildTls({
        security: data.tls === 'tls' ? 'tls' : 'none',
        sni: data.sni,
        host: data.host || String(data.add),
        fp: data.fp,
        alpn: splitList(data.alpn),
        insecure: isOn(String(data.allowInsecure || '')),
      }),
      transport: buildTransport({
        type: net,
        path: net === 'grpc' ? undefined : data.path,
        serviceName: net === 'grpc' ? data.path : undefined,
        host: data.host,
        headerType: data.type,
      }),
    },
  );
  return { outbound, name: data.ps || '' };
}

function parseShadowsocks(raw) {
  let uri = splitUri(raw);
  if (!uri.hasUserinfo) {
    // Старый формат: ss://base64(method:password@host:port)#name
    const decoded = decodeBase64(uri.body);
    uri = { ...splitUri(`ss://${decoded}`), name: uri.name, params: uri.params };
  }
  let userinfo = safeDecode(uri.userinfo);
  if (!userinfo.includes(':')) userinfo = decodeBase64(userinfo);
  const colon = userinfo.indexOf(':');
  if (colon < 0 || !uri.host || !uri.port) fail('В ссылке Shadowsocks не хватает данных');
  const outbound = {
    type: 'shadowsocks',
    server: uri.host,
    server_port: uri.port,
    method: userinfo.slice(0, colon),
    password: userinfo.slice(colon + 1),
  };
  const plugin = uri.params.get('plugin');
  if (plugin) {
    const [pluginName, ...opts] = safeDecode(plugin).split(';');
    const name = pluginName === 'simple-obfs' ? 'obfs-local' : pluginName;
    if (name !== 'obfs-local' && name !== 'v2ray-plugin') fail(`Плагин Shadowsocks «${pluginName}» не поддерживается`);
    outbound.plugin = name;
    outbound.plugin_opts = opts.join(';');
  }
  return { outbound, name: uri.name };
}

function parseSocks(uri) {
  if (!uri.host || !uri.port) fail('В ссылке SOCKS не хватает адреса');
  const outbound = { type: 'socks', version: '5', server: uri.host, server_port: uri.port };
  if (uri.userinfo) {
    let auth = safeDecode(uri.userinfo);
    if (!auth.includes(':')) auth = decodeBase64(auth);
    const colon = auth.indexOf(':');
    outbound.username = colon >= 0 ? auth.slice(0, colon) : auth;
    if (colon >= 0) outbound.password = auth.slice(colon + 1);
  }
  return outbound;
}

function parseHysteria2(uri) {
  if (!uri.host || !uri.port) fail('В ссылке Hysteria2 не хватает адреса');
  const p = uri.params;
  const outbound = withExtras(
    { type: 'hysteria2', server: uri.host, server_port: uri.port, password: safeDecode(uri.userinfo) },
    {
      tls: buildTls({
        security: 'tls',
        sni: p.get('sni'),
        host: uri.host,
        insecure: isOn(p.get('insecure')),
        alpn: splitList(p.get('alpn') || '') || ['h3'],
      }),
    },
  );
  if (p.get('obfs') === 'salamander') {
    outbound.obfs = { type: 'salamander', password: p.get('obfs-password') || '' };
  }
  return outbound;
}

function parseTuic(uri) {
  if (!uri.userinfo || !uri.host || !uri.port) fail('В ссылке TUIC не хватает данных');
  const auth = safeDecode(uri.userinfo);
  const colon = auth.indexOf(':');
  const p = uri.params;
  return withExtras(
    {
      type: 'tuic',
      server: uri.host,
      server_port: uri.port,
      uuid: colon >= 0 ? auth.slice(0, colon) : auth,
      password: colon >= 0 ? auth.slice(colon + 1) : '',
    },
    {
      congestion_control: p.get('congestion_control') || undefined,
      udp_relay_mode: p.get('udp_relay_mode') || undefined,
      tls: buildTls({
        security: 'tls',
        sni: p.get('sni'),
        host: uri.host,
        insecure: isOn(p.get('allow_insecure')) || isOn(p.get('insecure')),
        alpn: splitList(p.get('alpn') || '') || ['h3'],
      }),
    },
  );
}

// Главная функция: одна ссылка → { id, name, protocol, outbound }.
function parseLink(raw) {
  const text = raw.trim();
  const scheme = (/^([a-z0-9]+):\/\//i.exec(text) || [])[1]?.toLowerCase();
  let outbound;
  let name = '';

  switch (scheme) {
    case 'vless':
      ({ name } = splitUri(text));
      outbound = parseVless(splitUri(text));
      break;
    case 'vmess':
      ({ outbound, name } = parseVmess(text));
      break;
    case 'trojan':
      ({ name } = splitUri(text));
      outbound = parseTrojan(splitUri(text));
      break;
    case 'ss':
      ({ outbound, name } = parseShadowsocks(text));
      break;
    case 'socks':
    case 'socks5':
      ({ name } = splitUri(text));
      outbound = parseSocks(splitUri(text));
      break;
    case 'hysteria2':
    case 'hy2':
      ({ name } = splitUri(text));
      outbound = parseHysteria2(splitUri(text));
      break;
    case 'tuic':
      ({ name } = splitUri(text));
      outbound = parseTuic(splitUri(text));
      break;
    case 'happ':
      return fail('Это зашифрованная ссылка HAPP: открыть её может только приложение HAPP. Попросите у поставщика обычную ссылку или подписку.');
    default:
      return fail(scheme ? `Протокол «${scheme}» не поддерживается` : 'Это не ссылка конфигурации');
  }

  outbound.tag = 'proxy';
  return makeConfig(name || `${PROTOCOL_NAMES[outbound.type]} · ${outbound.server}`, outbound);
}

// В подписках бывают серверы с одинаковыми настройками, но разными названиями — это разные записи.
function makeConfig(name, outbound) {
  return {
    id: crypto.createHash('sha256').update(name + '\n' + JSON.stringify(outbound)).digest('hex').slice(0, 16),
    name,
    protocol: PROTOCOL_NAMES[outbound.type],
    outbound,
  };
}

// Достаёт все ссылки из текста подписки: обычный список, base64 или JSON sing-box.
function parseSubscriptionBody(body) {
  const text = body.trim();
  const results = [];
  const errors = [];

  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text);
      for (const outbound of json.outbounds || []) {
        if (!PROTOCOL_NAMES[outbound.type] || !outbound.server) continue;
        const copy = { ...outbound, tag: 'proxy' };
        results.push(makeConfig(outbound.tag || `${PROTOCOL_NAMES[outbound.type]} · ${outbound.server}`, copy));
      }
      return { results, errors };
    } catch {
      // Не JSON — пробуем как список ссылок.
    }
  }

  const plain = text.includes('://') ? text : decodeBase64(text);
  for (const line of plain.split(/\r?\n/)) {
    const link = line.trim();
    if (!link || link.startsWith('#')) continue;
    try {
      results.push(parseLink(link));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { results, errors };
}

module.exports = { parseLink, parseSubscriptionBody, decodeBase64, PROTOCOL_NAMES };
