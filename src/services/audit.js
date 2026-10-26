const { pool } = require('../db');

// Запись события аудита. db — клиент транзакции (чтобы событие и изменение
// сохранились вместе) или общий пул для событий вне транзакции.
async function audit(db, { actorId, action, objectType, objectId, result, traceId, details }) {
  await (db || pool).query(
    `INSERT INTO audit_events (actor_id, action, object_type, object_id, result, trace_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId || null, action, objectType, objectId || null, result, traceId || null, details ? JSON.stringify(details) : null]
  );
}

module.exports = { audit };
