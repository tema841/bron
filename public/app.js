/* Клиент «Бронь без конфликтов». Один файл, без фреймворков. */
'use strict';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const offlineBanner = document.getElementById('offline');

const STATE_LABELS = {
  active: 'Активна',
  started: 'Идёт',
  completed: 'Завершена',
  cancelled: 'Отменена',
};

// ---------- Хранение сессии ----------
const session = {
  get token() { try { return localStorage.getItem('token'); } catch { return null; } },
  get user() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } },
  save(token, user) {
    try { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); } catch { /* приватный режим */ }
  },
  clear() {
    try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch { /* приватный режим */ }
  },
};

// ---------- Утилиты ----------
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtDate = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const fmtDateTime = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium' });

function interval(b) {
  return `${fmtDate.format(new Date(b.startsAt))}, ${fmtTime.format(new Date(b.startsAt))}–${fmtTime.format(new Date(b.endsAt))} МСК`;
}

// Сегодняшняя дата по Москве в формате ГГГГ-ММ-ДД
function todayMsk(offsetDays = 0) {
  const d = new Date(Date.now() + 3 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function timeOptions(from, to, selected) {
  const out = [];
  for (let m = from; m <= to; m += 30) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    out.push(`<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`);
  }
  return out.join('');
}

function badge(state) {
  return `<span class="badge badge-${esc(state)}">${esc(STATE_LABELS[state] || state)}</span>`;
}

function loading(text = 'Загрузка…') {
  return `<div class="state" role="status" aria-live="polite">${esc(text)}</div>`;
}

function errorBox(err) {
  if (err && err.offline) {
    return `<div class="banner banner-warn" role="alert">Нет связи с сервером. Проверьте сеть и обновите страницу.</div>`;
  }
  const trace = err && err.traceId ? `<br><span class="muted">Код для поддержки: ${esc(err.traceId)}</span>` : '';
  return `<div class="banner banner-err" role="alert">${esc((err && err.message) || 'Ошибка сервера')}${trace}</div>`;
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'k-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// ---------- Запросы к API ----------
class HttpError extends Error {
  constructor(status, body) {
    super((body && body.error && body.error.message) || `Ошибка ${status}`);
    this.status = status;
    this.code = body && body.error && body.error.code;
    this.details = (body && body.error && body.error.details) || {};
    this.traceId = body && body.error && body.error.traceId;
  }
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (session.token) h.Authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    const e = new Error('Нет связи с сервером');
    e.offline = true;
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (res.status === 401 && path !== '/api/auth/login') {
    session.clear();
    sessionStorage.setItem('loginMessage', (data && data.error && data.error.message) || 'Войдите снова');
    location.hash = '#/login';
    throw new HttpError(401, data);
  }
  if (!res.ok) throw new HttpError(res.status, data);
  return data;
}

// ---------- Навигация ----------
function renderNav(route) {
  const user = session.user;
  if (!user) {
    nav.innerHTML = '';
    return;
  }
  const link = (href, text) => `<a href="${href}"${route === href ? ' aria-current="page"' : ''}>${text}</a>`;
  nav.innerHTML = `
    ${link('#/catalog', 'Каталог')}
    ${link('#/my', 'Мои брони')}
    ${user.role === 'admin' ? link('#/admin', 'Администрирование') : ''}
    <span class="who">${esc(user.name)}${user.role === 'admin' ? ' (админ)' : ''}</span>
    <button type="button" id="logout">Выйти</button>`;
  document.getElementById('logout').onclick = () => {
    session.clear();
    location.hash = '#/login';
  };
}

const routes = [
  [/^#\/login$/, pageLogin, false],
  [/^#\/register$/, pageRegister, false],
  [/^#\/catalog$/, pageCatalog, true],
  [/^#\/resource\/(\d+)$/, pageResource, true],
  [/^#\/my$/, pageMy, true],
  [/^#\/admin$/, pageAdmin, true],
];

function router() {
  const hash = location.hash || '#/catalog';
  const found = routes.find(([re]) => re.test(hash));
  if (!found) {
    location.hash = '#/catalog';
    return;
  }
  const [re, page, needAuth] = found;
  if (needAuth && !session.token) {
    location.hash = '#/login';
    return;
  }
  const base = hash.replace(/\/\d+$/, '');
  renderNav(base);
  page(...hash.match(re).slice(1));
  main.focus({ preventScroll: true });
}

window.addEventListener('hashchange', router);
window.addEventListener('online', () => { offlineBanner.hidden = true; });
window.addEventListener('offline', () => { offlineBanner.hidden = false; });
offlineBanner.hidden = navigator.onLine;

// ---------- Вход и регистрация ----------
function pageLogin() {
  if (session.token) { location.hash = '#/catalog'; return; }
  const message = sessionStorage.getItem('loginMessage');
  sessionStorage.removeItem('loginMessage');
  main.innerHTML = `
    <h1>Вход</h1>
    <form class="card" id="login-form" novalidate style="max-width:420px">
      ${message ? `<div class="banner banner-warn" role="alert">${esc(message)}</div>` : ''}
      <div id="login-error"></div>
      <div class="field">
        <label for="login">Логин</label>
        <input id="login" name="login" autocomplete="username" required>
      </div>
      <div class="field">
        <label for="password">Пароль</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn" type="submit">Войти</button>
      <p class="muted">Нет учётной записи? <a href="#/register">Регистрация</a></p>
    </form>`;
  const form = document.getElementById('login-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Вход…';
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { login: form.elements.login.value, password: form.elements.password.value } });
      session.save(data.token, data.user);
      location.hash = '#/catalog';
    } catch (err) {
      document.getElementById('login-error').innerHTML = errorBox(err);
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  };
}

function pageRegister() {
  main.innerHTML = `
    <h1>Регистрация</h1>
    <form class="card" id="reg-form" novalidate style="max-width:420px">
      <div id="reg-error"></div>
      <div class="field"><label for="name">Имя</label><input id="name" name="name" required><span class="error" id="e-name"></span></div>
      <div class="field"><label for="login">Логин</label><input id="login" name="login" autocomplete="username" required>
        <span class="hint">Латиница, цифры, _ . -</span><span class="error" id="e-login"></span></div>
      <div class="field"><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="new-password" required>
        <span class="hint">Не менее 6 символов. Не используйте настоящие пароли — проект учебный.</span><span class="error" id="e-password"></span></div>
      <button class="btn" type="submit">Зарегистрироваться</button>
      <p class="muted"><a href="#/login">Уже есть учётная запись</a></p>
    </form>`;
  const form = document.getElementById('reg-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    const el = form.elements;
    ['name', 'login', 'password'].forEach((f) => { document.getElementById('e-' + f).textContent = ''; el[f].removeAttribute('aria-invalid'); });
    try {
      const data = await api('/api/auth/register', { method: 'POST', body: { name: el.name.value, login: el.login.value, password: el.password.value } });
      session.save(data.token, data.user);
      location.hash = '#/catalog';
    } catch (err) {
      Object.entries(err.details || {}).forEach(([f, msg]) => {
        const span = document.getElementById('e-' + f);
        if (span) { span.textContent = msg; el[f].setAttribute('aria-invalid', 'true'); }
      });
      document.getElementById('reg-error').innerHTML = errorBox(err);
      btn.disabled = false;
    }
  };
}

// ---------- Каталог ----------
function pageCatalog() {
  main.innerHTML = `
    <h1>Каталог аудиторий</h1>
    <form class="toolbar" id="filters" role="search">
      <div class="field"><label for="q">Поиск по названию</label><input id="q" name="q" type="search" placeholder="Например: 204"></div>
      <div class="field"><label for="loc">Местоположение</label><select id="loc" name="loc"><option value="">Все</option></select></div>
      <button class="btn" type="submit">Найти</button>
    </form>
    <div id="list">${loading()}</div>`;
  const form = document.getElementById('filters');
  let locationsLoaded = false;

  async function load() {
    const list = document.getElementById('list');
    list.innerHTML = loading();
    const params = new URLSearchParams();
    if (form.q.value.trim()) params.set('q', form.q.value.trim());
    if (form.loc.value) params.set('location', form.loc.value);
    try {
      const data = await api('/api/resources?' + params);
      if (!locationsLoaded) {
        form.loc.innerHTML = '<option value="">Все</option>' + data.locations.map((l) => `<option>${esc(l)}</option>`).join('');
        locationsLoaded = true;
      }
      if (!data.items.length) {
        list.innerHTML = '<div class="card state">Ничего не найдено. Измените запрос или сбросьте фильтр.</div>';
        return;
      }
      list.innerHTML = `<div class="grid">${data.items.map((r) => `
        <article class="card resource-card">
          <a href="#/resource/${r.id}">${esc(r.name)}</a>
          <span class="muted">${esc(r.location)}</span>
          <span>${esc(r.description)}</span>
        </article>`).join('')}</div>`;
    } catch (err) {
      list.innerHTML = errorBox(err);
    }
  }
  form.onsubmit = (e) => { e.preventDefault(); load(); };
  load();
}

// ---------- Карточка ресурса и форма бронирования ----------
function pageResource(id) {
  main.innerHTML = loading();
  // Состояние формы живёт в памяти страницы: при сетевой ошибке данные и ключ не теряются
  const form = { date: todayMsk(1), start: '10:00', end: '11:00', purpose: '', key: null, lastBody: null };

  api(`/api/resources/${id}`).then((resource) => {
    main.innerHTML = `
      <p><a href="#/catalog">← Каталог</a></p>
      <h1>${esc(resource.name)}</h1>
      <div class="layout-2">
        <section class="card">
          <h2>О ресурсе</h2>
          <p class="muted">${esc(resource.location)}</p>
          <p>${esc(resource.description || 'Описание отсутствует')}</p>
          ${resource.isActive ? '' : '<div class="banner banner-err" role="alert">Ресурс отключён администратором: новые бронирования недоступны.</div>'}
          <h3>Занятое время</h3>
          <div class="field"><label for="av-date">Дата</label><input id="av-date" type="date" value="${form.date}" min="${todayMsk()}" max="${todayMsk(30)}"></div>
          <div id="busy">${loading()}</div>
        </section>
        <section class="card">
          <h2>Бронирование</h2>
          <div id="booking-area"></div>
        </section>
      </div>`;

    const avDate = document.getElementById('av-date');
    avDate.onchange = () => { form.date = avDate.value; loadBusy(); renderForm(); };
    loadBusy();
    renderForm();

    async function loadBusy() {
      const box = document.getElementById('busy');
      if (!form.date) { box.innerHTML = '<p class="muted">Выберите дату</p>'; return; }
      box.innerHTML = loading();
      try {
        const data = await api(`/api/resources/${id}/availability?date=${encodeURIComponent(form.date)}`);
        box.innerHTML = data.busy.length
          ? `<p class="muted">Занято (МСК):</p><ul class="busy">${data.busy.map((b) => `<li>${fmtTime.format(new Date(b.startsAt))}–${fmtTime.format(new Date(b.endsAt))}</li>`).join('')}</ul>`
          : '<p>На эту дату всё время свободно (08:00–22:00 МСК).</p>';
      } catch (err) {
        box.innerHTML = errorBox(err);
      }
    }

    function renderForm(message) {
      const area = document.getElementById('booking-area');
      if (!resource.isActive) {
        area.innerHTML = '<p class="muted">Бронирование недоступно.</p>';
        return;
      }
      area.innerHTML = `
        <form id="book-form" novalidate>
          <div id="form-msg">${message || ''}</div>
          <div class="field"><label for="b-date">Дата</label>
            <input id="b-date" type="date" value="${esc(form.date)}" min="${todayMsk()}" max="${todayMsk(30)}" required>
            <span class="error" id="e-date"></span></div>
          <div class="row">
            <div class="field"><label for="b-start">Начало, МСК</label><select id="b-start">${timeOptions(8 * 60, 21 * 60 + 30, form.start)}</select>
              <span class="error" id="e-startsAt"></span></div>
            <div class="field"><label for="b-end">Окончание, МСК</label><select id="b-end">${timeOptions(8 * 60 + 30, 22 * 60, form.end)}</select>
              <span class="error" id="e-endsAt"></span></div>
          </div>
          <p class="hint muted">Шаг 30 минут, от 30 минут до 4 часов, с 08:00 до 22:00 по Москве.</p>
          <div class="field"><label for="b-purpose">Цель</label>
            <textarea id="b-purpose" maxlength="300" required>${esc(form.purpose)}</textarea>
            <span class="hint">От 5 до 300 символов</span><span class="error" id="e-purpose"></span></div>
          <button class="btn" type="submit">Продолжить</button>
        </form>`;
      const f = document.getElementById('book-form');
      const sync = () => {
        form.date = f.querySelector('#b-date').value;
        form.start = f.querySelector('#b-start').value;
        form.end = f.querySelector('#b-end').value;
        form.purpose = f.querySelector('#b-purpose').value;
      };
      f.oninput = sync;
      f.querySelector('#b-date').onchange = () => { sync(); avDate.value = form.date; loadBusy(); };
      f.onsubmit = (e) => {
        e.preventDefault();
        sync();
        // Клиентская проверка — только для удобства; главная проверка на сервере
        const errs = {};
        if (!form.date) errs.date = 'Выберите дату';
        if (form.end <= form.start) errs.endsAt = 'Окончание должно быть позже начала';
        if (form.purpose.trim().length < 5) errs.purpose = 'Цель — от 5 до 300 символов';
        if (Object.keys(errs).length) { showFieldErrors(errs); return; }
        renderConfirm();
      };
    }

    function showFieldErrors(errs) {
      Object.entries(errs).forEach(([field, msg]) => {
        const el = document.getElementById('e-' + field);
        if (el) el.textContent = msg;
        const map = { date: 'b-date', startsAt: 'b-start', endsAt: 'b-end', purpose: 'b-purpose' };
        const input = document.getElementById(map[field]);
        if (input) input.setAttribute('aria-invalid', 'true');
      });
    }

    function currentBody() {
      return {
        resourceId: Number(id),
        startsAt: `${form.date}T${form.start}:00+03:00`,
        endsAt: `${form.date}T${form.end}:00+03:00`,
        purpose: form.purpose.trim(),
      };
    }

    function renderConfirm(retryMessage) {
      const body = currentBody();
      // Новый ключ — только для новой операции. Повтор тех же данных — прежний ключ.
      if (!form.key || JSON.stringify(body) !== JSON.stringify(form.lastBody)) {
        form.key = uuid();
        form.lastBody = body;
      }
      const area = document.getElementById('booking-area');
      area.innerHTML = `
        ${retryMessage || ''}
        <h3>Проверьте данные</h3>
        <p><strong>${esc(resource.name)}</strong><br>${esc(form.date.split('-').reverse().join('.'))}, ${esc(form.start)}–${esc(form.end)} МСК<br>Цель: ${esc(body.purpose)}</p>
        <div class="row">
          <button class="btn" type="button" id="confirm">${retryMessage ? 'Повторить отправку' : 'Подтвердить бронирование'}</button>
          <button class="btn btn-secondary" type="button" id="back">Изменить</button>
        </div>`;
      document.getElementById('back').onclick = () => renderForm();
      const btn = document.getElementById('confirm');
      btn.focus();
      btn.onclick = async () => {
        btn.disabled = true; // блокируем повторное нажатие на время отправки
        btn.textContent = 'Отправка…';
        try {
          const booking = await api('/api/bookings', { method: 'POST', body, headers: { 'Idempotency-Key': form.key } });
          form.key = null;
          form.lastBody = null;
          form.purpose = '';
          loadBusy();
          area.innerHTML = `
            <div class="banner banner-ok" role="status">
              Бронирование №${booking.id} создано.<br>
              ${esc(booking.resource.name)}, ${esc(interval(booking))}
            </div>
            <div class="row"><a class="btn" href="#/my">Мои брони</a><button class="btn btn-secondary" type="button" id="again">Забронировать ещё</button></div>`;
          document.getElementById('again').onclick = () => renderForm();
        } catch (err) {
          if (err.offline) {
            // Ответ не получен: данные и ключ сохраняются, повтор не создаст дубликат
            renderConfirm('<div class="banner banner-warn" role="alert">Нет связи с сервером. Данные сохранены — нажмите «Повторить отправку». Повтор не создаст вторую запись.</div>');
            return;
          }
          if (err.status === 401) return;
          form.key = null;
          renderForm(errorBox(err));
          if (err.status === 400) showFieldErrors(err.details);
          if (err.code === 'BOOKING_CONFLICT') loadBusy();
        }
      };
    }
  }).catch((err) => {
    main.innerHTML = err.status === 404
      ? '<div class="card state">Ресурс не найден. <a href="#/catalog">Вернуться в каталог</a></div>'
      : errorBox(err);
  });
}

// ---------- Мои брони ----------
function pageMy() {
  main.innerHTML = `
    <h1>Мои бронирования</h1>
    <div class="toolbar">
      <div class="field"><label for="st">Состояние</label>
        <select id="st"><option value="">Все</option><option value="active">Активные</option><option value="started">Идут</option>
        <option value="completed">Завершённые</option><option value="cancelled">Отменённые</option></select></div>
    </div>
    <div id="msg"></div>
    <div id="list">${loading()}</div>`;
  const st = document.getElementById('st');
  st.onchange = load;
  load();

  async function load() {
    const list = document.getElementById('list');
    list.innerHTML = loading();
    try {
      const data = await api('/api/bookings/my' + (st.value ? '?state=' + st.value : ''));
      if (!data.items.length) {
        list.innerHTML = '<div class="card state">Записей нет. <a href="#/catalog">Перейти в каталог</a></div>';
        return;
      }
      list.innerHTML = `<div class="card"><ul class="list">${data.items.map((b) => `
        <li>
          <div class="main">
            <strong>№${b.id} · ${esc(b.resource.name)}</strong> ${badge(b.state)}<br>
            <span>${esc(interval(b))}</span><br>
            <span class="muted">Цель: ${esc(b.purpose)}</span>
            ${b.cancelReason ? `<br><span class="muted">Причина отмены: ${esc(b.cancelReason)}</span>` : ''}
          </div>
          <div class="actions">${b.state === 'active' ? `<button class="btn btn-danger btn-small" data-cancel="${b.id}">Отменить</button>` : ''}</div>
        </li>`).join('')}</ul></div>`;
      list.querySelectorAll('[data-cancel]').forEach((btn) => {
        btn.onclick = () => cancelDialog(btn.dataset.cancel, false, () => {
          document.getElementById('msg').innerHTML = `<div class="banner banner-ok" role="status">Запись №${esc(btn.dataset.cancel)} отменена, время освобождено.</div>`;
          load();
        });
      });
    } catch (err) {
      list.innerHTML = errorBox(err);
    }
  }
}

// Диалог отмены. Для администратора (чужая запись) причина обязательна.
function cancelDialog(bookingId, needReason, onDone) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `
    <form method="dialog" id="cancel-form" novalidate>
      <h2>Отменить запись №${esc(bookingId)}?</h2>
      <div id="cancel-err"></div>
      ${needReason ? `<div class="field"><label for="reason">Причина отмены</label><textarea id="reason" maxlength="300" required></textarea>
        <span class="hint">Обязательно, от 5 символов. Владелец увидит причину.</span></div>` : '<p>Время станет свободным для других пользователей.</p>'}
      <div class="row">
        <button class="btn btn-danger" type="submit" value="ok">Да, отменить</button>
        <button class="btn btn-secondary" type="button" id="cancel-no">Нет</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('#cancel-no').onclick = () => dlg.close();
  const f = dlg.querySelector('#cancel-form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api(`/api/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason: needReason ? f.reason.value : '' } });
      dlg.close();
      onDone();
    } catch (err) {
      dlg.querySelector('#cancel-err').innerHTML = errorBox(err);
      btn.disabled = false;
    }
  };
}

