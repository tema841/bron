const config = require('./config');
const app = require('./app');
const logger = require('./logger');

app.listen(config.port, () => {
  logger.info('server started', { port: config.port });
  console.log(`Сервис запущен: http://localhost:${config.port}`);
});
