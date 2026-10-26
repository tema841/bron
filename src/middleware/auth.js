const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool } = require('../db');
const { unauthorized, forbidden, ApiError } = require('../errors');

// Проверка JWT. Пользователь и роль берутся из подписанного токена и БД,
// а не из данных, которые прислал клиент.
async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new ApiError(401, 'TOKEN_EXPIRED', 'Срок действия входа истёк. Войдите снова');
      }
      throw unauthorized('Недействительный токен. Войдите снова');
    }

    const { rows } = await pool.query('SELECT id, name, login, role FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0]) throw unauthorized();
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'admin') return next(forbidden());
  next();
}

module.exports = { requireAuth, requireAdmin };
