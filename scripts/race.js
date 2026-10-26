// Инструмент для РУЧНОЙ проверки конкурентности (не автотест):
// отправляет два запроса на создание брони одновременно от двух пользователей
// с разными ключами и печатает ответы. Результат вы сверяете с БД сами.
//
// Запуск: node scripts/race.js <логин1> <логин2> <пароль> <resourceId> <начало ISO> <окончание ISO>
// Пример: node scripts/race.js ivanov petrova pass123 3 2026-10-25T10:00:00+03:00 2026-10-25T11:00:00+03:00
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const [login1, login2, password, resourceId, startsAt, endsAt] = process.argv.slice(2);

async function token(login) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Вход ${login}: ${body.error.message}`);
  return body.token;
}

async function book(tok, who) {
  const r = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ resourceId: Number(resourceId), startsAt, endsAt, purpose: `Проверка гонки (${who})` }),
  });
  return { who, status: r.status, body: await r.json() };
}

(async () => {
  if (!endsAt) {
    console.log('Укажите: логин1 логин2 пароль resourceId начало окончание');
    process.exit(1);
  }
  const [t1, t2] = await Promise.all([token(login1), token(login2)]);
  const results = await Promise.all([book(t1, login1), book(t2, login2)]);
  for (const r of results) {
    console.log(`${r.who}: HTTP ${r.status}`, r.body.id ? `бронь №${r.body.id}` : r.body.error.code);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
