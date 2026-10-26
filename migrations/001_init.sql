-- Миграция 001. Начальная схема сервиса «Бронь без конфликтов».

-- Расширение нужно для ограничения EXCLUDE по паре (ресурс =, интервал &&)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Пользователи (существующий механизм: хеш пароля bcrypt + JWT)
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    login         VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    role          VARCHAR(10)  NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'admin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Ресурсы: аудитории колледжа
CREATE TABLE resources (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    location    VARCHAR(100) NOT NULL,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Бронирования. Время хранится в UTC (timestamptz) как полуоткрытый интервал [начало, окончание).
CREATE TABLE bookings (
    id            SERIAL PRIMARY KEY,
    resource_id   INTEGER      NOT NULL REFERENCES resources(id),
    user_id       INTEGER      NOT NULL REFERENCES users(id),
    starts_at     TIMESTAMPTZ  NOT NULL,
    ends_at       TIMESTAMPTZ  NOT NULL,
    purpose       VARCHAR(300) NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 5 AND 300),
    status        VARCHAR(10)  NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'cancelled')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    cancelled_at  TIMESTAMPTZ,
    cancelled_by  INTEGER      REFERENCES users(id),
    cancel_reason VARCHAR(300),
    CONSTRAINT bookings_end_after_start CHECK (ends_at > starts_at),
    CONSTRAINT bookings_cancel_info CHECK (
        (status = 'active'    AND cancelled_at IS NULL AND cancelled_by IS NULL)
     OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
    ),
    -- ГЛАВНОЕ ПРАВИЛО: у одного ресурса не может быть двух АКТИВНЫХ записей
    -- с пересекающимися интервалами. '[)' — окончание не входит в интервал,
    -- поэтому соседние записи 10:00–11:00 и 11:00–12:00 разрешены.
    -- Ограничение проверяет сама PostgreSQL, поэтому оно работает при любом
    -- числе одновременных запросов и экземпляров сервера.
    CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        resource_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'active')
);

-- Индекс для GET /api/bookings/my: записи пользователя, новые сверху
CREATE INDEX bookings_user_idx ON bookings (user_id, starts_at DESC);
-- Индекс для GET /api/resources/{id}/availability и админского фильтра:
-- занятые интервалы ресурса за выбранную дату
CREATE INDEX bookings_resource_time_idx ON bookings (resource_id, starts_at)
    WHERE status = 'active';
-- (Ограничение bookings_no_overlap само создаёт GiST-индекс, по нему ищутся пересечения.)

-- Ключи повторного запроса (Idempotency-Key)
CREATE TABLE idempotency_keys (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER     NOT NULL REFERENCES users(id),
    key          VARCHAR(100) NOT NULL,
    request_hash CHAR(64)    NOT NULL,
    booking_id   INTEGER     REFERENCES bookings(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Ключ уникален в пределах пользователя; уникальность обеспечивает БД
    CONSTRAINT idempotency_user_key_uniq UNIQUE (user_id, key)
);

-- Журнал аудита (история действий для администратора)
CREATE TABLE audit_events (
    id          BIGSERIAL PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id    INTEGER     REFERENCES users(id),
    action      VARCHAR(50) NOT NULL,
    object_type VARCHAR(30) NOT NULL,
    object_id   INTEGER,
    result      VARCHAR(20) NOT NULL,
    trace_id    VARCHAR(64),
    details     JSONB
);

-- Индекс для GET /api/admin/audit: последние события
CREATE INDEX audit_events_at_idx ON audit_events (at DESC);
