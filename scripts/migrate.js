// Применение миграций из папки migrations по порядку.
// Рекомендательная блокировка pg_advisory_lock не даёт двум процессам
// выполнять миграции одновременно (например, при запуске двух экземпляров).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const LOCK_ID = 841001;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Применена миграция ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Ошибка в миграции ${file}: ${err.message}`);
      }
    }
    console.log('Миграции актуальны');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
