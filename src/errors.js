// Единый формат ошибок: { error: { code, message, traceId, details? } }
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (code, message, details) => new ApiError(400, code, message, details);
const unauthorized = (message = 'Требуется вход в систему') => new ApiError(401, 'UNAUTHORIZED', message);
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'Недостаточно прав для этой операции');
const notFound = (message = 'Запись не найдена') => new ApiError(404, 'NOT_FOUND', message);
const conflict = (code, message) => new ApiError(409, code, message);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict };
