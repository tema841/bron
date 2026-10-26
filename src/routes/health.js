const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// Процесс жив
router.get('/live', (_req, res) => res.json({ status: 'ok' }));

// Готов обслуживать запросы: БД отвечает. Иначе 503 без внутренних подробностей.
router.get('/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable', message: 'База данных недоступна' });
  }
});

module.exports = router;
