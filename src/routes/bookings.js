const express = require('express');
const crypto = require('crypto');
const { pool, withTransaction } = require('../db');
const { badRequest, notFound, conflict } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { validateInterval } = require('../time');
const { audit } = require('../services/audit');
const { formatBooking, BOOKING_SELECT } = require('../services/format');

const router = express.Router();
router.use(requireAuth);

const isAdmin = (user) => user.role === 'admin';

function parseBookingId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

async function loadBooking(db, id) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  return rows[0];
}

// Проверка полей запроса на создание. Возвращает нормализованные данные.
function validateCreate(body) {
  const errors = {};
  const resourceId = Number(body.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) errors.resourceId = 'Выберите ресурс';

  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  if (purpose.length < 5 || purpose.length > 300) errors.purpose = 'Цель — от 5 до 300 символов';

  const interval = validateInterval(body.startsAt, body.endsAt);
  if (interval.errors) Object.assign(errors, interval.errors);

  if (Object.keys(errors).length) {
    throw badRequest('VALIDATION_ERROR', 'Проверьте заполнение полей', errors);
  }
  return {
    resourceId,
    startsAt: interval.starts.toISOString(),
    endsAt: interval.ends.toISOString(),
    purpose,
  };
}

// Отпечаток нормализованных данных запроса для ключа повтора
function requestHash(data) {
  const canonical = JSON.stringify([data.resourceId, data.startsAt, data.endsAt, data.purpose]);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/*
 * POST /api/bookings — создание бронирования для текущего пользователя.
 *
 * Защита от конфликтов (двойного бронирования):
 *   ограничение БД bookings_no_overlap (EXCLUDE USING gist, migrations/001_init.sql).
 *   PostgreSQL сама не даст сохранить вторую активную запись с пересечением,
 *   даже если два запроса пришли одновременно на разные экземпляры сервера.
 *   Нарушение (код 23P01) превращается в ответ 409.
 *
 * Защита от повторов (Idempotency-Key):
 *   ключ сохраняется в той же транзакции, что и бронирование;
 *   уникальность (user_id, key) обеспечивает БД.
 *
 * Согласованность с отключением ресурса:
 *   строка ресурса блокируется FOR SHARE, а отключение (PATCH) берёт
 *   блокировку на ту же строку. Порядок везде одинаковый: сначала ресурс.
 */
router.post('/', async (req, res, next) => {
  try {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key || key.length > 100) {
      throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Нужен заголовок Idempotency-Key (до 100 символов)');
    }
    const data = validateCreate(req.body || {});
    const hash = requestHash(data);
    const user = req.user;

    const outcome = await withTransaction(async (db) => {
      // 1. Занимаем ключ. Если такой же ключ сейчас обрабатывается в другой
      //    транзакции, PostgreSQL дождётся её окончания.
      const keyRow = await db.query(
        `INSERT INTO idempotency_keys (user_id, key, request_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING
         RETURNING id`,
        [user.id, key, hash]
      );

      if (!keyRow.rows[0]) {
        // Ключ уже использован: это повтор
        const existing = await db.query(
          'SELECT request_hash, booking_id FROM idempotency_keys WHERE user_id = $1 AND key = $2',
          [user.id, key]
        );
        const prev = existing.rows[0];
        if (prev.request_hash !== hash) {
          throw conflict('IDEMPOTENCY_KEY_REUSED', 'Этот ключ запроса уже использован для других данных');
        }
        return { replay: true, booking: await loadBooking(db, prev.booking_id) };
      }

      // 2. Блокируем строку ресурса и проверяем, что он существует и включён
      const resource = await db.query('SELECT id, is_active FROM resources WHERE id = $1 FOR SHARE', [data.resourceId]);
      if (!resource.rows[0]) throw notFound('Ресурс не найден');
      if (!resource.rows[0].is_active) {
        throw conflict('RESOURCE_DISABLED', 'Ресурс отключён: новые бронирования недоступны');
      }

      // 3. Вставка. Пересечение отсекает ограничение bookings_no_overlap.
      let inserted;
      try {
        inserted = await db.query(
          `INSERT INTO bookings (resource_id, user_id, starts_at, ends_at, purpose)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [data.resourceId, user.id, data.startsAt, data.endsAt, data.purpose]
        );
      } catch (err) {
        if (err.code === '23P01') {
          throw conflict('BOOKING_CONFLICT', 'Ресурс уже занят в выбранное время');
        }
        throw err;
      }
      const bookingId = inserted.rows[0].id;

      // 4. Привязываем ключ к записи и пишем аудит — в той же транзакции
      await db.query('UPDATE idempotency_keys SET booking_id = $1 WHERE id = $2', [bookingId, keyRow.rows[0].id]);
      await audit(db, {
        actorId: user.id,
        action: 'booking.create',
        objectType: 'booking',
        objectId: bookingId,
        result: 'success',
        traceId: req.traceId,
        details: { resourceId: data.resourceId, startsAt: data.startsAt, endsAt: data.endsAt },
      });
      return { replay: false, booking: await loadBooking(db, bookingId) };
    });

    if (outcome.replay) res.set('Idempotent-Replayed', 'true');
    res.status(outcome.replay ? 200 : 201).json(formatBooking(outcome.booking));
  } catch (err) {
    if (err.code === 'BOOKING_CONFLICT' || err.code === 'RESOURCE_DISABLED') {
      // Отказ фиксируем в аудите отдельно (сама транзакция откатилась)
      audit(null, {
        actorId: req.user.id,
        action: 'booking.create',
        objectType: 'resource',
        objectId: Number(req.body && req.body.resourceId) || null,
        result: 'rejected',
        traceId: req.traceId,
        details: { reason: err.code },
      }).catch(() => {});
    }
    next(err);
  }
});

// GET /api/bookings/my — собственные записи с фильтром состояния
router.get('/my', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${BOOKING_SELECT} WHERE b.user_id = $1 ORDER BY b.starts_at DESC`, [req.user.id]);
    let items = rows.map((r) => formatBooking(r));
    const state = String(req.query.state || '');
    if (state) items = items.filter((b) => b.state === state);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/{id} — своя запись или любая для администратора.
// Чужая запись для обычного пользователя — 404 (данные не раскрываются).
router.get('/:id', async (req, res, next) => {
  try {
    const row = await loadBooking(pool, parseBookingId(req.params.id));
    if (!row || (row.user_id !== req.user.id && !isAdmin(req.user))) throw notFound();
    res.json(formatBooking(row, { withOwner: isAdmin(req.user) }));
  } catch (err) {
    next(err);
  }
});

/*
 * POST /api/bookings/{id}/cancel — отмена.
 * Строка блокируется FOR UPDATE: при одновременной отмене второй запрос дождётся
 * первого, увидит статус «Отменено» и вернёт запись без нового изменения и аудита.
 */
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const id = parseBookingId(req.params.id);
    const user = req.user;
    const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.trim() : '';

    const row = await withTransaction(async (db) => {
      const locked = await db.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
      const booking = locked.rows[0];
      if (!booking || (booking.user_id !== user.id && !isAdmin(user))) throw notFound();

      if (booking.status === 'cancelled') return loadBooking(db, id); // повтор — без изменений

      if (new Date(booking.starts_at) <= new Date()) {
        throw conflict('BOOKING_STARTED', 'Начавшуюся или завершённую запись отменить нельзя');
      }
      const foreign = booking.user_id !== user.id;
      if (foreign && (reason.length < 5 || reason.length > 300)) {
        throw badRequest('VALIDATION_ERROR', 'Укажите причину отмены (5–300 символов)', { reason: 'Причина обязательна' });
      }
      if (reason.length > 300) {
        throw badRequest('VALIDATION_ERROR', 'Причина — не более 300 символов', { reason: 'Слишком длинная причина' });
      }

      await db.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
          WHERE id = $1`,
        [id, user.id, reason || null]
      );
      await audit(db, {
        actorId: user.id,
        action: foreign ? 'booking.cancel_by_admin' : 'booking.cancel',
        objectType: 'booking',
        objectId: id,
        result: 'success',
        traceId: req.traceId,
        details: reason ? { reason } : undefined,
      });
      return loadBooking(db, id);
    });

    res.json(formatBooking(row, { withOwner: isAdmin(user) }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
