import {
  db, collection, doc, getDoc, addDoc, getDocs, query, where, onSnapshot,
  serverTimestamp, formatPrice, formatDate, getParam, getCurrentUser, getUserProfile,
  showToast, renderHeader
} from "./firebase.js";
import { findDemoFlight } from "./demoFlights.js";

renderHeader();
const id = getParam("id");
const details = document.getElementById("flightDetails");
const reviews = document.getElementById("reviewsList");

if (!id) details.innerHTML = '<div class="empty">Рейс не найден.</div>'; else loadFlight();

async function loadFlight() {
  let f = null;
  let firestoreRef = null;

  if (String(id).startsWith("demo-") || String(id).startsWith("generated-")) {
    f = findDemoFlight(id);
    if (!f && String(id).startsWith("generated-")) {
      try {
        const stored = sessionStorage.getItem(`airway:generated:${id}`);
        if (stored) f = JSON.parse(stored);
      } catch (error) {
        console.warn("Не удалось восстановить выбранный рейс.", error);
      }
    }
    if (!f && String(id).startsWith("generated-")) {
      f = { id, airline:"AirWay Partner", flightNumber:"AW-101", from:"ALA", fromCity:"Алматы", to:"DXB", toCity:"Дубай", departureDate:new Date().toISOString().slice(0,10), departureTime:"10:20", arrivalTime:"14:35", duration:"4ч 15м", price:68000, seats:12, class:"Economy", stops:0, baggage:"20 кг", status:"available", source:"generated", description:"Демонстрационный вариант по вашему запросу." };
    }
  } else {
    firestoreRef = doc(db, "flights", id);
    const snap = await getDoc(firestoreRef);
    if (snap.exists()) f = { id:snap.id, ...snap.data() };
  }

  if (!f) { details.innerHTML = '<div class="empty">Рейс не найден.</div>'; return; }
  render(f);

  if (firestoreRef) onSnapshot(firestoreRef, s => { if (s.exists()) render({id:s.id,...s.data()}); });
  loadReviews();

  const user = await getCurrentUser();
  document.getElementById("reviewFormWrap").innerHTML = user ? reviewForm() : '<div class="review-form"><p class="muted">Войдите, чтобы оставить отзыв.</p><a class="text-link" href="login.html">Войти в аккаунт →</a></div>';
  document.getElementById("reviewSubmit")?.addEventListener("click", submitReview);
}

function render(f) {
  const available = Number(f.seats || 0) > 0 && f.status !== "sold_out" && f.status !== "cancelled";
  details.innerHTML = `<article class="detail-card">
    <div class="detail-head"><div><span class="eyebrow dark">${esc(f.airline || "AIRLINE")}</span><h1>${esc(f.flightNumber || "Рейс")}</h1><p class="muted">${esc(f.description || "Комфортный авиарейс AirWay.")}</p></div><span class="status ${available ? "status-confirmed" : "status-cancelled"}">${available ? `Осталось ${f.seats || 0} мест` : "Нет мест"}</span></div>
    <div class="detail-route">
      <div><div class="detail-time">${esc(f.departureTime || "—")}</div><div class="airport-code">${esc(f.from || "ALA")}</div><div class="city">${esc(f.fromCity || "Алматы")}</div></div>
      <div><div class="duration">${esc(f.duration || "—")}</div><div class="route-line"></div><small>${Number(f.stops || 0) === 0 ? "Прямой рейс" : `${f.stops} пересадка`}</small></div>
      <div><div class="detail-time">${esc(f.arrivalTime || "—")}</div><div class="airport-code">${esc(f.to || "DXB")}</div><div class="city">${esc(f.toCity || "Дубай")}</div></div>
    </div>
    <div class="detail-info"><div class="info-box"><span>Дата</span><strong>${formatDate(f.departureDate)}</strong></div><div class="info-box"><span>Класс</span><strong>${esc(f.class || "Economy")}</strong></div><div class="info-box"><span>Багаж</span><strong>${esc(f.baggage || "20 кг")}</strong></div><div class="info-box"><span>Мест осталось</span><strong>${f.seats ?? 0}</strong></div></div>
    <div class="detail-buy"><div><span class="muted">Стоимость за пассажира</span><strong>${formatPrice(f.price)}</strong></div><button id="addCart" class="primary-btn" ${available ? "" : "disabled"}>${available ? "Добавить в корзину" : "Нет доступных мест"}</button></div>
  </article>`;
  document.getElementById("addCart")?.addEventListener("click", () => addToCart(f));
}

async function addToCart(f) {
  const user = await getCurrentUser();
  if (!user) { location.href = `login.html?redirect=${encodeURIComponent(`flight.html?id=${f.id}`)}`; return; }
  if (Number(f.seats || 0) <= 0) return showToast("Свободных мест нет.");
  const existing = await getDocs(query(collection(db,"cart"), where("userId","==",user.uid), where("flightId","==",f.id)));
  if (!existing.empty) return showToast("Этот билет уже в корзине.");
  await addDoc(collection(db,"cart"), { userId:user.uid, flightId:f.id, flightNumber:f.flightNumber, airline:f.airline, from:f.from, to:f.to, fromCity:f.fromCity, toCity:f.toCity, departureDate:f.departureDate, departureTime:f.departureTime, arrivalTime:f.arrivalTime, duration:f.duration, baggage:f.baggage, class:f.class || "Economy", price:Number(f.price||0), quantity:1, createdAt:serverTimestamp() });
  showToast("Билет добавлен в корзину.");
  setTimeout(() => location.href = "cart.html", 600);
}

function reviewForm() { return `<div class="review-form"><div class="row"><label class="field"><span>Оценка</span><select id="reviewRating"><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select></label><label class="field"><span>Ваш отзыв</span><input id="reviewText" placeholder="Поделитесь впечатлением"></label><button id="reviewSubmit" class="primary-btn">Опубликовать</button></div></div>`; }
async function submitReview() {
  const user = await getCurrentUser(); if (!user) return;
  const text = document.getElementById("reviewText").value.trim(); const rating = Number(document.getElementById("reviewRating").value);
  if (!text) return showToast("Напишите текст отзыва.");
  const p = await getUserProfile(user.uid);
  await addDoc(collection(db,"reviews"), { userId:user.uid, userName:p?.name || user.displayName || "Пользователь", flightId:id, rating, text, createdAt:serverTimestamp() });
  document.getElementById("reviewText").value = ""; showToast("Отзыв опубликован."); loadReviews();
}
async function loadReviews() {
  try {
    const snap = await getDocs(query(collection(db,"reviews"), where("flightId","==",id)));
    const arr = snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    reviews.innerHTML = arr.length ? arr.map(r => `<div class="review"><div class="review-top"><strong>${esc(r.userName)}</strong><span class="stars">${"★".repeat(r.rating||0)}${"☆".repeat(5-(r.rating||0))}</span></div><p>${esc(r.text)}</p></div>`).join("") : '<div class="empty">Пока отзывов нет.</div>';
  } catch { reviews.innerHTML = '<div class="empty">Отзывы появятся после подключения Firestore.</div>'; }
}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#039;"}[m]));}
