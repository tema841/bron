const express = require('express');
const path = require('path');
const logger = require('./logger');
const trace = require('./middleware/trace');
const { ApiError } = require('./errors');

const app = express();
app.disable('x-powered-by');
app.use(trace);
app.use(express.json({ limit: '50kb' }));

app.use('/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/admin', require('./routes/admin'));

app.use('/api', (req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Маршрут не найден')));

// Интерфейс
app.use(express.static(path.join(__dirname, '..', 'public')));

// Единый обработчик ошибок: машинный код, сообщение, traceId. Без стека и секретов.
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    err = new ApiError(400, 'INVALID_JSON', 'Тело запроса — некорректный JSON');
  }
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      logger.warn('access denied', { traceId: req.traceId, path: req.path, code: err.code, userId: req.user && req.user.id });
    }
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, traceId: req.traceId, ...(err.details ? { details: err.details } : {}) },
    });
  }
  logger.error('unhandled error', { traceId: req.traceId, path: req.path, error: err.message, stack: err.stack });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера', traceId: req.traceId } });
});

module.exports = app;
