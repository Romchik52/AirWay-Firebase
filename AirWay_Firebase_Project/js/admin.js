import {
  db, collection, query, orderBy, where, limit, startAfter, getDocs, getCountFromServer,
  getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction,
  formatPrice, formatDate, requireAdmin, showToast, renderHeader
} from "./firebase.js";
import { routeTemplates, makeDemoFlights } from "./demoFlights.js";
import { escapeHtml as esc, plural, statusLabel } from "./booking-utils.js";

renderHeader();
const guard = document.getElementById("adminGuard");
const content = document.getElementById("adminContent");
const panel = document.getElementById("adminPanel");
const modal = document.getElementById("modal");
const access = await requireAdmin();
if (!access) guard.textContent = "Доступ запрещён.";
else { guard.classList.add("hidden"); content.classList.remove("hidden"); init(); }

let active = "flights";
let pageState = { flights: { page: 1, cursors: [null] }, bookings: { page: 1, cursors: [null] }, users: { page: 1, cursors: [null] }, reviews: { page: 1, cursors: [null] }, logs: { page: 1, cursors: [null] } };
const PAGE_SIZE = 10;

function init() {
  document.querySelectorAll(".admin-tab").forEach(b => b.onclick = () => {
    document.querySelectorAll(".admin-tab").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    active = b.dataset.tab;
    pageState[active] = { page: 1, cursors: [null] };
    renderPanel();
  });
  renderPanel();
  updateStats();
}

async function updateStats() {
  try {
    const [f, b, u, r] = await Promise.all(["flights", "bookings", "users", "reviews"].map(c => getCountFromServer(collection(db, c))));
    const confirmedSnap = await getDocs(query(collection(db, "bookings"), where("status", "==", "confirmed"), limit(200)));
    const pendingSnap = await getDocs(query(collection(db, "bookings"), where("status", "==", "pending"), limit(200)));
    const revenue = confirmedSnap.docs.reduce((total, d) => total + Number(d.data().price || 0) * Number(d.data().quantity || 1), 0);
    document.getElementById("stats").innerHTML = `
      <div class="stat-card"><span>Рейсы</span><strong>${f.data().count}</strong><small>в каталоге</small></div>
      <div class="stat-card"><span>Заказы</span><strong>${b.data().count}</strong><small>в системе</small></div>
      <div class="stat-card"><span>Пользователи</span><strong>${u.data().count}</strong><small>аккаунтов</small></div>
      <div class="stat-card"><span>Отзывы</span><strong>${r.data().count}</strong><small>опубликовано</small></div>
      <div class="stat-card stat-wide"><span>Подтверждённая выручка</span><strong>${formatPrice(revenue)}</strong><small>по загруженным подтверждённым заказам</small></div>`;
    const overview = document.getElementById("adminOverview");
    if (overview) overview.innerHTML = `
      <div class="overview-card"><div class="overview-icon">⌁</div><div><strong>${pendingSnap.size}</strong><span>ожидают обработки</span></div></div>
      <div class="overview-card"><div class="overview-icon">✓</div><div><strong>${confirmedSnap.size}</strong><span>подтверждены</span></div></div>
      <div class="overview-card"><div class="overview-icon">₸</div><div><strong>${formatPrice(revenue)}</strong><span>подтверждено</span></div></div>
      <div class="overview-note"><span class="eyebrow dark">AIRWAY CONTROL</span><strong>Проверяйте заказы перед завершением.</strong><span>Изменение статуса бронирования автоматически учитывает доступные места на рейсе.</span></div>`;
  } catch (e) { console.warn("Не удалось получить статистику", e); }
}
async function renderPanel() {
  panel.innerHTML = '<div class="loading"><span class="loader"></span><br>Загружаем раздел...</div>';
  try {
    if (active === "flights") return renderFlights();
    if (active === "bookings") return renderBookings();
    if (active === "users") return renderUsers();
    if (active === "reviews") return renderReviews();
    return renderLogs();
  } catch (e) {
    panel.innerHTML = `<div class="empty"><h3>Не удалось загрузить раздел</h3><p>${esc(e.message)}</p><button class="secondary-btn" id="retryAdmin">Повторить</button></div>`;
    document.getElementById("retryAdmin")?.addEventListener("click", renderPanel);
  }
}

