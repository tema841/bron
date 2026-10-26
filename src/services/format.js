// Преобразование строк БД в ответы API.

// Основной статус хранится в БД (active / cancelled).
// «Идёт» и «завершена» вычисляются по времени — фоновое обновление не нужно.
function bookingState(row, now = new Date()) {
  if (row.status === 'cancelled') return 'cancelled';
  if (new Date(row.ends_at) <= now) return 'completed';
  if (new Date(row.starts_at) <= now) return 'started';
  return 'active';
}

function formatBooking(row, { withOwner = false } = {}) {
  const result = {
    id: row.id,
    resource: { id: row.resource_id, name: row.resource_name, location: row.resource_location },
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    purpose: row.purpose,
    status: row.status,
    state: bookingState(row),
    createdAt: new Date(row.created_at).toISOString(),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    cancelReason: row.cancel_reason || null,
  };
  if (withOwner) {
    result.owner = { id: row.user_id, name: row.owner_name, login: row.owner_login };
    result.cancelledBy = row.cancelled_by || null;
  }
  return result;
}

function formatResource(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    location: row.location,
    isActive: row.is_active,
  };
}

// Общий SELECT бронирования с названием ресурса и владельцем
const BOOKING_SELECT = `
  SELECT b.*, r.name AS resource_name, r.location AS resource_location,
         u.name AS owner_name, u.login AS owner_login
    FROM bookings b
    JOIN resources r ON r.id = b.resource_id
    JOIN users u ON u.id = b.user_id`;

module.exports = { formatBooking, formatResource, bookingState, BOOKING_SELECT };
