// Создаёт пару ключей для подписи обновлений. Закрытый ключ хранится только у вас (папка keys/ не попадает в git).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const privateFile = path.join(root, 'keys', 'update-private.pem');
const publicFile = path.join(root, 'src', 'update-key.pub');

if (fs.existsSync(privateFile)) {
  console.log('Ключ уже есть:', privateFile);
  process.exit(0);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(privateFile), { recursive: true });
fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }));
console.log('Закрытый ключ (никому не давать, сделать резервную копию):', privateFile);
console.log('Открытый ключ встроен в браузер:', publicFile);
