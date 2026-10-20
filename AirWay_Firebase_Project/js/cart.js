import {
  db, collection, query, where, getDocs, deleteDoc, doc, getDoc, updateDoc, runTransaction,
  serverTimestamp, getCurrentUser, formatPrice, formatDate, showToast, renderHeader
} from "./firebase.js";
import { escapeHtml as esc, makeBookingCode, plural } from "./booking-utils.js";

renderHeader("cart");
const root = document.getElementById("cartContent");
const user = await getCurrentUser();

if (!user) {
  root.innerHTML = '<div class="empty"><div class="empty-icon">🔐</div><h3>Войдите в аккаунт</h3><p>После входа здесь будут сохранённые рейсы.</p><a class="primary-btn inline-btn" href="login.html?redirect=cart.html">Войти</a></div>';
} else {
  load();
}

async function load() {
  try {
    const snap = await getDocs(query(collection(db, "cart"), where("userId", "==", user.uid)));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!items.length) {
      root.innerHTML = '<div class="empty"><div class="empty-icon">🧳</div><h3>Корзина пока пуста</h3><p>Выберите рейс на главной странице, чтобы продолжить бронирование.</p><a class="primary-btn inline-btn" href="index.html">Найти рейс</a></div>';
      return;
    }

    const total = items.reduce((s, x) => s + Number(x.price || 0) * Number(x.quantity || 1), 0);
    const passengers = items.reduce((s, x) => s + Number(x.quantity || 1), 0);

    root.innerHTML = `
      <div class="cart-layout">
        <div>
          <div class="cart-count">${items.length} ${plural(items.length, "рейс", "рейса", "рейсов")} · ${passengers} ${plural(passengers, "пассажир", "пассажира", "пассажиров")}</div>
          <div class="cart-items">${items.map(item).join("")}</div>
        </div>
        <aside class="cart-summary">
          <span class="eyebrow dark">ИТОГ / 01</span>
          <h2>Ваш заказ</h2>
          <div class="summary-row"><span>Рейсы</span><strong>${items.length}</strong></div>
          <div class="summary-row"><span>Пассажиры</span><strong>${passengers}</strong></div>
          <div class="summary-row"><span>Сервисный сбор</span><strong>0 ₸</strong></div>
          <div class="summary-divider"></div>
          <div class="summary-total"><span>Итого</span><strong>${formatPrice(total)}</strong></div>
          <button id="checkout" class="primary-btn full-btn">Перейти к пассажирам →</button>
          <button id="clearCart" class="outline-btn full-btn">Очистить корзину</button>
          <p class="summary-note">Оплата в учебной версии не списывает реальные деньги. Места резервируются только после подтверждения заказа.</p>
        </aside>
      </div>`;

    root.querySelectorAll("[data-remove]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await deleteDoc(doc(db, "cart", b.dataset.remove)); showToast("Билет удалён из корзины."); load(); }
      catch { b.disabled = false; showToast("Не удалось удалить билет.", "error"); }
    });

    root.querySelectorAll("[data-qty]").forEach(b => b.onclick = () => updateQuantity(b.dataset.qty, Number(b.dataset.delta)));
    document.getElementById("checkout").onclick = () => validateAndOpenCheckout(items);
    document.getElementById("clearCart").onclick = async () => {
      if (!confirm("Удалить все билеты из корзины?")) return;
      const button = document.getElementById("clearCart");
      button.disabled = true;
      try {
        await Promise.all(items.map(x => deleteDoc(doc(db, "cart", x.id))));
        showToast("Корзина очищена.");
        load();
      } catch (e) {
        button.disabled = false;
        showToast(e.message || "Не удалось очистить корзину.", "error");
      }
    };
  } catch (e) {
    root.innerHTML = `<div class="empty"><div class="empty-icon">!</div><h3>Не удалось открыть корзину</h3><p>${esc(e.message)}</p></div>`;
  }
}

async function updateQuantity(id, delta) {
  const item = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
  const current = Number(item?.dataset.quantity || 1);
  const next = Math.max(1, Math.min(5, current + delta));
  if (next === current) return;
  try {
    const ref = doc(db, "cart", id);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().userId !== user.uid) return;
    await updateDoc(ref, { quantity: next });
    load();
  } catch { showToast("Не удалось изменить количество.", "error"); }
}

