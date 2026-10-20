import {
  db, collection, query, where, orderBy, limit, startAfter, getDocs, Timestamp,
  formatPrice, formatDate, renderHeader
} from "./firebase.js";
import { makeDemoFlights, dateKey, routeTemplates } from "./demoFlights.js";

renderHeader("home");

const grid = document.getElementById("flightGrid");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const countEl = document.getElementById("resultsCount");
const airlineFilter = document.getElementById("airlineFilter");
const classFilter = document.getElementById("classFilter");
const stopsFilter = document.getElementById("stopsFilter");
const sortSelect = document.getElementById("sortSelect");
const fromInput = document.getElementById("fromInput");
const toInput = document.getElementById("toInput");
const dateInput = document.getElementById("dateInput");
const passengersInput = document.getElementById("passengersInput");

const PAGE_SIZE = 8;
let allFlights = [];
let lastFlightDoc = null;
let hasMoreFirebase = false;
let loading = false;
let dataMode = "demo";
let firebaseDateMode = null; // timestamp | string | scan

const today = new Date().toISOString().slice(0, 10);
dateInput.min = today;
dateInput.value = today;

fromInput.addEventListener("input", debounce(renderFlights, 180));
toInput.addEventListener("input", debounce(renderFlights, 180));
[airlineFilter, classFilter, stopsFilter, sortSelect].forEach(el => el.addEventListener("change", renderFlights));
dateInput.addEventListener("change", loadFlights);

document.getElementById("swapBtn").addEventListener("click", () => {
  [fromInput.value, toInput.value] = [toInput.value, fromInput.value];
  renderFlights();
});

document.getElementById("flightSearchForm").addEventListener("submit", e => {
  e.preventDefault();
  renderFlights();
  document.querySelector(".catalog-section")?.scrollIntoView({ behavior: "smooth" });
});

document.getElementById("clearFilters").addEventListener("click", () => {
  fromInput.value = "";
  toInput.value = "";
  dateInput.value = today;
  airlineFilter.value = "";
  classFilter.value = "";
  stopsFilter.value = "";
  sortSelect.value = "priceAsc";
  loadFlights();
});

loadMoreBtn.addEventListener("click", () => loadFlights(true));