async function pagedCollection(name, sortField = "createdAt") {
  const state = pageState[name];
  const parts = [collection(db, name), orderBy(sortField, "desc"), limit(PAGE_SIZE)];
  const cursor = state.cursors?.[state.page - 1];
  if (cursor) parts.splice(2, 0, startAfter(cursor));
  const snap = await getDocs(query(...parts));
  state.cursors[state.page] = snap.docs.at(-1) || state.cursors[state.page] || null;
  return { snap, hasMore: snap.size === PAGE_SIZE };
}

async function renderFlights() {
  const state = pageState.flights;
  const parts = [collection(db, "flights"), orderBy("departureDate", "asc"), limit(PAGE_SIZE)];
  const cursor = state.cursors?.[state.page - 1];
  if (cursor) parts.splice(2, 0, startAfter(cursor));
  let snap;
  try { snap = await getDocs(query(...parts)); }
  catch (e) {
    // Нестандартные старые даты не должны ломать админку.
    snap = await getDocs(query(collection(db, "flights"), limit(PAGE_SIZE)));
  }
  state.cursors[state.page] = snap.docs.at(-1) || state.cursors[state.page] || null;
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const hasMore = snap.size === PAGE_SIZE;
  panel.innerHTML = `<div class="admin-table-wrap">
    <div class="admin-toolbar admin-toolbar-stack"><div><strong>Управление рейсами</strong><span>Создание, цены, места и расписание</span></div><div class="admin-toolbar-actions"><button id="seedFlights" class="outline-btn">+ Демо-рейсы</button><button id="addFlight" class="primary-btn">+ Добавить рейс</button></div></div>
    <div class="admin-filterbar"><input id="adminFlightSearch" class="control" placeholder="Поиск по рейсу, авиакомпании или маршруту"><select id="adminFlightStatus" class="control"><option value="">Все статусы</option><option value="available">Доступен</option><option value="sold_out">Нет мест</option><option value="cancelled">Отменён</option></select></div>
    <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Рейс</th><th>Маршрут</th><th>Дата</th><th>Цена</th><th>Места</th><th>Статус</th><th>Действия</th></tr></thead><tbody id="flightRows">${rows.map(flightRow).join("") || '<tr><td colspan="7" class="table-empty">Рейсов пока нет.</td></tr>'}</tbody></table></div>
    ${paginationControls(state.page, hasMore)}</div>`;
  document.getElementById("addFlight").onclick = () => openFlight();
  document.getElementById("seedFlights").onclick = seedFlights;
  const apply = () => {
    const text = document.getElementById("adminFlightSearch").value.toLowerCase().trim();
    const status = document.getElementById("adminFlightStatus").value;
    panel.querySelectorAll("#flightRows tr[data-search]").forEach(row => row.classList.toggle("hidden", !row.dataset.search.includes(text) || (status && row.dataset.status !== status)));
  };
  document.getElementById("adminFlightSearch").oninput = apply;
  document.getElementById("adminFlightStatus").onchange = apply;
  panel.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openFlight(b.dataset.edit));
  panel.querySelectorAll("[data-del]").forEach(b => b.onclick = () => removeFlight(b.dataset.del));
  panel.querySelector("[data-next]")?.addEventListener("click", () => { state.page++; renderPanel(); });
  panel.querySelector("[data-prev]")?.addEventListener("click", () => resetToPrevious("flights"));
}

function flightRow(x) {
  const status = x.status || (Number(x.seats || 0) > 0 ? "available" : "sold_out");
  const search = `${x.flightNumber || ""} ${x.airline || ""} ${x.from || ""} ${x.to || ""} ${x.fromCity || ""} ${x.toCity || ""}`.toLowerCase();
  return `<tr data-search="${esc(search)}" data-status="${esc(status)}"><td><strong>${esc(x.flightNumber || "AW-000")}</strong><br><span>${esc(x.airline || "—")}</span></td><td>${esc(x.from || "")} → ${esc(x.to || "")}<br><span>${esc(x.fromCity || "")} → ${esc(x.toCity || "")}</span></td><td>${formatDate(x.departureDate)}<br><span>${esc(x.departureTime || "—")}</span></td><td>${formatPrice(x.price)}</td><td><strong>${x.seats ?? 0}</strong> / ${x.totalSeats ?? x.seats ?? 0}</td><td><span class="status status-${esc(status)}">${esc(statusLabel(status))}</span></td><td class="table-actions"><button class="table-btn" data-edit="${esc(x.id)}">Изменить</button><button class="table-btn danger" data-del="${esc(x.id)}">Удалить</button></td></tr>`;
}