// ---------- Администрирование ----------
function pageAdmin() {
  if (!session.user || session.user.role !== 'admin') {
    main.innerHTML = '<div class="banner banner-err" role="alert">Раздел доступен только администратору.</div>';
    return;
  }
  main.innerHTML = `
    <h1>Администрирование</h1>
    <div class="tabs" role="tablist">
      <button class="btn btn-secondary" role="tab" data-tab="resources" aria-selected="true">Ресурсы</button>
      <button class="btn btn-secondary" role="tab" data-tab="bookings" aria-selected="false">Все записи</button>
      <button class="btn btn-secondary" role="tab" data-tab="audit" aria-selected="false">Аудит</button>
    </div>
    <div id="tab"></div>`;
  const tabs = main.querySelectorAll('[role=tab]');
  tabs.forEach((t) => {
    t.onclick = () => {
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      ({ resources: adminResources, bookings: adminBookings, audit: adminAudit })[t.dataset.tab]();
    };
  });
  adminResources();
}

async function adminResources(message) {
  const tab = document.getElementById('tab');
  tab.innerHTML = loading();
  try {
    const data = await api('/api/admin/resources');
    tab.innerHTML = `
      ${message || ''}
      <form class="card" id="res-form" novalidate>
        <h2 id="res-form-title">Новый ресурс</h2>
        <input type="hidden" id="r-id">
        <div class="row">
          <div class="field"><label for="r-name">Название</label><input id="r-name" required><span class="error" id="e-r-name"></span></div>
          <div class="field"><label for="r-location">Местоположение</label><input id="r-location" required><span class="error" id="e-r-location"></span></div>
        </div>
        <div class="field"><label for="r-description">Описание</label><textarea id="r-description" maxlength="1000"></textarea></div>
        <div class="row"><button class="btn" type="submit" id="r-save">Создать</button>
          <button class="btn btn-secondary" type="button" id="r-reset">Очистить</button></div>
      </form>
      <div class="card">
        <h2>Ресурсы</h2>
        ${data.items.length ? `<ul class="list">${data.items.map((r) => `
          <li>
            <div class="main"><strong>${esc(r.name)}</strong> ${r.isActive ? '<span class="badge badge-active">Включён</span>' : '<span class="badge badge-off">Отключён</span>'}<br>
              <span class="muted">${esc(r.location)}</span></div>
            <div class="actions">
              <button class="btn btn-secondary btn-small" data-edit="${r.id}">Изменить</button>
              <button class="btn ${r.isActive ? 'btn-danger' : ''} btn-small" data-toggle="${r.id}" data-active="${r.isActive}">${r.isActive ? 'Отключить' : 'Включить'}</button>
            </div>
          </li>`).join('')}</ul>` : '<p class="state">Ресурсов пока нет.</p>'}
      </div>`;

    const f = document.getElementById('res-form');
    const reset = () => {
      f.reset();
      document.getElementById('r-id').value = '';
      document.getElementById('res-form-title').textContent = 'Новый ресурс';
      document.getElementById('r-save').textContent = 'Создать';
    };
    document.getElementById('r-reset').onclick = reset;
    tab.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const r = data.items.find((x) => String(x.id) === b.dataset.edit);
        document.getElementById('r-id').value = r.id;
        document.getElementById('r-name').value = r.name;
        document.getElementById('r-location').value = r.location;
        document.getElementById('r-description').value = r.description;
        document.getElementById('res-form-title').textContent = `Изменение: ${r.name}`;
        document.getElementById('r-save').textContent = 'Сохранить';
        document.getElementById('r-name').focus();
      };
    });
    tab.querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const active = b.dataset.active === 'true';
        try {
          await api(`/api/admin/resources/${b.dataset.toggle}`, { method: 'PATCH', body: { isActive: !active } });
          adminResources(`<div class="banner banner-ok" role="status">Ресурс ${active ? 'отключён' : 'включён'}.${active ? ' Существующие записи сохранены — при необходимости отмените их во вкладке «Все записи».' : ''}</div>`);
        } catch (err) {
          b.disabled = false;
          tab.insertAdjacentHTML('afterbegin', errorBox(err));
        }
      };
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const id = document.getElementById('r-id').value;
      const body = {
        name: document.getElementById('r-name').value,
        location: document.getElementById('r-location').value,
        description: document.getElementById('r-description').value,
      };
      const btn = document.getElementById('r-save');
      btn.disabled = true;
      try {
        await api(id ? `/api/admin/resources/${id}` : '/api/admin/resources', { method: id ? 'PATCH' : 'POST', body });
        adminResources(`<div class="banner banner-ok" role="status">Ресурс ${id ? 'сохранён' : 'создан'}.</div>`);
      } catch (err) {
        btn.disabled = false;
        ['name', 'location'].forEach((k) => { document.getElementById('e-r-' + k).textContent = (err.details || {})[k] || ''; });
        f.insertAdjacentHTML('afterbegin', errorBox(err));
      }
    };
  } catch (err) {
    tab.innerHTML = errorBox(err);
  }
}