document.querySelectorAll(".popular-route").forEach(button => button.addEventListener("click", () => {
  fromInput.value = button.dataset.from || "";
  toInput.value = button.dataset.to || "";
  renderFlights();
  document.querySelector(".catalog-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
}));

async function loadFlights(loadNextPage = false) {
  if (loading) return;
  loading = true;

  if (!loadNextPage) {
    lastFlightDoc = null;
    hasMoreFirebase = false;
    firebaseDateMode = null;
    allFlights = [];
    grid.innerHTML = '<div class="loading"><span class="loader"></span><br>Ищем подходящие рейсы...</div>';
  } else {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "Загружаем...";
  }

  const selectedDate = dateInput.value || today;
  const demoFlights = makeDemoFlights(selectedDate).map(f => ({ ...f, source: "demo" }));

  try {
    const result = await loadFirestorePage(selectedDate, loadNextPage);
    const page = result.page;

    if (result.mode) firebaseDateMode = result.mode;
    hasMoreFirebase = result.hasMore;

    // Firebase остаётся основным источником, но демо-рейсы гарантируют,
    // что каталог не будет пустым, если администратор ещё не добавил данные.
    const firebaseFlights = page.map(d => ({ ...d, source: "firebase" }));
    const existingFirebase = allFlights.filter(f => f.source === "firebase");
    const existingDemo = allFlights.filter(f => f.source === "demo");
    allFlights = [...existingFirebase, ...firebaseFlights, ...(loadNextPage ? existingDemo : demoFlights)];

    dataMode = firebaseFlights.length || existingFirebase.length ? "Firebase + демо" : "Демо-варианты";
  } catch (error) {
    console.warn("Не удалось получить рейсы из Firestore, включаем демонстрационные данные.", error);
    if (!loadNextPage) allFlights = demoFlights;
    hasMoreFirebase = false;
    dataMode = "Демо-варианты";
  } finally {
    loading = false;
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = "Показать ещё";
  }

  renderFilters();
  renderFlights();
}

async function loadFirestorePage(selectedDate, loadNextPage) {
  const start = new Date(`${selectedDate}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  // 1. Поддержка рекомендуемого типа Firestore Timestamp.
  if (!loadNextPage || firebaseDateMode === "timestamp") {
    try {
      const parts = [
        collection(db, "flights"),
        where("departureDate", ">=", Timestamp.fromDate(start)),
        where("departureDate", "<", Timestamp.fromDate(end)),
        orderBy("departureDate", "asc"),
        limit(PAGE_SIZE)
      ];
      if (lastFlightDoc) parts.push(startAfter(lastFlightDoc));
      const snap = await getDocs(query(...parts));
      if (snap.size || loadNextPage) {
        lastFlightDoc = snap.docs.at(-1) || lastFlightDoc;
        return { page: snap.docs.map(d => ({ id: d.id, ...d.data() })), hasMore: snap.size === PAGE_SIZE, mode: "timestamp" };
      }
    } catch (error) {
      console.warn("Timestamp-запрос не сработал. Проверяем строковый формат даты.", error);
      if (loadNextPage && firebaseDateMode === "timestamp") throw error;
    }
  }

  // 2. Старые/ручные записи проекта часто содержат дату строкой YYYY-MM-DD.
  if (!loadNextPage || firebaseDateMode === "string") {
    try {
      const parts = [
        collection(db, "flights"),
        where("departureDate", "==", selectedDate),
        limit(PAGE_SIZE)
      ];
      if (lastFlightDoc && firebaseDateMode === "string") parts.push(startAfter(lastFlightDoc));
      const snap = await getDocs(query(...parts));
      if (snap.size || loadNextPage) {
        lastFlightDoc = snap.docs.at(-1) || lastFlightDoc;
        return { page: snap.docs.map(d => ({ id: d.id, ...d.data() })), hasMore: snap.size === PAGE_SIZE, mode: "string" };
      }
    } catch (error) {
      console.warn("Строковый запрос даты не сработал.", error);
      if (loadNextPage && firebaseDateMode === "string") throw error;
    }
  }

  // 3. Последний fallback: читаем ограниченный объём и фильтруем дату на клиенте.
  // Это позволяет работать даже с уже существующими документами, где дата
  // записана в нестандартном формате. Основная пагинация при этом сохраняется.
  const scanSnap = await getDocs(query(collection(db, "flights"), limit(50)));
  const page = scanSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(f => sameDate(f.departureDate, selectedDate));
  return { page: page.slice(0, PAGE_SIZE), hasMore: false, mode: "scan" };
}

function renderFilters() {
  const names = [...new Set(allFlights.map(x => x.airline).filter(Boolean))].sort();
  const current = airlineFilter.value;
  airlineFilter.innerHTML = '<option value="">Все авиакомпании</option>' + names.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  if (names.includes(current)) airlineFilter.value = current;
}

function filtered() {
  const from = normalizePlace(fromInput.value);
  const to = normalizePlace(toInput.value);
  const date = dateInput.value;
  const passengers = Number(passengersInput.value || 1);

  let list = allFlights.filter(f => {
    const fromText = `${f.fromCity || ""} ${f.from || ""}`.toLowerCase();
    const toText = `${f.toCity || ""} ${f.to || ""}`.toLowerCase();
    return (!from || fromText.includes(from)) &&
      (!to || toText.includes(to)) &&
      (!date || sameDate(f.departureDate, date)) &&
      Number(f.seats ?? 99) >= passengers &&
      (!airlineFilter.value || f.airline === airlineFilter.value) &&
      (!classFilter.value || (f.class || "Economy") === classFilter.value) &&
      (!stopsFilter.value || String(f.stops ?? 0) === stopsFilter.value);
  });

  if (!list.length && (from || to)) {
    const generated = makeGeneratedSearchFlights(fromInput.value.trim(), toInput.value.trim(), date || today, passengers);
    if (generated.length) list = generated;
  }

  const sort = sortSelect.value;
  list.sort((a, b) => sort === "priceDesc"
    ? Number(b.price || 0) - Number(a.price || 0)
    : sort === "dateAsc"
      ? dateValue(a.departureDate) - dateValue(b.departureDate)
      : Number(a.price || 0) - Number(b.price || 0));
  return list;
}

function renderFlights() {
  const list = filtered();
  countEl.textContent = list.length ? `${list.length} ${plural(list.length, "рейс", "рейса", "рейсов")}` : "Ничего не найдено";

  if (!list.length) {
    grid.innerHTML = `<div class="empty search-empty"><div class="empty-icon">✈</div><h3>Рейсы не найдены</h3><p>Попробуйте изменить город, дату или фильтры.</p><button class="secondary-btn" id="resetSearch">Сбросить поиск</button></div>`;
    document.getElementById("resetSearch")?.addEventListener("click", () => document.getElementById("clearFilters").click());
  } else {
    grid.innerHTML = list.map(card).join("");
  }

  loadMoreBtn.classList.toggle("hidden", !hasMoreFirebase);
  const modeLabel = document.getElementById("dataMode");
  if (modeLabel) modeLabel.textContent = dataMode;
}

function card(f) {
  const stops = Number(f.stops || 0) === 0 ? "Прямой" : `${f.stops} ${plural(Number(f.stops), "пересадка", "пересадки", "пересадок")}`;
  const demo = f.source === "demo" || f.source === "generated" || String(f.id).startsWith("demo-") || String(f.id).startsWith("generated-");
  return `<article class="flight-card">
    <div class="flight-top"><div class="airline-block"><div class="airline">${esc(f.airline || "AirWay Airlines")}</div><div class="flight-no">${esc(f.flightNumber || "AW-000")}</div></div><div class="price-block"><div class="price">${formatPrice(f.price)}</div><small>за пассажира</small></div></div>
    <div class="route"><div><div class="flight-time">${esc(f.departureTime || "—")}</div><div class="airport-code">${esc(f.from || "ALA")}</div><div class="city">${esc(f.fromCity || "Алматы")}</div></div><div class="route-center"><span>${esc(f.duration || "—")}</span><div class="route-line"></div><small>${stops}</small></div><div class="route-destination"><div class="flight-time">${esc(f.arrivalTime || "—")}</div><div class="airport-code">${esc(f.to || "DXB")}</div><div class="city">${esc(f.toCity || "Дубай")}</div></div></div>
    <div class="flight-meta"><span class="chip">${formatDate(f.departureDate)}</span><span class="chip">${esc(f.class === "Business" ? "Бизнес" : "Эконом")}</span><span class="chip">Багаж ${esc(f.baggage || "20 кг")}</span><span class="chip seats-chip">${Number(f.seats ?? 0)} мест</span></div>
    ${demo ? `<div class="demo-note">${f.source === "generated" ? "Вариант по вашему запросу · учебные данные" : "Демо-рейс · можно использовать для тестирования бронирования"}</div>` : ''}
    <div class="flight-actions"><a href="flight.html?id=${encodeURIComponent(f.id)}">Подробнее →</a><button class="mini-btn" data-flight="${esc(f.id)}">Выбрать</button></div>
  </article>`;
}

grid.addEventListener("click", e => {
  const button = e.target.closest("[data-flight]");
  if (!button) return;
  const flightId = button.dataset.flight;
  const selected = allFlights.find(f => String(f.id) === String(flightId));
  if (selected && String(selected.id).startsWith("generated-")) {
    try { sessionStorage.setItem(`airway:generated:${selected.id}`, JSON.stringify(selected)); }
    catch (error) { console.warn("Не удалось сохранить сгенерированный рейс.", error); }
  }
  location.href = `flight.html?id=${encodeURIComponent(flightId)}`;
});

function makeGeneratedSearchFlights(from, to, date, passengers) {
  if (!from || !to) return [];
  const fromCity = prettyCity(from, "Алматы");
  const toCity = prettyCity(to, "Дубай");
  const fromCode = airportCode(fromCity, "ALA");
  const toCode = airportCode(toCity, "DXB");

  const matching = routeTemplates.filter(t =>
    placeMatches(t.from, t.fromCity, from, fromCity) &&
    placeMatches(t.to, t.toCity, to, toCity)
  );

  if (matching.length) {
    return matching.slice(0, 4).map((t, index) => ({
      ...t,
      id: `generated-${date}-${fromCode}-${toCode}-${index + 1}`,
      source: "generated",
      departureDate: date,
      seats: Math.max(passengers, 8 + index * 4),
      totalSeats: Math.max(passengers, 20 + index * 4),
      status: "available",
      description: `Вариант маршрута ${t.fromCity} — ${t.toCity}. Данные подготовлены для демонстрации поиска.`
    }));
  }

  const base = Math.max(45000, 62000 + toCity.length * 1700 + fromCity.length * 600);
  const variants = [
    { airline: "AirWay Partner", flightNumber: "AW-101", departureTime: "08:40", arrivalTime: "13:05", duration: "4ч 25м", price: base, stops: 0, baggage: "20 кг" },
    { airline: "Skyline Airways", flightNumber: "SK-214", departureTime: "13:15", arrivalTime: "17:55", duration: "4ч 40м", price: base + 11500, stops: 0, baggage: "23 кг" },
    { airline: "Global Air", flightNumber: "GA-318", departureTime: "19:30", arrivalTime: "00:20", duration: "4ч 50м", price: base - 6500, stops: 1, baggage: "20 кг" }
  ];

  return variants.map((v, index) => ({
    id: `generated-${date}-${fromCode}-${toCode}-${index + 1}`,
    source: "generated",
    ...v,
    from: fromCode,
    fromCity,
    to: toCode,
    toCity,
    departureDate: date,
    seats: Math.max(passengers, 10 + index * 5),
    totalSeats: 25 + index * 5,
    class: index === 1 ? "Business" : "Economy",
    status: "available",
    description: "Демонстрационный вариант по вашему запросу. Не является данными реального расписания."
  }));
}

function placeMatches(code, city, query, normalizedCity) {
  const q = normalizePlace(query);
  return q === normalizePlace(code) ||
    q === normalizePlace(city) ||
    normalizePlace(city).includes(q) ||
    normalizePlace(q).includes(normalizePlace(city)) ||
    normalizePlace(normalizedCity) === normalizePlace(city);
}
function normalizePlace(value) { return String(value || "").toLowerCase().replace(/\s*\([^)]*\)\s*/g, " ").trim(); }
function prettyCity(value, fallback) { value = String(value || "").replace(/\s*\([^)]*\)\s*$/, "").trim(); const aliases = { "алматы":"Алматы", "астана":"Астана", "дубай":"Дубай", "стамбул":"Стамбул", "ташкент":"Ташкент", "москва":"Москва", "лондон":"Лондон", "сеул":"Сеул", "пекин":"Пекин", "дoxa":"Доха", "доха":"Доха" }; return aliases[value.toLowerCase()] || value || fallback; }
function airportCode(city, fallback) { const map = { "Алматы":"ALA", "Астана":"NQZ", "Дубай":"DXB", "Стамбул":"IST", "Ташкент":"TAS", "Москва":"MOW", "Лондон":"LHR", "Сеул":"ICN", "Пекин":"PEK", "Доха":"DOH" }; return map[city] || fallback; }
function sameDate(value, target) { return dateKey(value) === target; }
function dateValue(value) { const d = value?.toDate ? value.toDate() : new Date(value || 0); return d.getTime(); }
function plural(n, one, few, many) { const x = Math.abs(n) % 100; const y = x % 10; return x > 10 && x < 20 ? many : y === 1 ? one : y >= 2 && y <= 4 ? few : many; }
function debounce(fn, wait) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#039;"}[m])); }

loadFlights();
