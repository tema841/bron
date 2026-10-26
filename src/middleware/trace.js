const crypto = require('crypto');
const logger = require('../logger');

// Каждому запросу — свой traceId. Он возвращается в заголовке X-Trace-Id
// и в теле ошибки; по нему событие находится в logs/app.log.
module.exports = function trace(req, res, next) {
  req.traceId = crypto.randomUUID();
  res.setHeader('X-Trace-Id', req.traceId);
  const started = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/health')) return;
    logger.info('request', {
      traceId: req.traceId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      userId: req.user ? req.user.id : undefined,
      ms: Date.now() - started,
    });
  });
  next();
};