async function seedFlights() {
  const date = new Date().toISOString().slice(0, 10);
  try {
    for (const [i, f] of makeDemoFlights(date).entries()) {
      const ref = doc(db, "flights", `demo-${date}-${i + 1}`);
      await setDoc(ref, { ...f, totalSeats: f.seats, source: "seed", departureDate: new Date(`${date}T00:00:00`), createdAt: serverTimestamp() }, { merge: true });
    }
    await logAdmin("demo_flights_seeded", { date, count: routeTemplates.length });
    showToast("Демо-рейсы добавлены в Firebase.");
    pageState.flights = { page: 1, cursors: [null] }; renderPanel(); updateStats();
  } catch (e) { showToast(e.message || "Не удалось добавить демо-рейсы.", "error"); }
}

async function openFlight(id = null) {
  let f = {};
  if (id) { const s = await getDoc(doc(db, "flights", id)); f = s.data() || {}; }
  modal.classList.remove("hidden");
  modal.innerHTML = `<div class="modal-card"><div class="modal-heading"><div><span class="eyebrow dark">FLIGHT MANAGEMENT</span><h2>${id ? "Изменить рейс" : "Добавить рейс"}</h2></div><button class="modal-close" id="closeModal">×</button></div><form id="flightForm" class="modal-form">
    <div class="form-section"><span>Маршрут</span><div class="form-grid-2">${input("flightNumber","Номер рейса",f.flightNumber,"KC-207")} ${input("airline","Авиакомпания",f.airline,"Air Astana")}</div><div class="form-grid-2">${input("from","Откуда (код)",f.from,"ALA")} ${input("to","Куда (код)",f.to,"DXB")}</div><div class="form-grid-2">${input("fromCity","Город отправления",f.fromCity,"Алматы")} ${input("toCity","Город прибытия",f.toCity,"Дубай")}</div></div>
    <div class="form-section"><span>Расписание</span><div class="form-grid-3">${input("departureDate","Дата","", "2026-09-20","date",dateString(f.departureDate))}${input("departureTime","Вылет",f.departureTime,"09:30","time")}${input("arrivalTime","Прибытие",f.arrivalTime,"13:10","time")}</div>${input("duration","Длительность",f.duration,"4ч 40м")}</div>
    <div class="form-section"><span>Стоимость и места</span><div class="form-grid-3">${input("price","Цена",f.price,"85000","number")}${input("seats","Свободных мест",f.seats ?? f.totalSeats,"20","number")}${input("totalSeats","Всего мест",f.totalSeats ?? f.seats,"20","number")}</div><div class="form-grid-2">${input("class","Класс",f.class || "Economy","Economy")}${input("stops","Пересадки",f.stops ?? 0,"0","number")}</div></div>
    <div class="modal-actions"><button type="button" class="close-btn" id="closeModal2">Отмена</button><button class="primary-btn">Сохранить рейс →</button></div></form></div>`;
  modal.querySelectorAll("#closeModal,#closeModal2").forEach(b => b.onclick = closeModal);
  document.getElementById("flightForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const data = formData(e.target);
      if (data.seats > data.totalSeats) throw new Error("Свободных мест не может быть больше общего количества.");
      data.status = data.seats > 0 ? "available" : "sold_out";
      data.updatedAt = serverTimestamp();
      if (id) await updateDoc(doc(db, "flights", id), data);
      else await addDoc(collection(db, "flights"), { ...data, createdAt: serverTimestamp() });
      await logAdmin(id ? "flight_updated" : "flight_created", { flightId: id || null, flightNumber: data.flightNumber });
      closeModal(); showToast("Рейс сохранён."); pageState.flights = { page: 1, cursors: [null] }; renderPanel(); updateStats();
    } catch (e2) { showToast(e2.message || "Не удалось сохранить рейс.", "error"); }
  };
}

