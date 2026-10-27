// Читает server/.env.local (токен бота, секреты) для запуска у себя. На Vercel те же значения
// задаются в настройках проекта, а этот файл не выкладывается и не попадает в git.
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(file = path.join(__dirname, '..', '.env.local')) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    // Файла нет — работаем без него.
  }
  return env;
}

module.exports = { loadEnvFile };