async function adminBookings(message) {
  const tab = document.getElementById('tab');
  tab.innerHTML = loading();
  let resources = [];
  try { resources = (await api('/api/admin/resources')).items; } catch (err) { tab.innerHTML = errorBox(err); return; }
  tab.innerHTML = `
    ${message || ''}
    <form class="toolbar card" id="ab-filters">
      <div class="field"><label for="ab-date">Дата</label><input id="ab-date" type="date"></div>
      <div class="field"><label for="ab-res">Ресурс</label><select id="ab-res"><option value="">Все</option>
        ${resources.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="ab-st">Состояние</label><select id="ab-st"><option value="">Все</option><option value="active">Активные</option>
        <option value="started">Идут</option><option value="completed">Завершённые</option><option value="cancelled">Отменённые</option></select></div>
      <button class="btn" type="submit">Показать</button>
    </form>
    <div id="ab-list">${loading()}</div>`;
  const f = document.getElementById('ab-filters');
  f.onsubmit = (e) => { e.preventDefault(); load(); };
  load();

  async function load() {
    const list = document.getElementById('ab-list');
    list.innerHTML = loading();
    const p = new URLSearchParams();
    if (f['ab-date'].value) p.set('date', f['ab-date'].value);
    if (f['ab-res'].value) p.set('resourceId', f['ab-res'].value);
    if (f['ab-st'].value) p.set('state', f['ab-st'].value);
    try {
      const data = await api('/api/admin/bookings?' + p);
      if (!data.items.length) { list.innerHTML = '<div class="card state">Записей по фильтру нет.</div>'; return; }
      list.innerHTML = `<div class="card"><ul class="list">${data.items.map((b) => `
        <li>
          <div class="main"><strong>№${b.id} · ${esc(b.resource.name)}</strong> ${badge(b.state)}<br>
            ${esc(interval(b))}<br>
            <span class="muted">Владелец: ${esc(b.owner.name)} (${esc(b.owner.login)}) · Цель: ${esc(b.purpose)}</span>
            ${b.cancelReason ? `<br><span class="muted">Причина отмены: ${esc(b.cancelReason)}</span>` : ''}</div>
          <div class="actions">${b.state === 'active' ? `<button class="btn btn-danger btn-small" data-cancel="${b.id}" data-own="${b.owner.id === session.user.id}">Отменить</button>` : ''}</div>
        </li>`).join('')}</ul></div>`;
      list.querySelectorAll('[data-cancel]').forEach((btn) => {
        btn.onclick = () => cancelDialog(btn.dataset.cancel, btn.dataset.own !== 'true', () => {
          adminBookings(`<div class="banner banner-ok" role="status">Запись №${esc(btn.dataset.cancel)} отменена.</div>`);
        });
      });
    } catch (err) {
      list.innerHTML = errorBox(err);
    }
  }
}

async function adminAudit() {
  const tab = document.getElementById('tab');
  tab.innerHTML = loading();
  try {
    const data = await api('/api/admin/audit?limit=200');
    if (!data.items.length) { tab.innerHTML = '<div class="card state">Событий пока нет.</div>'; return; }
    tab.innerHTML = `<div class="card table-wrap"><table>
      <thead><tr><th>Время (МСК)</th><th>Исполнитель</th><th>Действие</th><th>Объект</th><th>Результат</th><th>traceId</th></tr></thead>
      <tbody>${data.items.map((a) => `<tr>
        <td>${esc(fmtDateTime.format(new Date(a.at)))}</td><td>${esc(a.actor || '—')}</td><td>${esc(a.action)}</td>
        <td>${esc(a.objectType)}${a.objectId ? ' №' + esc(a.objectId) : ''}</td><td>${esc(a.result)}</td>
        <td class="muted">${esc(a.traceId || '—')}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (err) {
    tab.innerHTML = errorBox(err);
  }
}

router();
