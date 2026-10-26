const express = require('express');
const { pool, withTransaction } = require('../db');
const { badRequest, notFound } = require('../errors');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { moscowDayRange } = require('../time');
const { audit } = require('../services/audit');
const { formatBooking, formatResource, BOOKING_SELECT } = require('../services/format');

const router = express.Router();
// Все маршруты — только для администратора: обычный пользователь получает 403
router.use(requireAuth, requireAdmin);

function validateResource(body, partial) {
  const errors = {};
  const out = {};
  for (const [field, min, max] of [['name', 2, 100], ['location', 2, 100], ['description', 0, 1000]]) {
    if (body[field] === undefined) {
      if (!partial && field !== 'description') errors[field] = 'Обязательное поле';
      continue;
    }
    const value = String(body[field]).trim();
    if (value.length < min || value.length > max) errors[field] = `Длина — от ${min} до ${max} символов`;
    else out[field] = value;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') errors.isActive = 'Ожидается true или false';
    else out.isActive = body.isActive;
  }
  if (Object.keys(errors).length) throw badRequest('VALIDATION_ERROR', 'Проверьте заполнение полей', errors);
  return out;
}

// Все ресурсы, включая отключённые
router.get('/resources', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM resources ORDER BY name');
    res.json({ items: rows.map(formatResource) });
  } catch (err) {
    next(err);
  }
});

router.post('/resources', async (req, res, next) => {
  try {
    const data = validateResource(req.body || {}, false);
    const row = await withTransaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO resources (name, description, location) VALUES ($1, $2, $3) RETURNING *`,
        [data.name, data.description || '', data.location]
      );
      await audit(db, {
        actorId: req.user.id, action: 'resource.create', objectType: 'resource',
        objectId: rows[0].id, result: 'success', traceId: req.traceId, details: { name: data.name },
      });
      return rows[0];
    });
    res.status(201).json(formatResource(row));
  } catch (err) {
    next(err);
  }
});

// Изменение и отключение. Строка ресурса блокируется FOR UPDATE — так же,
// как при создании брони (FOR SHARE), поэтому отключение и бронирование не пересекаются.
router.patch('/resources/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Ресурс не найден');
    const data = validateResource(req.body || {}, true);
    if (!Object.keys(data).length) throw badRequest('VALIDATION_ERROR', 'Нет полей для изменения');

    const row = await withTransaction(async (db) => {
      const locked = await db.query('SELECT * FROM resources WHERE id = $1 FOR UPDATE', [id]);
      if (!locked.rows[0]) throw notFound('Ресурс не найден');
      const before = locked.rows[0];
      const next_ = {
        name: data.name ?? before.name,
        description: data.description ?? before.description,
        location: data.location ?? before.location,
        isActive: data.isActive ?? before.is_active,
      };
      const { rows } = await db.query(
        `UPDATE resources SET name = $2, description = $3, location = $4, is_active = $5, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, next_.name, next_.description, next_.location, next_.isActive]
      );
      let action = 'resource.update';
      if (before.is_active && !next_.isActive) action = 'resource.disable';
      if (!before.is_active && next_.isActive) action = 'resource.enable';
      await audit(db, {
        actorId: req.user.id, action, objectType: 'resource', objectId: id,
        result: 'success', traceId: req.traceId, details: data,
      });
      return rows[0];
    });
    res.json(formatResource(row));
  } catch (err) {
    next(err);
  }
});

// Все записи с фильтрами по дате, ресурсу и состоянию
router.get('/bookings', async (req, res, next) => {
  try {
    const params = [];
    const where = [];
    if (req.query.date) {
      const range = moscowDayRange(req.query.date);
      if (!range) throw badRequest('VALIDATION_ERROR', 'Неверная дата', { date: 'Формат ГГГГ-ММ-ДД' });
      params.push(range.from, range.to);
      where.push(`b.starts_at < $${params.length} AND b.ends_at > $${params.length - 1}`);
    }
    if (req.query.resourceId) {
      params.push(Number(req.query.resourceId) || 0);
      where.push(`b.resource_id = $${params.length}`);
    }
    const sql = `${BOOKING_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.starts_at DESC LIMIT 500`;
    const { rows } = await pool.query(sql, params);
    let items = rows.map((r) => formatBooking(r, { withOwner: true }));
    if (req.query.state) items = items.filter((b) => b.state === req.query.state);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Журнал аудита
router.get('/audit', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await pool.query(
      `SELECT a.*, u.login AS actor_login FROM audit_events a
         LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.at DESC LIMIT $1`,
      [limit]
    );
    res.json({
      items: rows.map((a) => ({
        id: Number(a.id), at: a.at.toISOString(), actor: a.actor_login || null, action: a.action,
        objectType: a.object_type, objectId: a.object_id, result: a.result, traceId: a.trace_id, details: a.details,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