function item(x) {
  const qty = Math.max(1, Number(x.quantity || 1));
  const total = Number(x.price || 0) * qty;
  return `<article class="cart-item" data-item-id="${esc(x.id)}" data-quantity="${qty}">
    <div class="cart-airline">
      <div class="cart-logo">✈</div>
      <div>
        <strong>${esc(x.airline || "AirWay")} · ${esc(x.flightNumber || "Рейс")}</strong>
        <div class="muted">${esc(x.fromCity || x.from)} → ${esc(x.toCity || x.to)}</div>
        <div class="cart-details"><span>${formatDate(x.departureDate)}</span><span>${esc(x.departureTime || "")}</span><span>${esc(x.class === "Business" ? "Бизнес" : "Эконом")}</span><span>${esc(x.baggage || "20 кг")}</span></div>
      </div>
    </div>
    <div class="cart-item-controls">
      <div class="quantity-control"><button type="button" data-qty="${esc(x.id)}" data-delta="-1" aria-label="Уменьшить">−</button><strong>${qty}</strong><button type="button" data-qty="${esc(x.id)}" data-delta="1" aria-label="Увеличить">+</button></div>
      <div class="cart-price"><strong>${formatPrice(total)}</strong><small>${qty > 1 ? `${formatPrice(x.price)} × ${qty}` : "за пассажира"}</small></div>
      <button class="remove-btn" data-remove="${esc(x.id)}">Удалить</button>
    </div>
  </article>`;
}

async function validateAndOpenCheckout(items) {
  const button = document.getElementById("checkout");
  button.disabled = true;
  button.textContent = "Проверяем рейсы...";
  try {
    const checkedItems = [];
    for (const item of items) {
      const qty = Math.max(1, Number(item.quantity || 1));
      const id = String(item.flightId || "");
      if (id.startsWith("demo-") || id.startsWith("generated-")) {
        checkedItems.push(item);
        continue;
      }
      const snap = await getDoc(doc(db, "flights", id));
      if (!snap.exists()) throw new Error(`${item.flightNumber || "Рейс"} больше не доступен.`);
      const flight = snap.data();
      const seats = Number(flight.seats || 0);
      if (flight.status === "cancelled" || flight.status === "sold_out" || seats < qty) {
        throw new Error(`Для рейса ${item.flightNumber || ""} недостаточно мест. Доступно: ${seats}.`);
      }
      checkedItems.push({ ...item, price: Number(flight.price ?? item.price ?? 0) });
    }
    openCheckout(checkedItems);
  } catch (e) {
    showToast(e.message || "Не удалось проверить доступность рейсов.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Перейти к пассажирам →";
  }
}

function openCheckout(items) {
  const totalPassengers = items.reduce((s, x) => s + Number(x.quantity || 1), 0);
  const form = document.createElement("div");
  form.className = "checkout-overlay";
  form.innerHTML = `<div class="checkout-modal">
    <button class="modal-close" id="closeCheckout" aria-label="Закрыть">×</button>
    <div class="checkout-intro"><span class="eyebrow dark">PASSENGER DATA / 02</span><h2>Данные пассажиров</h2><p>Эти данные будут сохранены в электронном билете. Для учебной версии достаточно тестовых данных.</p></div>
    <form id="passengerForm" class="passenger-form">
      <div class="passenger-grid">
        ${Array.from({length: totalPassengers}, (_, i) => passengerFields(i + 1)).join("")}
      </div>
      <label class="check-row"><input id="agree" type="checkbox" required><span>Я проверил данные пассажиров и подтверждаю оформление бронирования.</span></label>
      <div class="checkout-actions"><button type="button" class="outline-btn" id="cancelCheckout">Назад</button><button class="primary-btn" id="confirmBooking">Подтвердить бронирование →</button></div>
    </form>
  </div>`;
  document.body.appendChild(form);
  const close = () => form.remove();
  form.querySelector("#closeCheckout").onclick = close;
  form.querySelector("#cancelCheckout").onclick = close;
  form.querySelector("#passengerForm").onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector("#confirmBooking");
    button.disabled = true;
    button.textContent = "Бронируем...";
    try {
      const passengers = [...form.querySelectorAll(".passenger-block")].map((block, index) => ({
        firstName: block.querySelector("[name=firstName]").value.trim(),
        lastName: block.querySelector("[name=lastName]").value.trim(),
        birthDate: block.querySelector("[name=birthDate]").value,
        documentNumber: block.querySelector("[name=documentNumber]").value.trim().toUpperCase(),
        phone: block.querySelector("[name=phone]").value.trim(),
        seatPreference: block.querySelector("[name=seatPreference]").value,
        index: index + 1
      }));
      await checkout(items, passengers);
      close();
      showToast("Бронирование оформлено. Билеты готовы.");
      setTimeout(() => location.href = "bookings.html", 650);
    } catch (e) {
      button.disabled = false;
      button.textContent = "Подтвердить бронирование →";
      showToast(e.message || "Не удалось оформить заказ.", "error");
    }
  };
}

