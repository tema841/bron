// Учебные данные. Скрипт ПЕРЕСОЗДАЁТ данные (очищает таблицы) — только для учебной БД.
// Пароли берутся из переменных окружения SEED_ADMIN_PASSWORD и SEED_USER_PASSWORD.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const MSK = 3 * 60 * 60 * 1000;

// Момент «через dayOffset дней, в hh:mm по Москве»
function msk(dayOffset, hh, mm = 0) {
  const nowMsk = new Date(Date.now() + MSK);
  const d = Date.UTC(nowMsk.getUTCFullYear(), nowMsk.getUTCMonth(), nowMsk.getUTCDate() + dayOffset, hh, mm);
  return new Date(d - MSK);
}

async function main() {
  const adminPass = process.env.SEED_ADMIN_PASSWORD;
  const userPass = process.env.SEED_USER_PASSWORD;
  if (!adminPass || !userPass) {
    throw new Error('Задайте SEED_ADMIN_PASSWORD и SEED_USER_PASSWORD в .env');
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE audit_events, idempotency_keys, bookings, resources, users RESTART IDENTITY CASCADE');

    const adminHash = await bcrypt.hash(adminPass, 10);
    const userHash = await bcrypt.hash(userPass, 10);
    await client.query(
      `INSERT INTO users (name, login, password_hash, role) VALUES
        ('Администратор', 'admin', $1, 'admin'),
        ('Иванов Иван', 'ivanov', $2, 'user'),
        ('Петрова Анна', 'petrova', $2, 'user')`,
      [adminHash, userHash]
    );

    await client.query(
      `INSERT INTO resources (name, description, location, is_active) VALUES
        ('Аудитория 101', 'Лекционная аудитория на 60 мест, проектор', 'Корпус 1', TRUE),
        ('Аудитория 105', 'Учебный класс на 30 мест', 'Корпус 1', TRUE),
        ('Компьютерный класс 204', '15 рабочих мест, Windows, Visual Studio Code', 'Корпус 2', TRUE),
        ('Компьютерный класс 210', '20 рабочих мест, PostgreSQL, Node.js', 'Корпус 2', TRUE),
        ('Переговорная 3', 'Комната на 8 человек, экран', 'Корпус 3', TRUE),
        ('Актовый зал', 'Зал на 200 мест, звук и сцена', 'Корпус 3', FALSE)`
    );

    // id: 1 admin, 2 ivanov, 3 petrova; ресурсы 1..6
    const rows = [
      // будущие активные
      [1, 2, msk(1, 10), msk(1, 11), 'Консультация по курсовой работе', 'active'],
      [3, 3, msk(1, 12), msk(1, 14), 'Подготовка к демоэкзамену', 'active'],
      [5, 2, msk(2, 15), msk(2, 16, 30), 'Встреча проектной команды', 'active'],
      [2, 1, msk(3, 9), msk(3, 10), 'Собрание кураторов групп', 'active'],
      // отменённая будущая
      [4, 3, msk(2, 10), msk(2, 12), 'Практика по SQL-запросам', 'cancelled'],
      // завершённые (в прошлом)
      [1, 2, msk(-2, 10), msk(-2, 11), 'Защита лабораторной работы', 'active'],
      [3, 3, msk(-1, 14), msk(-1, 15, 30), 'Занятие по веб-разработке', 'active'],
    ];
    for (const [resourceId, userId, s, e, purpose, status] of rows) {
      const cancelled = status === 'cancelled';
      await client.query(
        `INSERT INTO bookings (resource_id, user_id, starts_at, ends_at, purpose, status,
                               cancelled_at, cancelled_by, cancel_reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [resourceId, userId, s, e, purpose, status,
          cancelled ? new Date() : null, cancelled ? userId : null, cancelled ? 'Занятие перенесено' : null,
          new Date(Math.min(s.getTime(), Date.now()) - 24 * 3600 * 1000)]
      );
    }
    await client.query(
      `INSERT INTO audit_events (actor_id, action, object_type, result, details)
       VALUES (1, 'seed', 'database', 'success', '{"note":"учебные данные созданы"}')`
    );
    await client.query('COMMIT');
    console.log('Учебные данные созданы: 3 пользователя (admin, ivanov, petrova), 6 ресурсов, 7 бронирований');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
