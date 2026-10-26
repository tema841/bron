// Правила времени бронирования. Все проверки выполняются по серверному времени.
// Московское время — UTC+3 без перехода на летнее время.
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const OPEN_MIN = 8 * 60; // 08:00
const CLOSE_MIN = 22 * 60; // 22:00
const STEP_MIN = 30;
const MIN_DURATION = 30;
const MAX_DURATION = 4 * 60;
const MAX_DAYS_AHEAD = 30;

// Дата обязательно со смещением часового пояса: ...Z или ...+03:00
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseInstant(value) {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Разложить момент на московские дату и минуты от полуночи
function toMoscow(date) {
  const m = new Date(date.getTime() + MSK_OFFSET_MS);
  return {
    day: m.toISOString().slice(0, 10),
    minutes: m.getUTCHours() * 60 + m.getUTCMinutes(),
    seconds: m.getUTCSeconds(),
    ms: m.getUTCMilliseconds(),
  };
}

// Полуоткрытый интервал московских суток [00:00, 24:00) в UTC
function moscowDayRange(day) {
  if (typeof day !== 'string' || !DATE_ONLY.test(day)) return null;
  const from = new Date(`${day}T00:00:00+03:00`);
  if (Number.isNaN(from.getTime()) || toMoscow(from).day !== day) return null;
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

// Проверка интервала бронирования. Возвращает { starts, ends } или { errors }.
function validateInterval(startValue, endValue, now = new Date()) {
  const errors = {};
  const starts = parseInstant(startValue);
  const ends = parseInstant(endValue);
  if (!starts) errors.startsAt = 'Укажите начало в формате ISO 8601 со смещением, например 2026-10-21T10:00:00+03:00';
  if (!ends) errors.endsAt = 'Укажите окончание в формате ISO 8601 со смещением, например 2026-10-21T11:00:00+03:00';
  if (Object.keys(errors).length) return { errors };

  const s = toMoscow(starts);
  const e = toMoscow(ends);

  if (ends <= starts) {
    errors.endsAt = 'Окончание должно быть позже начала';
    return { errors };
  }
  if (s.minutes % STEP_MIN || s.seconds || s.ms) errors.startsAt = 'Время выбирается с шагом 30 минут (например 10:00 или 10:30)';
  if (e.minutes % STEP_MIN || e.seconds || e.ms) errors.endsAt = 'Время выбирается с шагом 30 минут (например 11:00 или 11:30)';

  const duration = (ends - starts) / 60000;
  if (duration < MIN_DURATION || duration > MAX_DURATION) {
    errors.endsAt = errors.endsAt || 'Продолжительность — от 30 минут до 4 часов';
  }

  // Окончание ровно в 24:00 не допускается, поэтому достаточно сравнить даты
  const sameDay = s.day === e.day;
  if (!sameDay || s.minutes < OPEN_MIN || e.minutes > CLOSE_MIN) {
    errors.startsAt = errors.startsAt || 'Бронирование возможно с 08:00 до 22:00 по московскому времени в пределах одного дня';
  }

  if (starts <= now) {
    errors.startsAt = 'Начало не может быть в прошлом';
  } else if (starts - now > MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    errors.startsAt = 'Бронировать можно не более чем на 30 суток вперёд';
  }

  if (Object.keys(errors).length) return { errors };
  return { starts, ends };
}

module.exports = { validateInterval, moscowDayRange, toMoscow, parseInstant };
