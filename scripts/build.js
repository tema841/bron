// Сборка: проверка синтаксиса всех файлов и формирование артефакта dist/
// (сервер, клиент, миграции, скрипты и описание зависимостей).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

for (const file of [...jsFiles(path.join(root, 'src')), ...jsFiles(path.join(root, 'scripts')), ...jsFiles(path.join(root, 'public'))]) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const item of ['src', 'public', 'migrations', 'scripts', 'package.json', 'package-lock.json', '.env.example']) {
  fs.cpSync(path.join(root, item), path.join(dist, item), { recursive: true });
}
console.log('Сборка готова: dist/');