function passengerFields(n) {
  return `<fieldset class="passenger-block"><legend>Пассажир ${n}</legend>
    <div class="passenger-fields"><label class="field"><span>Имя *</span><input name="firstName" required autocomplete="given-name" placeholder="Роман"></label>
    <label class="field"><span>Фамилия *</span><input name="lastName" required autocomplete="family-name" placeholder="Куликов"></label>
    <label class="field"><span>Дата рождения *</span><input name="birthDate" type="date" required></label>
    <label class="field"><span>Документ *</span><input name="documentNumber" required minlength="5" placeholder="N12345678"></label>
    <label class="field"><span>Телефон *</span><input name="phone" required placeholder="+7 700 000 00 00"></label>
    <label class="field"><span>Место</span><select name="seatPreference"><option value="any">Без предпочтений</option><option value="window">У окна</option><option value="aisle">У прохода</option></select></label></div>
  </fieldset>`;
}

async function checkout(items, passengers) {
  let passengerIndex = 0;
  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const group = passengers.slice(passengerIndex, passengerIndex + quantity);
    passengerIndex += quantity;
    if (group.length !== quantity) throw new Error("Проверьте данные пассажиров.");

    const isDemo = String(item.flightId || "").startsWith("demo-") || String(item.flightId || "").startsWith("generated-");
    const bookingCode = makeBookingCode();
    const bookingData = {
      userId: user.uid, flightId: item.flightId, flightNumber: item.flightNumber || "AW-000", airline: item.airline || "AirWay",
      from: item.from, to: item.to, fromCity: item.fromCity, toCity: item.toCity, departureDate: item.departureDate,
      departureTime: item.departureTime, arrivalTime: item.arrivalTime, duration: item.duration, baggage: item.baggage || "20 кг",
      class: item.class || "Economy", price: Number(item.price || 0), quantity, passengers: group,
      bookingCode, status: "pending", isDemo, createdAt: serverTimestamp()
    };

    if (isDemo) {
      const bookingRef = doc(collection(db, "bookings"));
      bookingData.ticketCode = `AIRWAY-${bookingRef.id.slice(-8).toUpperCase()}`;
      const cartRef = doc(db, "cart", item.id);
      await runTransaction(db, async tx => {
        const cartSnap = await tx.get(cartRef);
        if (!cartSnap.exists() || cartSnap.data().userId !== user.uid) throw new Error("Билет больше не находится в вашей корзине.");
        tx.set(bookingRef, bookingData);
        tx.set(doc(db, "activityLogs", `${bookingRef.id}-created`), {
          userId: user.uid, action: "booking_created", bookingId: bookingRef.id, bookingCode, createdAt: serverTimestamp()
        });
        tx.delete(cartRef);
      });
    } else {
      await bookRealFlight(item, bookingData);
    }
  }
}

async function bookRealFlight(item, bookingData) {
  const flightRef = doc(db, "flights", item.flightId);
  const cartRef = doc(db, "cart", item.id);
  const bookingRef = doc(collection(db, "bookings"));
  bookingData.ticketCode = `AIRWAY-${bookingRef.id.slice(-8).toUpperCase()}`;
  await runTransaction(db, async tx => {
    const [flightSnap, cartSnap] = await Promise.all([tx.get(flightRef), tx.get(cartRef)]);
    if (!flightSnap.exists()) throw new Error("Этот рейс больше не существует.");
    if (!cartSnap.exists() || cartSnap.data().userId !== user.uid) throw new Error("Билет больше не находится в вашей корзине.");
    const flight = flightSnap.data();
    const qty = Math.max(1, Number(item.quantity || 1));
    const seats = Number(flight.seats || 0);
    if (flight.status === "cancelled" || flight.status === "sold_out") throw new Error("Рейс отменён или недоступен.");
    if (seats < qty) throw new Error(`Недостаточно мест. Сейчас доступно: ${seats}.`);
    tx.update(flightRef, { seats: seats - qty, status: seats - qty === 0 ? "sold_out" : "available", updatedAt: serverTimestamp() });
    tx.set(bookingRef, { ...bookingData, price: Number(flight.price || item.price || 0), sourcePrice: Number(item.price || 0) });
    tx.set(doc(db, "activityLogs", `${bookingRef.id}-created`), {
      userId: user.uid, action: "booking_created", bookingId: bookingRef.id, bookingCode: bookingData.bookingCode, createdAt: serverTimestamp()
    });
    tx.delete(cartRef);
  });
}