async function removeFlight(id) {
  if (!confirm("Удалить этот рейс? Бронирования, которые уже созданы, сохранятся.")) return;
  try { await deleteDoc(doc(db, "flights", id)); await logAdmin("flight_deleted", { flightId: id }); showToast("Рейс удалён."); pageState.flights = { page: 1, cursors: [null] }; renderPanel(); updateStats(); }
  catch (e) { showToast(e.message || "Не удалось удалить рейс.", "error"); }
}

async function renderBookings() {
  const { snap, hasMore } = await pagedCollection("bookings", "createdAt");
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  panel.innerHTML = `<div class="admin-table-wrap"><div class="admin-toolbar admin-toolbar-stack"><div><strong>Все заказы</strong><span>Контроль статусов и бронирований</span></div></div><div class="admin-filterbar"><input id="bookingSearch" class="control" placeholder="Поиск по коду, рейсу или пользователю"><select id="bookingStatus" class="control"><option value="">Все статусы</option><option value="pending">Ожидает</option><option value="confirmed">Подтверждён</option><option value="completed">Завершён</option><option value="cancelled">Отменён</option></select></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Бронирование</th><th>Рейс</th><th>Пассажиры</th><th>Дата</th><th>Сумма</th><th>Статус</th></tr></thead><tbody id="bookingRows">${rows.map(x => bookingRow(x)).join("") || '<tr><td colspan="6" class="table-empty">Заказов пока нет.</td></tr>'}</tbody></table></div>${paginationControls(pageState.bookings.page, hasMore)}</div>`;
  const apply = () => { const t = document.getElementById("bookingSearch").value.toLowerCase(); const st = document.getElementById("bookingStatus").value; panel.querySelectorAll("#bookingRows tr[data-search]").forEach(r => r.classList.toggle("hidden", !r.dataset.search.includes(t) || (st && r.dataset.status !== st))); };
  document.getElementById("bookingSearch").oninput = apply; document.getElementById("bookingStatus").onchange = apply;
  panel.querySelectorAll(".status-change").forEach(s => s.onchange = async () => { try { await changeBookingStatus(s.dataset.id, s.value); showToast("Статус обновлён."); } catch (e) { showToast(e.message || "Не удалось изменить статус.", "error"); renderPanel(); } });
  panel.querySelectorAll("[data-booking-detail]").forEach(b => b.onclick = () => openBookingDetail(b.dataset.bookingDetail));
  panel.querySelector("[data-next]")?.addEventListener("click", () => { pageState.bookings.page++; renderPanel(); });
  panel.querySelector("[data-prev]")?.addEventListener("click", () => resetToPrevious("bookings"));
}

async function changeBookingStatus(id, nextStatus) {
  await runTransaction(db, async tx => {
    const bookingRef = doc(db, "bookings", id);
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists()) throw new Error("Бронирование не найдено.");
    const booking = bookingSnap.data();
    const previous = booking.status || "pending";
    if (previous === nextStatus) return;
    const flightId = String(booking.flightId || "");
    const isDemo = Boolean(booking.isDemo) || flightId.startsWith("demo-") || flightId.startsWith("generated-");
    if (!isDemo && flightId) {
      const flightRef = doc(db, "flights", flightId);
      const flightSnap = await tx.get(flightRef);
      if (flightSnap.exists() && ((previous === "cancelled") !== (nextStatus === "cancelled"))) {
        const flight = flightSnap.data();
        const qty = Math.max(1, Number(booking.quantity || 1));
        const seats = Number(flight.seats || 0);
        const total = Number(flight.totalSeats || seats + qty);
        if (nextStatus === "cancelled") {
          const restored = Math.min(total, seats + qty);
          tx.update(flightRef, { seats: restored, status: restored > 0 ? "available" : "sold_out", updatedAt: serverTimestamp() });
        } else {
          if (seats < qty) throw new Error(`Нельзя подтвердить: на рейсе только ${seats} свободных мест.`);
          const left = seats - qty;
          tx.update(flightRef, { seats: left, status: left > 0 ? "available" : "sold_out", updatedAt: serverTimestamp() });
        }
      }
    }
    tx.update(bookingRef, { status: nextStatus, updatedAt: serverTimestamp() });
  });
  await logAdmin("booking_status_changed", { bookingId: id, status: nextStatus });
}

