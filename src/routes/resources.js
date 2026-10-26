const express = require('express');
const { pool } = require('../db');
const { badRequest, notFound } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { moscowDayRange } = require('../time');
const { formatResource } = require('../services/format');

const router = express.Router();
router.use(requireAuth);

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound('Ресурс не найден');
  return id;
}

// Каталог активных ресурсов с поиском по названию и фильтром местоположения
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const location = String(req.query.location || '').trim();
    const params = [];
    const where = ['is_active = TRUE'];
    if (q) {
      params.push(`%${q}%`);
      where.push(`name ILIKE $${params.length}`);
    }
    if (location) {
      params.push(location);
      where.push(`location = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT * FROM resources WHERE ${where.join(' AND ')} ORDER BY name`,
      params
    );
    const locations = await pool.query(
      'SELECT DISTINCT location FROM resources WHERE is_active = TRUE ORDER BY location'
    );
    res.json({ items: rows.map(formatResource), locations: locations.rows.map((r) => r.location) });
  } catch (err) {
    next(err);
  }
});

// Карточка ресурса (в том числе отключённого — интерфейс покажет, что бронь недоступна)
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1', [parseId(req.params.id)]);
    if (!rows[0]) throw notFound('Ресурс не найден');
    res.json(formatResource(rows[0]));
  } catch (err) {
    next(err);
  }
});

// Занятые интервалы за дату (московские сутки). Только время — без владельцев и целей.
router.get('/:id/availability', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const range = moscowDayRange(req.query.date);
    if (!range) throw badRequest('VALIDATION_ERROR', 'Укажите дату в формате ГГГГ-ММ-ДД', { date: 'Неверная дата' });
    const exists = await pool.query('SELECT id FROM resources WHERE id = $1', [id]);
    if (!exists.rows[0]) throw notFound('Ресурс не найден');
    const { rows } = await pool.query(
      `SELECT starts_at, ends_at FROM bookings
        WHERE resource_id = $1 AND status = 'active'
          AND starts_at < $3 AND ends_at > $2
        ORDER BY starts_at`,
      [id, range.from, range.to]
    );
    res.json({
      date: req.query.date,
      timezone: 'Europe/Moscow',
      busy: rows.map((r) => ({ startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString() })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
