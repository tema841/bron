const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool } = require('../db');
const { badRequest, unauthorized, conflict } = require('../errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function issueToken(user) {
  // В токене только id. Роль при каждом запросе читается из БД.
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function publicUser(u) {
  return { id: u.id, name: u.name, login: u.login, role: u.role };
}

// Регистрация: всегда роль «пользователь». Роль из запроса игнорируется.
router.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const errors = {};
    if (name.length < 2 || name.length > 100) errors.name = 'Имя — от 2 до 100 символов';
    if (!/^[a-z0-9_.-]{3,50}$/.test(login)) errors.login = 'Логин — 3–50 символов: латиница, цифры, _ . -';
    if (password.length < 6 || password.length > 72) errors.password = 'Пароль — от 6 до 72 символов';
    if (Object.keys(errors).length) throw badRequest('VALIDATION_ERROR', 'Проверьте заполнение полей', errors);

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, login, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (login) DO NOTHING RETURNING id, name, login, role`,
      [name, login, hash]
    );
    if (!rows[0]) throw conflict('LOGIN_TAKEN', 'Такой логин уже занят');
    res.status(201).json({ token: issueToken(rows[0]), user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!login || !password) {
      throw badRequest('VALIDATION_ERROR', 'Введите логин и пароль', {
        ...(login ? {} : { login: 'Введите логин' }),
        ...(password ? {} : { password: 'Введите пароль' }),
      });
    }
    const { rows } = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw unauthorized('Неверный логин или пароль');
    }
    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