function bookingRow(x) {
  const search = `${x.bookingCode || ""} ${x.flightNumber || ""} ${x.userId || ""}`.toLowerCase();
  const passengers = Array.isArray(x.passengers) ? x.passengers.length : Number(x.quantity || 1);
  return `<tr data-search="${esc(search)}" data-status="${esc(x.status || "pending")}"><td><strong>${esc(x.bookingCode || x.id.slice(0, 8))}</strong><br><span>${esc(x.userId || "")}</span></td><td>${esc(x.flightNumber || "—")}<br><span>${esc(x.from || "")} → ${esc(x.to || "")}</span></td><td>${passengers}</td><td>${formatDate(x.departureDate)}</td><td>${formatPrice(Number(x.price || 0) * Number(x.quantity || 1))}</td><td><select class="control status-change" data-id="${esc(x.id)}"><option value="pending" ${x.status === "pending" ? "selected" : ""}>Ожидает</option><option value="confirmed" ${x.status === "confirmed" ? "selected" : ""}>Подтверждён</option><option value="completed" ${x.status === "completed" ? "selected" : ""}>Завершён</option><option value="cancelled" ${x.status === "cancelled" ? "selected" : ""}>Отменён</option></select><button class="table-btn" data-booking-detail="${esc(x.id)}">Подробнее</button></td></tr>`;
}

async function openBookingDetail(id) {
  try {
    const snap = await getDoc(doc(db, "bookings", id));
    if (!snap.exists()) throw new Error("Бронирование не найдено.");
    const x = { id: snap.id, ...snap.data() };
    const passengers = Array.isArray(x.passengers) ? x.passengers : [];
    const dm = document.getElementById("detailModal");
    dm.classList.remove("hidden");
    dm.innerHTML = `<div class="modal-card detail-card">
      <div class="modal-heading"><div><span class="eyebrow dark">BOOKING DETAILS</span><h2>${esc(x.bookingCode || x.id.slice(0,8))}</h2></div><button class="modal-close" id="closeDetail">×</button></div>
      <div class="detail-grid">
        <div><span>Статус</span><strong>${esc(statusLabel(x.status || "pending"))}</strong></div>
        <div><span>Пользователь</span><strong>${esc(x.userId || "—")}</strong></div>
        <div><span>Рейс</span><strong>${esc(x.flightNumber || "—")}</strong></div>
        <div><span>Маршрут</span><strong>${esc(`${x.from || "—"} → ${x.to || "—"}`)}</strong></div>
        <div><span>Вылет</span><strong>${esc(formatDate(x.departureDate))} · ${esc(x.departureTime || "—")}</strong></div>
        <div><span>Пассажиров</span><strong>${passengers.length || Number(x.quantity || 1)}</strong></div>
        <div><span>Стоимость</span><strong>${formatPrice(Number(x.price || 0) * Number(x.quantity || 1))}</strong></div>
        <div><span>Тип</span><strong>${x.isDemo ? "Демо-рейс" : "Firebase"}</strong></div>
      </div>
      <div class="detail-passengers"><span>Пассажиры</span>${passengers.length ? passengers.map((p,i)=>`<div class="passenger-row"><b>${i+1}</b><span>${esc(p.name || p.fullName || "Пассажир")}</span><small>${esc(p.document || p.passport || "Документ не указан")}</small></div>`).join("") : '<p class="muted">Данные пассажиров не указаны.</p>'}</div>
      <div class="modal-actions"><button class="close-btn" id="closeDetail2">Закрыть</button></div>
    </div>`;
    dm.querySelectorAll("#closeDetail,#closeDetail2").forEach(b => b.onclick = () => { dm.classList.add("hidden"); dm.innerHTML = ""; });
  } catch (e) { showToast(e.message || "Не удалось открыть бронирование.", "error"); }
}

