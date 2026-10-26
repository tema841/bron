require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  // SSL для облачной БД (Render и т. п.): DATABASE_SSL=true
  databaseSsl: process.env.DATABASE_SSL === 'true',
};
