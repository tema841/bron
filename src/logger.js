// Технический журнал: JSON-строки в logs/app.log и в консоль.
// Пароли, JWT, заголовок Authorization и строки подключения сюда не пишутся.
const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const stream = fs.createWriteStream(path.join(logDir, 'app.log'), { flags: 'a' });

function write(level, message, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  stream.write(line + '\n');
  if (level === 'error') console.error(line);
  else console.log(line);
}

module.exports = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