async function renderUsers() {
  const { snap, hasMore } = await pagedCollection("users", "createdAt").catch(async () => ({ snap: await getDocs(query(collection(db, "users"), limit(PAGE_SIZE))), hasMore: false }));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  panel.innerHTML = `<div class="admin-table-wrap"><div class="admin-toolbar admin-toolbar-stack"><div><strong>Пользователи</strong><span>Роли и контактные данные</span></div></div><div class="admin-filterbar"><input id="userSearch" class="control" placeholder="Поиск по имени, email или телефону"></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Имя</th><th>Email</th><th>Телефон</th><th>Роль</th><th>Действие</th></tr></thead><tbody id="userRows">${rows.map(x => `<tr data-search="${esc(`${x.name||""} ${x.email||""} ${x.phone||""}`.toLowerCase())}"><td><strong>${esc(x.name || "—")}</strong></td><td>${esc(x.email || "—")}</td><td>${esc(x.phone || "—")}</td><td class="user-role">${esc(x.role || "user")}</td><td><button class="table-btn" data-role="${esc(x.id)}" data-current="${esc(x.role || "user")}">${x.role === "admin" ? "Сделать user" : "Сделать admin"}</button></td></tr>`).join("") || '<tr><td colspan="5" class="table-empty">Пользователей пока нет.</td></tr>'}</tbody></table></div>${paginationControls(pageState.users.page, hasMore)}</div>`;
  document.getElementById("userSearch").oninput = e => panel.querySelectorAll("#userRows tr[data-search]").forEach(r => r.classList.toggle("hidden", !r.dataset.search.includes(e.target.value.toLowerCase())));
  panel.querySelectorAll("[data-role]").forEach(b => b.onclick = async () => {
    const targetId = b.dataset.role; const currentRole = b.dataset.current;
    const me = await import("./firebase.js").then(m => m.getCurrentUser());
    if (me?.uid === targetId && currentRole === "admin") { showToast("Нельзя снять роль admin с собственного аккаунта.", "error"); return; }
    const nextRole = currentRole === "admin" ? "user" : "admin";
    if (!confirm(`Изменить роль пользователя на ${nextRole}?`)) return;
    try { await updateDoc(doc(db, "users", targetId), { role: nextRole }); await logAdmin("user_role_changed", { userId: targetId, role: nextRole }); showToast("Роль изменена."); renderPanel(); } catch (e) { showToast(e.message || "Не удалось изменить роль.", "error"); }
  });
  panel.querySelector("[data-next]")?.addEventListener("click", () => { pageState.users.page++; renderPanel(); });
  panel.querySelector("[data-prev]")?.addEventListener("click", () => resetToPrevious("users"));
}

async function renderReviews() {
  const { snap, hasMore } = await pagedCollection("reviews", "createdAt").catch(async () => ({ snap: await getDocs(query(collection(db, "reviews"), limit(PAGE_SIZE))), hasMore: false }));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  panel.innerHTML = `<div class="admin-table-wrap"><div class="admin-toolbar admin-toolbar-stack"><div><strong>Модерация отзывов</strong><span>Контроль пользовательского контента</span></div></div><div class="admin-filterbar"><select id="reviewRating" class="control"><option value="">Все оценки</option><option value="5">5 звёзд</option><option value="4">4 звезды</option><option value="3">3 звезды</option><option value="2">2 звезды</option><option value="1">1 звезда</option></select></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Автор</th><th>Рейтинг</th><th>Текст</th><th>Действие</th></tr></thead><tbody id="reviewRows">${rows.map(x => `<tr data-rating="${Number(x.rating||0)}"><td>${esc(x.userName || "Пользователь")}</td><td><span class="stars">${"★".repeat(Number(x.rating || 0))}</span></td><td class="review-cell">${esc(x.text || "")}</td><td><button class="table-btn danger" data-review="${esc(x.id)}">Удалить</button></td></tr>`).join("") || '<tr><td colspan="4" class="table-empty">Отзывов пока нет.</td></tr>'}</tbody></table></div>${paginationControls(pageState.reviews.page, hasMore)}</div>`;
  document.getElementById("reviewRating").onchange = e => panel.querySelectorAll("#reviewRows tr[data-rating]").forEach(r => r.classList.toggle("hidden", Boolean(e.target.value) && r.dataset.rating !== e.target.value));
  panel.querySelectorAll("[data-review]").forEach(b => b.onclick = async () => { if (!confirm("Удалить отзыв?")) return; try { await deleteDoc(doc(db, "reviews", b.dataset.review)); await logAdmin("review_deleted", { reviewId: b.dataset.review }); showToast("Отзыв удалён."); renderPanel(); updateStats(); } catch (e) { showToast(e.message || "Не удалось удалить отзыв.", "error"); } });
  panel.querySelector("[data-next]")?.addEventListener("click", () => { pageState.reviews.page++; renderPanel(); });
  panel.querySelector("[data-prev]")?.addEventListener("click", () => resetToPrevious("reviews"));
}

