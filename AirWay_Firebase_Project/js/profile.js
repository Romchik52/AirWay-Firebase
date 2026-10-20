import {
  db, auth, doc, getDoc, setDoc, updateProfile, getCurrentUser, initials,
  getCountFromServer, collection, query, where, formatDate, showToast, renderHeader,
  signOut, sendPasswordResetEmail, serverTimestamp
} from "./firebase.js";

renderHeader("profile");
const root = document.getElementById("profileContent");
const user = await getCurrentUser();

if (!user) {
  root.innerHTML = '<div class="empty"><div class="empty-icon">👤</div><h3>Войдите в аккаунт</h3><p>Здесь будут ваши данные и настройки.</p><a class="primary-btn inline-btn" href="login.html?redirect=profile.html">Войти</a></div>';
} else {
  await renderProfile(user);
}

async function renderProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  const p = snap.exists() ? snap.data() : {};
  let bookingCount = 0;
  let confirmedCount = 0;
  try {
    bookingCount = (await getCountFromServer(query(collection(db, "bookings"), where("userId", "==", user.uid)))).data().count;
    confirmedCount = (await getCountFromServer(query(collection(db, "bookings"), where("userId", "==", user.uid), where("status", "==", "confirmed")))).data().count;
  } catch {}

  const displayName = p.name || user.displayName || "Пользователь";
  const role = p.role === "admin" ? "Администратор" : "Пассажир";
  const created = p.createdAt ? formatDate(p.createdAt) : "Аккаунт активен";

  root.innerHTML = `<div class="profile-cover">
    <div class="profile-head"><div class="profile-big-avatar">${initials(displayName)}</div><div><span class="eyebrow dark">AIRWAY ACCOUNT</span><h2>${esc(displayName)}</h2><p class="muted">${esc(user.email || "")} · ${esc(role)}</p></div></div>
    <div class="profile-stats">
      <div><strong>${bookingCount}</strong><span>Бронирований</span></div>
      <div><strong>${confirmedCount}</strong><span>Подтверждено</span></div>
      <div><strong>${esc(role)}</strong><span>Роль аккаунта</span></div>
    </div>
  </div>
  <form id="profileForm" class="profile-form">
    <div class="profile-section-title"><h3>Личные данные</h3><span>Эти данные используются для вашего аккаунта и могут быть изменены в любой момент.</span></div>
    <div class="profile-form-grid">
      <label class="field"><span>Имя</span><input id="name" value="${esc(displayName)}" required minlength="2" autocomplete="name"></label>
      <label class="field"><span>Email</span><input value="${esc(user.email || "")}" disabled autocomplete="email"></label>
      <label class="field"><span>Телефон</span><input id="phone" value="${esc(p.phone || "")}" placeholder="+7 700 000 00 00" autocomplete="tel"></label>
    </div>
    <button id="saveProfile" class="primary-btn" type="submit">Сохранить изменения →</button>
  </form>
  <div class="profile-info-grid">
    <div class="profile-info-card"><span class="eyebrow dark">TRAVEL PROFILE</span><h3>Данные пассажира</h3><p>Имя и телефон профиля используются как удобная информация аккаунта. Перед покупкой билета данные каждого пассажира заполняются отдельно.</p><div class="profile-meta"><span>Дата регистрации</span><strong>${esc(created)}</strong></div></div>
    <div class="profile-info-card"><span class="eyebrow dark">SECURITY</span><h3>Firebase Authentication</h3><p>Пароль не хранится в профиле AirWay. Для смены пароля мы отправляем защищённую ссылку на ваш Email.</p><button id="resetPassword" class="outline-btn profile-action-btn" type="button">Сменить пароль по Email</button></div>
  </div>
  <div class="profile-section danger-section"><div><h3>Сессия</h3><p>Выйдите из аккаунта на этом устройстве.</p></div><button id="logoutProfile" class="outline-btn" type="button">Выйти</button></div>`;

  document.getElementById("profileForm").onsubmit = async e => {
    e.preventDefault();
    const button = document.getElementById("saveProfile");
    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.trim();
    if (name.length < 2) return showToast("Имя должно содержать минимум 2 символа.", "error");
    button.disabled = true;
    button.textContent = "Сохраняем...";
    try {
      await setDoc(doc(db, "users", user.uid), { name, email: user.email || "", phone, updatedAt: serverTimestamp() }, { merge: true });
      await updateProfile(user, { displayName: name });
      showToast("Профиль сохранён.");
      await renderProfile(user);
    } catch (e2) {
      console.error(e2);
      showToast("Не удалось сохранить профиль. Проверьте Firestore.", "error");
      button.disabled = false;
      button.textContent = "Сохранить изменения →";
    }
  };

  document.getElementById("resetPassword").onclick = async () => {
    if (!user.email) return showToast("У аккаунта не указан Email.", "error");
    const button = document.getElementById("resetPassword");
    button.disabled = true;
    button.textContent = "Отправляем...";
    try {
      await sendPasswordResetEmail(auth, user.email);
      showToast(`Письмо для смены пароля отправлено на ${user.email}.`);
    } catch (e) {
      console.error(e);
      showToast("Не удалось отправить письмо. Попробуйте ещё раз.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Сменить пароль по Email";
    }
  };

  document.getElementById("logoutProfile").onclick = async () => {
    try { await signOut(auth); location.href = "index.html"; }
    catch { showToast("Не удалось завершить сессию.", "error"); }
  };
}

function esc(v) { return String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
