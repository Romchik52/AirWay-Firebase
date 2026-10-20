import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, getCountFromServer, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, onSnapshot, serverTimestamp, increment, Timestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBweyCxucejB_kXKK8Au3lYeGZcGubKq-E",
  authDomain: "dubai3-14b59.firebaseapp.com",
  projectId: "dubai3-14b59",
  storageBucket: "dubai3-14b59.firebasestorage.app",
  messagingSenderId: "145803596539",
  appId: "1:145803596539:web:31bd3d5068a24d6ee7d65e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Явно сохраняем сессию в браузере. После перезагрузки страницы пользователь
// не должен неожиданно вылетать из аккаунта.
const authPersistence = setPersistence(auth, browserLocalPersistence).catch(() => null);

export {
  app, auth, db, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile,
  setPersistence, browserLocalPersistence, authPersistence,
  collection, doc, getDoc, getDocs, getCountFromServer, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, onSnapshot, serverTimestamp, increment, Timestamp, runTransaction
};

export function formatPrice(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0)) + " ₸";
}

export function formatDate(value) {
  if (!value) return "—";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day:"2-digit", month:"long", year:"numeric" }).format(d);
}

export function showToast(message, type = "normal") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");
  clearTimeout(window.__airwayToastTimer);
  window.__airwayToastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

export function initials(name = "User") {
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join("").toUpperCase() || "U";
}

export function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

export async function getCurrentUser() {
  await authPersistence;
  if (auth.currentUser) return auth.currentUser;
  return await new Promise(resolve => {
    let finished = false;
    const unsub = onAuthStateChanged(auth, u => {
      if (finished) return;
      finished = true;
      unsub();
      resolve(u);
    });
    // Не зависаем бесконечно, если браузер не может связаться с Firebase.
    setTimeout(() => {
      if (!finished) {
        finished = true;
        unsub();
        resolve(auth.currentUser || null);
      }
    }, 7000);
  });
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function requireAuth(redirect = "login.html") {
  const user = await getCurrentUser();
  if (!user) { location.href = redirect; return null; }
  return user;
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) { location.href = "login.html"; return null; }
  const profile = await getUserProfile(user.uid);
  if (profile?.role !== "admin") { location.href = "index.html"; return null; }
  return { user, profile };
}

export function renderHeader(active = "") {
  const header = document.getElementById("appHeader");
  if (!header) return;
  header.innerHTML = `
    <header class="site-header">
      <div class="container header-inner">
        <a class="logo" href="index.html">AIR<span>WAY</span></a>
        <button id="mobileMenuBtn" class="mobile-menu" aria-label="Открыть меню">☰</button>
        <nav id="mainNav" class="nav">
          <a data-nav="home" href="index.html"><span>Главная</span></a>
          <a data-nav="bookings" href="bookings.html"><span>Мои билеты</span></a>
          <a data-nav="cart" href="cart.html"><span>Корзина</span> <span id="headerCartCount" class="header-count hidden">0</span></a>
          <a data-nav="profile" href="profile.html"><span>Профиль</span></a>
          <a id="adminLink" href="admin.html" class="hidden"><span>Админ-панель</span></a>
        </nav>
        <div class="user-menu">
          <div id="headerUser" class="avatar">•</div>
          <button id="headerAction" class="header-action">Войти</button>
        </div>
      </div>
    </header>`;

  document.querySelector(`[data-nav="${active}"]`)?.classList.add("active");
  document.getElementById("mobileMenuBtn")?.addEventListener("click", () => {
    document.getElementById("mainNav")?.classList.toggle("mobile-open");
  });

  const action = document.getElementById("headerAction");
  onAuthStateChanged(auth, async user => {
    const avatar = document.getElementById("headerUser");
    if (!avatar || !action) return;
    if (user) {
      avatar.textContent = initials(user.displayName || user.email);
      avatar.title = user.displayName || user.email || "Пользователь";
      action.textContent = "Выйти";
      action.onclick = async () => {
        try { await signOut(auth); location.href = "index.html"; }
        catch { showToast("Не удалось выйти из аккаунта.", "error"); }
      };
      try {
        const p = await getUserProfile(user.uid);
        if (p?.role === "admin") document.getElementById("adminLink")?.classList.remove("hidden");
      } catch (e) { console.warn("Profile check failed", e); }
      loadHeaderCartCount(user.uid);
    } else {
      avatar.textContent = "•";
      action.textContent = "Войти";
      action.onclick = () => location.href = `login.html?redirect=${encodeURIComponent(location.pathname.split("/").pop() || "index.html")}`;
      document.getElementById("headerCartCount")?.classList.add("hidden");
    }
  });
  renderFooter();
}

export function renderFooter() {
  let footer = document.getElementById("appFooter");
  if (!footer) {
    footer = document.createElement("div");
    footer.id = "appFooter";
    document.body.appendChild(footer);
  }
  footer.innerHTML = `
    <footer class="site-footer">
      <div class="footer-glow"></div>
      <div class="container">
        <div class="footer-route-card">
          <div class="footer-route-copy">
            <span class="eyebrow">AIRWAY / CONTACT CENTER</span>
            <h2>Следующая точка — <span>там, где вам нужно.</span></h2>
            <p>Поможем подобрать маршрут, разобраться с бронированием и подготовиться к путешествию.</p>
          </div>
          <div class="footer-route-visual" aria-hidden="true">
            <div class="route-node node-a">ALA</div><div class="route-track"></div><div class="route-plane">✈</div><div class="route-node node-b">ANYWHERE</div>
          </div>
        </div>

        <div class="footer-grid">
          <div class="footer-brand">
            <a class="logo footer-logo" href="index.html">AIR<span>WAY</span></a>
            <p>Цифровой сервис для поиска, выбора и бронирования авиабилетов.</p>
            <div class="footer-badge">AW · TRAVEL SYSTEM</div>
          </div>
          <div class="footer-column"><span class="footer-title">Связь</span><a href="tel:+77270000000">+7 (727) 000-00-00</a><a href="mailto:hello@airway.kz">hello@airway.kz</a><span>Ежедневно · 09:00–22:00</span></div>
          <div class="footer-column"><span class="footer-title">Офис</span><span>Казахстан, Алматы</span><span>ул. Жарокова, 41</span><span>Рабочие часы · 09:00–18:00</span></div>
          <div class="footer-column"><span class="footer-title">AirWay</span><a href="index.html">Поиск рейсов</a><a href="bookings.html">Мои билеты</a><a href="profile.html">Профиль</a></div>
        </div>

        <div class="footer-bottom"><span>© 2026 AirWay. Учебный проект.</span><span>Безопасность · Конфиденциальность · Поддержка</span></div>
      </div>
    </footer>`;
}

function loadHeaderCartCount(uid) {
  const counter = document.getElementById("headerCartCount");
  if (!counter) return;
  try {
    if (window.__airwayCartUnsub) window.__airwayCartUnsub();
    window.__airwayCartUnsub = onSnapshot(
      query(collection(db, "cart"), where("userId", "==", uid)),
      snap => {
        const count = snap.docs.reduce((sum, d) => sum + Math.max(1, Number(d.data().quantity || 1)), 0);
        counter.textContent = count;
        counter.classList.toggle("hidden", count === 0);
      },
      () => counter.classList.add("hidden")
    );
  } catch { counter.classList.add("hidden"); }
}