async function renderLogs() {
  const { snap, hasMore } = await pagedCollection("activityLogs", "createdAt").catch(async () => ({ snap: await getDocs(query(collection(db, "activityLogs"), limit(PAGE_SIZE))), hasMore: false }));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  panel.innerHTML = `<div class="admin-table-wrap"><div class="admin-toolbar admin-toolbar-stack"><div><strong>Журнал действий</strong><span>Служебная история операций AirWay</span></div></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Время</th><th>Действие</th><th>Пользователь</th><th>Объект</th><th>Источник</th></tr></thead><tbody>${rows.map(x => `<tr><td>${formatDate(x.createdAt)}</td><td><strong>${esc(logLabel(x.action))}</strong></td><td>${esc(x.userId || "—")}</td><td>${esc(x.bookingId || x.flightId || x.reviewId || "—")}</td><td>${esc(x.source || "user")}</td></tr>`).join("") || '<tr><td colspan="5" class="table-empty">Журнал пока пуст.</td></tr>'}</tbody></table></div>${paginationControls(pageState.logs.page, hasMore)}</div>`;
  panel.querySelector("[data-next]")?.addEventListener("click", () => { pageState.logs.page++; renderPanel(); });
  panel.querySelector("[data-prev]")?.addEventListener("click", () => resetToPrevious("logs"));
}

function logLabel(action) { return { booking_created:"Создано бронирование", booking_cancelled:"Отменено бронирование", booking_status_changed:"Изменён статус заказа", flight_created:"Создан рейс", flight_updated:"Изменён рейс", flight_deleted:"Удалён рейс", user_role_changed:"Изменена роль", review_deleted:"Удалён отзыв", demo_flights_seeded:"Добавлены демо-рейсы" }[action] || action || "Операция"; }

function paginationControls(page, hasMore) { return `<div class="pagination"><button class="outline-btn" data-prev ${page <= 1 ? "disabled" : ""}>← Назад</button><span>Страница ${page}</span><button class="outline-btn" data-next ${hasMore ? "" : "disabled"}>Далее →</button></div>`; }
function resetToPrevious(name) { const state = pageState[name]; if (state.page > 1) state.page--; renderPanel(); }
function input(id, label, value, placeholder, type = "text", override = "") { return `<label class="field"><span>${label}</span><input name="${id}" type="${type}" value="${esc(override || value ?? "")}" placeholder="${placeholder}" ${type === "number" ? "min='0'" : ""} ${type === "date" ? "required" : ""}></label>`; }
function formData(form) { const o = Object.fromEntries(new FormData(form)); o.price = Number(o.price); o.seats = Number(o.seats); o.totalSeats = Number(o.totalSeats); o.stops = Number(o.stops); o.departureDate = new Date(o.departureDate + "T00:00:00"); return o; }
function dateString(v) { if (!v) return ""; const d = v?.toDate ? v.toDate() : new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); }
function closeModal() { modal.classList.add("hidden"); modal.innerHTML = ""; }
async function logAdmin(action, extra = {}) { const accessUser = await import("./firebase.js").then(m => m.getCurrentUser()); if (!accessUser) return; await addDoc(collection(db, "activityLogs"), { userId: accessUser.uid, action, ...extra, createdAt: serverTimestamp(), source: "admin" }); }
