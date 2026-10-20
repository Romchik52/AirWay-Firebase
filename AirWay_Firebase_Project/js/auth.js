import {
  auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updateProfile, doc, setDoc, serverTimestamp,
  getCurrentUser, showToast, renderHeader, authPersistence
} from "./firebase.js";

renderHeader();

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

// Если пользователь уже вошёл, не заставляем его снова вводить пароль.
const existingUser = await getCurrentUser();
const authPage = loginForm ? "login" : registerForm ? "register" : "";
if (existingUser && authPage) {
  const redirect = new URLSearchParams(location.search).get("redirect");
  location.href = redirect || "index.html";
}

loginForm?.addEventListener("submit", async e => {
  e.preventDefault();
  const button = loginForm.querySelector("button[type=submit]");
  const email = document.getElementById("email").value.trim().toLowerCase();
  const password = document.getElementById("password").value;
  if (!email || !password) return showToast("Заполните Email и пароль.", "error");

  setBusy(button, true, "Входим...");
  try {
    await authPersistence;
    await signInWithEmailAndPassword(auth, email, password);
    showToast("Вход выполнен.");
    const redirect = new URLSearchParams(location.search).get("redirect");
    setTimeout(() => location.href = safeRedirect(redirect) || "index.html", 250);
  } catch (err) {
    console.error("AirWay login error:", err);
    showAuthError(err);
  } finally {
    setBusy(button, false, "Войти");
  }
});

document.getElementById("forgotPassword")?.addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim().toLowerCase();
  if (!email) return showToast("Сначала укажите Email.", "error");
  try {
    await sendPasswordResetEmail(auth, email);
    showToast("Письмо для восстановления отправлено.");
  } catch (err) {
    console.error("AirWay reset error:", err);
    showAuthError(err);
  }
});

registerForm?.addEventListener("submit", async e => {
  e.preventDefault();
  const button = registerForm.querySelector("button[type=submit]");
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim().toLowerCase();
  const phone = document.getElementById("phone")?.value.trim() || "";
  const password = document.getElementById("password").value;
  const password2 = document.getElementById("password2")?.value;

  if (name.length < 2) return showToast("Введите имя минимум из 2 символов.", "error");
  if (password.length < 6) return showToast("Пароль должен содержать минимум 6 символов.", "error");
  if (password2 !== undefined && password !== password2) return showToast("Пароли не совпадают.", "error");

  setBusy(button, true, "Создаём аккаунт...");
  try {
    await authPersistence;
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    // merge:true позволяет восстановить профиль, даже если Auth создался,
    // а запись Firestore была прервана предыдущей попыткой.
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, phone, role: "user", updatedAt: serverTimestamp(), createdAt: serverTimestamp()
    }, { merge: true });

    showToast("Аккаунт создан.");
    setTimeout(() => location.href = "index.html", 350);
  } catch (err) {
    console.error("AirWay register error:", err);
    showAuthError(err);
  } finally {
    setBusy(button, false, "Зарегистрироваться");
  }
});

document.querySelectorAll("[data-toggle-password]").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.togglePassword);
    if (!input) return;
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    btn.textContent = visible ? "Показать" : "Скрыть";
  });
});

function setBusy(button, busy, text) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || text;
  }
}

function safeRedirect(value) {
  if (!value) return null;
  // Разрешаем только локальные страницы проекта, чтобы redirect нельзя было
  // превратить в внешний URL.
  if (/^(https?:|\/\/|javascript:)/i.test(value)) return null;
  return value.replace(/^\/+/, "");
}

function showAuthError(err) {
  showToast(authMessage(err?.code, err?.message), "error");
}

function authMessage(code, raw = "") {
  const map = {
    "auth/invalid-credential":"Неверный Email или пароль.",
    "auth/wrong-password":"Неверный пароль.",
    "auth/user-not-found":"Пользователь с таким Email не найден.",
    "auth/email-already-in-use":"Этот Email уже зарегистрирован.",
    "auth/invalid-email":"Некорректный Email.",
    "auth/weak-password":"Пароль слишком слабый. Используйте минимум 6 символов.",
    "auth/too-many-requests":"Слишком много попыток. Попробуйте позже.",
    "auth/operation-not-allowed":"В Firebase отключён вход по Email/паролю. Включите Email/Password в Authentication → Sign-in method.",
    "auth/unauthorized-domain":"Этот адрес сайта не разрешён Firebase Authentication. Добавьте текущий домен в Authentication → Settings → Authorized domains.",
    "auth/network-request-failed":"Нет соединения с Firebase. Проверьте интернет и запустите сайт через Live Server, а не через file://.",
    "auth/invalid-api-key":"Firebase API key недействителен или не соответствует проекту.",
    "auth/internal-error":"Firebase вернул внутреннюю ошибку. Откройте консоль браузера (F12) и проверьте подробности."
  };
  if (map[code]) return map[code];
  if (raw && /operation.not.allowed|OPERATION_NOT_ALLOWED/i.test(raw)) return map["auth/operation-not-allowed"];
  if (raw && /unauthorized.domain|not authorized/i.test(raw)) return map["auth/unauthorized-domain"];
  return "Не удалось выполнить операцию. Откройте F12 → Console, если ошибка повторяется.";
}
