import {
  db, collection, query, where, orderBy, onSnapshot, doc, runTransaction, serverTimestamp,
  getDoc, updateDoc, getCurrentUser, formatPrice, formatDate, showToast, renderHeader
} from "./firebase.js";
import { escapeHtml as esc, makeTicketCode, plural, statusLabel } from "./booking-utils.js";

renderHeader("bookings");
const root = document.getElementById("bookingsList");
const user = await getCurrentUser();

if (!user) {
  root.innerHTML = '<div class="empty"><div class="empty-icon">🎫</div><h3>Войдите, чтобы увидеть билеты</h3><p>После оформления бронирования все ваши рейсы появятся здесь.</p><a class="primary-btn inline-btn" href="login.html?redirect=bookings.html">Войти</a></div>';
} else {
  listenBookings();
}

function listenBookings() {
  const q = query(collection(db, "bookings"), where("userId", "==", user.uid), orderBy("createdAt", "desc"));
  onSnapshot(q, snap => {
    const arr = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.hiddenFromUser !== true);
    renderBookings(arr);
  }, () => {
    root.innerHTML = '<div class="empty"><div class="empty-icon">!</div><h3>Не удалось загрузить билеты</h3><p>Проверьте подключение к Firestore и индекс bookings: userId + createdAt.</p></div>';
  });
}

function renderBookings(arr) {
  root.innerHTML = arr.length ? `
    <div class="booking-list-head"><span>${arr.length} ${plural(arr.length, "билет", "билета", "билетов")}</span><a href="index.html" class="text-link">Найти новый рейс →</a></div>
    <div class="booking-list">${arr.map(ticketCard).join("")}</div>` :
    '<div class="empty"><div class="empty-icon">✈</div><h3>Билетов пока нет</h3><p>Найдите подходящий рейс и оформите бронирование.</p><a class="primary-btn inline-btn" href="index.html">Найти рейс</a></div>';

  root.querySelectorAll("[data-ticket]").forEach(b => b.onclick = () => openTicket(arr.find(x => x.id === b.dataset.ticket)));
  root.querySelectorAll("[data-cancel]").forEach(b => b.onclick = () => cancelBooking(b.dataset.cancel));
  root.querySelectorAll("[data-recart]").forEach(b => b.onclick = () => returnToCart(b.dataset.recart));
  root.querySelectorAll("[data-hide]").forEach(b => b.onclick = () => hideCancelledBooking(b.dataset.hide));
}

function ticketCard(x) {
  const qty = Math.max(1, Number(x.quantity || 1));
  const code = x.bookingCode || makeTicketCode(x.id);
  const isDemo = Boolean(x.isDemo);
  return `<article class="booking-card">
    <div class="ticket-top">
      <div><span class="eyebrow dark">${esc(x.airline || "AIRWAY")}</span><strong>${esc(x.flightNumber || "Рейс")}</strong><small class="ticket-code">${esc(code)}</small></div>
      <span class="status status-${esc(x.status)}">${esc(statusLabel(x.status))}</span>
    </div>
    <div class="ticket-route">
      <div><small>${esc(x.departureTime || "—")}</small><strong>${esc(x.from || "")}</strong><span>${esc(x.fromCity || "")}</span></div>
      <div class="ticket-line"><span>${esc(x.duration || "")}</span><i></i><small>${Number(x.stops || 0) === 0 ? "Прямой" : "С пересадкой"}</small></div>
      <div class="ticket-destination"><small>${esc(x.arrivalTime || "—")}</small><strong>${esc(x.to || "")}</strong><span>${esc(x.toCity || "")}</span></div>
    </div>
    <div class="ticket-bottom">
      <span>${formatDate(x.departureDate)}</span><span>${esc(x.class === "Business" ? "Бизнес" : "Эконом")}</span><span>${esc(x.baggage || "20 кг")}</span><span>${qty} ${plural(qty,"пассажир","пассажира","пассажиров")}</span>
      <strong>${formatPrice(Number(x.price || 0) * qty)}</strong>
    </div>
    <div class="ticket-actions">
      <button class="outline-btn" data-ticket="${esc(x.id)}">Открыть билет</button>
      ${x.status !== "cancelled" ? `<button class="remove-btn" data-cancel="${esc(x.id)}">Отменить</button>` : `<button class="outline-btn" data-recart="${esc(x.id)}">Вернуть в корзину</button><button class="remove-btn" data-hide="${esc(x.id)}">Удалить из истории</button>`}
      ${isDemo ? `<span class="demo-ticket-note">Учебный рейс</span>` : ""}
    </div>
  </article>`;
}

async function returnToCart(id) {
  const booking = await getBookingById(id);
  if (!booking) return;
  if (booking.status !== "cancelled") {
    showToast("В корзину можно вернуть только отменённый билет.", "error");
    return;
  }
  if (booking.hiddenFromUser === true) {
    showToast("Этот билет уже скрыт из истории.", "error");
    return;
  }
  if (!confirm("Проверить актуальность рейса и вернуть билет в корзину?")) return;

  try {
    const quantity = Math.max(1, Number(booking.quantity || 1));
    const flightId = String(booking.flightId || "");
    const isDemo = Boolean(booking.isDemo) || flightId.startsWith("demo-") || flightId.startsWith("generated-");
    let current = { ...booking };

    if (!isDemo) {
      const flightSnap = await getDoc(doc(db, "flights", flightId));
      if (!flightSnap.exists()) throw new Error("Этот рейс больше не существует.");
      const flight = flightSnap.data();
      const seats = Number(flight.seats || 0);
      if (flight.status === "cancelled" || flight.status === "sold_out" || seats < quantity) {
        throw new Error(`Рейс недоступен для возврата в корзину. Свободных мест: ${seats}.`);
      }
      current = { ...current, price: Number(flight.price ?? booking.price ?? 0), airline: flight.airline ?? booking.airline, flightNumber: flight.flightNumber ?? booking.flightNumber, from: flight.from ?? booking.from, to: flight.to ?? booking.to, fromCity: flight.fromCity ?? booking.fromCity, toCity: flight.toCity ?? booking.toCity, departureDate: flight.departureDate ?? booking.departureDate, departureTime: flight.departureTime ?? booking.departureTime, arrivalTime: flight.arrivalTime ?? booking.arrivalTime, duration: flight.duration ?? booking.duration, baggage: flight.baggage ?? booking.baggage, class: flight.class ?? booking.class };
    }

    const existingSnap = await getDocs(query(collection(db, "cart"), where("userId", "==", user.uid)));
    const existing = existingSnap.docs.find(d => String(d.data().flightId || "") === flightId);
    if (existing) {
      const oldQty = Math.max(1, Number(existing.data().quantity || 1));
      const nextQty = Math.min(5, oldQty + quantity);
      await updateDoc(doc(db, "cart", existing.id), { quantity: nextQty, price: Number(current.price || 0) });
    } else {
      const cartRef = doc(collection(db, "cart"));
      await runTransaction(db, async tx => {
        const bookingRef = doc(db, "bookings", id);
        const bookingSnap = await tx.get(bookingRef);
        if (!bookingSnap.exists() || bookingSnap.data().userId !== user.uid) throw new Error("Бронирование не найдено.");
        if (bookingSnap.data().status !== "cancelled") throw new Error("Бронирование больше не отменено.");
        tx.set(cartRef, {
          userId: user.uid, flightId: current.flightId, flightNumber: current.flightNumber || "AW-000", airline: current.airline || "AirWay",
          from: current.from, to: current.to, fromCity: current.fromCity, toCity: current.toCity, departureDate: current.departureDate,
          departureTime: current.departureTime, arrivalTime: current.arrivalTime, duration: current.duration, baggage: current.baggage || "20 кг",
          class: current.class || "Economy", price: Number(current.price || 0), quantity, isDemo, restoredFromBookingId: id, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        tx.set(doc(db, "activityLogs", `${id}-returned-${Date.now()}`), { userId: user.uid, action: "booking_returned_to_cart", bookingId: id, createdAt: serverTimestamp() });
      });
    }
    showToast("Билет возвращён в корзину.");
    setTimeout(() => location.href = "cart.html", 500);
  } catch (e) {
    showToast(e.message || "Не удалось вернуть билет в корзину.", "error");
  }
}

async function getBookingById(id) {
  try {
    const snap = await getDoc(doc(db, "bookings", id));
    if (!snap.exists() || snap.data().userId !== user.uid) throw new Error("Бронирование не найдено.");
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    showToast(e.message || "Не удалось открыть бронирование.", "error");
    return null;
  }
}

async function hideCancelledBooking(id) {
  if (!confirm("Удалить отменённый билет из вашей истории? В базе данных он сохранится для истории и администратора.")) return;
  try {
    const ref = doc(db, "bookings", id);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().userId !== user.uid) throw new Error("Бронирование не найдено.");
    if (snap.data().status !== "cancelled") throw new Error("Скрыть можно только отменённый билет.");
    await updateDoc(ref, { hiddenFromUser: true, hiddenAt: new Date() });
    showToast("Билет удалён из вашей истории.");
  } catch (e) {
    showToast(e.message || "Не удалось удалить билет из истории.", "error");
  }
}

async function cancelBooking(id) {
  if (!confirm("Отменить это бронирование? Свободное место будет возвращено на рейс.")) return;
  try {
    await runTransaction(db, async tx => {
      const bookingRef = doc(db, "bookings", id);
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists()) throw new Error("Бронирование не найдено.");
      const booking = bookingSnap.data();
      if (booking.userId !== user.uid) throw new Error("Нет доступа к этому бронированию.");
      if (booking.status === "cancelled") return;

      const flightId = String(booking.flightId || "");
      let flightRef = null;
      let flight = null;
      if (!booking.isDemo && flightId && !flightId.startsWith("demo-") && !flightId.startsWith("generated-")) {
        flightRef = doc(db, "flights", flightId);
        const flightSnap = await tx.get(flightRef);
        if (flightSnap.exists()) flight = flightSnap.data();
      }

      // Все чтения выполнены выше, после чего идут только записи — требование Firestore Transaction.
      tx.update(bookingRef, { status: "cancelled", cancelledAt: new Date() });
      if (flightRef && flight) {
        const current = Number(flight.seats || 0);
        const total = Number(flight.totalSeats || current + Number(booking.quantity || 1));
        const restored = Math.min(total, current + Math.max(1, Number(booking.quantity || 1)));
        tx.update(flightRef, { seats: restored, status: restored > 0 ? "available" : "sold_out", updatedAt: new Date() });
      }
      tx.set(doc(db, "activityLogs", `${id}-cancelled-${Date.now()}`), { userId: user.uid, action: "booking_cancelled", bookingId: id, createdAt: new Date() });
    });
    showToast("Бронирование отменено, место возвращено.");
  } catch (e) {
    showToast(e.message || "Не удалось отменить бронирование.", "error");
  }
}

function openTicket(x) {
  if (!x) return;
  const overlay = document.createElement("div");
  overlay.className = "ticket-overlay";
  const code = x.bookingCode || makeTicketCode(x.id);
  const ticketCode = x.ticketCode || makeTicketCode(x.id);
  const passengers = Array.isArray(x.passengers) ? x.passengers : [];
  overlay.innerHTML = `<div class="ticket-modal">
    <div class="ticket-modal-head"><div><span class="eyebrow dark">AIRWAY / E-TICKET</span><h2>Электронный билет</h2><p>${esc(code)} · ${esc(statusLabel(x.status))}</p></div><button class="modal-close" id="closeTicket">×</button></div>
    <div class="print-ticket">
      <div class="print-ticket-top"><div><span class="eyebrow dark">${esc(x.airline || "AIRWAY")}</span><h3>${esc(x.flightNumber || "Рейс")}</h3></div><div class="ticket-brand">AIR<span>WAY</span></div></div>
      <div class="print-route"><div><small>${esc(x.departureTime || "—")}</small><strong>${esc(x.from || "")}</strong><span>${esc(x.fromCity || "")}</span></div><div class="print-route-line"><span>${esc(x.duration || "")}</span><i></i></div><div><small>${esc(x.arrivalTime || "—")}</small><strong>${esc(x.to || "")}</strong><span>${esc(x.toCity || "")}</span></div></div>
      <div class="print-ticket-grid"><div><span>Дата</span><strong>${formatDate(x.departureDate)}</strong></div><div><span>Класс</span><strong>${esc(x.class === "Business" ? "Business" : "Economy")}</strong></div><div><span>Багаж</span><strong>${esc(x.baggage || "20 кг")}</strong></div><div><span>Пассажиров</span><strong>${passengers.length || x.quantity || 1}</strong></div></div>
      <div class="passenger-list"><div class="mini-section-title">Пассажиры</div>${passengers.length ? passengers.map((p,i)=>`<div class="passenger-ticket-row"><strong>${i+1}. ${esc(p.firstName)} ${esc(p.lastName)}</strong><span>${esc(p.documentNumber || "Документ не указан")}</span></div>`).join("") : `<div class="passenger-ticket-row"><strong>Пассажир</strong><span>Данные доступны в бронировании</span></div>`}</div>
      <div class="ticket-qr-area"><div id="ticketQr"></div><div><span class="eyebrow dark">BOARDING DATA</span><strong>${esc(ticketCode)}</strong><p>Покажите QR-код при проверке электронного билета.</p></div></div>
      <div class="ticket-reference">Booking ID · ${esc(x.id)}</div>
    </div>
    <div class="ticket-modal-actions"><button class="outline-btn" id="closeTicket2">Закрыть</button><button class="primary-btn" id="printTicket">Печать / PDF →</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#closeTicket").onclick = close;
  overlay.querySelector("#closeTicket2").onclick = close;
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("#printTicket").onclick = () => printTicket(x, code, ticketCode, passengers);

  if (window.QRCode) {
    new window.QRCode(overlay.querySelector("#ticketQr"), { text: JSON.stringify({airway:1, bookingId:x.id, bookingCode:code, ticketCode, flight:x.flightNumber, date:x.departureDate?.toDate ? x.departureDate.toDate().toISOString() : x.departureDate}), width:118, height:118, correctLevel: window.QRCode.CorrectLevel.M });
  } else {
    overlay.querySelector("#ticketQr").innerHTML = '<div class="qr-fallback">QR</div>';
  }
}

function printTicket(x, code, ticketCode, passengers) {
  document.body.classList.add("printing-ticket");
  setTimeout(() => {
    window.print();
    setTimeout(() => document.body.classList.remove("printing-ticket"), 500);
  }, 60);
}

