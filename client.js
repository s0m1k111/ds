const socket = io();
let currentUser = null;
let currentRoom = "general";
let allMessages = {};
let unreadCounts = {};
let currentOnlineList = [];

// --- УВЕДОМЛЕНИЯ ---
const notificationSound = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
notificationSound.volume = 0.5;

const getPrivateRoomId = (u1, u2) => [u1, u2].sort().join("_");
const isImageUrl = (url) => /\.(jpg|jpeg|png|webp|gif)$/.test(url) || url.startsWith("https://images.unsplash.com");

// Применяем настройки темы и фона сразу
const savedTheme = localStorage.getItem("theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);
const savedBg = localStorage.getItem("chat-bg");
if (savedBg) document.documentElement.style.setProperty("--chat-bg-img", `url('${savedBg}')`);

function transitionTo(hide, show) {
  const h = document.getElementById(hide),
    s = document.getElementById(show);
  if (!h || !s) return;
  h.style.opacity = "0";
  setTimeout(() => {
    h.classList.add("hidden");
    s.classList.remove("hidden");
    setTimeout(() => (s.style.opacity = "1"), 50);
  }, 800);
}

// 1. Отрисовка сообщения
function renderMessage(msg) {
  if (msg.room !== currentRoom) return;
  const container = document.getElementById("messages-container");
  const isMine = currentUser && msg.user === currentUser.username;
  const avatarSrc = msg.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png";

  let content = isImageUrl(msg.text)
    ? `<img src="${msg.text}" class="chat-img" onclick="window.open('${msg.text}')" style="max-width:250px; border-radius:10px; cursor:pointer;">`
    : `<div class="msg-text">${msg.text}</div>`;

  const div = document.createElement("div");
  div.className = `message-wrapper ${isMine ? "mine" : ""}`;
  div.innerHTML = `
        <img src="${avatarSrc}" class="msg-avatar" data-user="${msg.user}" style="${
    isMine ? "order:2; margin-left:10px; margin-right:0;" : "margin-right:10px;"
  }">
        <div class="message-bubble">
            <div class="msg-author" style="font-size:0.7rem; font-weight:bold; color:var(--neon-blue)">${msg.user}</div>
            ${content}
            <div style="font-size:0.55rem; opacity:0.4; text-align:right; margin-top:5px">${msg.time}</div>
        </div>
    `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// 2. Уведомления (бейджи)
function updateUnreadUI(room) {
  const targetId = room.includes("_") ? room.split("_").find((u) => u !== currentUser?.username) : room;
  const item = document.querySelector(`[data-id="${targetId}"]`);
  if (!item) return;

  let badge = item.querySelector(".unread-badge");
  const count = unreadCounts[room] || 0;

  if (count > 0 && room !== currentRoom) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "unread-badge";
      item.appendChild(badge);
    }
    badge.innerText = count;
  } else if (badge) {
    badge.remove();
  }
}

// 3. Переключение комнат
window.switchRoom = (target) => {
  const isPrivate = !["general", "spam"].includes(target);
  const newRoom = isPrivate ? getPrivateRoomId(currentUser.username, target) : target;

  if (newRoom === currentRoom) return;

  socket.emit("join room", { oldRoom: currentRoom, newRoom: newRoom });
  currentRoom = newRoom;
  unreadCounts[currentRoom] = 0;
  updateUnreadUI(currentRoom);

  document.querySelector(".chat-header").innerText = isPrivate ? `👤 ${target}` : `# ${target}`;
  document.querySelectorAll(".contact-item").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-id") === target);
  });

  const container = document.getElementById("messages-container");
  container.innerHTML = "";
  if (allMessages[currentRoom]) {
    allMessages[currentRoom].forEach(renderMessage);
  }
};

// 4. Получение сообщений
socket.on("render message", (msg) => {
  if (!allMessages[msg.room]) allMessages[msg.room] = [];
  if (!allMessages[msg.room].some((m) => m.id === msg.id)) {
    allMessages[msg.room].push(msg);
  }

  const isMine = currentUser && msg.user === currentUser.username;
  if (msg.room === currentRoom) {
    renderMessage(msg);
    if (!isMine && document.hidden) notificationSound.play().catch(() => {});
  } else {
    unreadCounts[msg.room] = (unreadCounts[msg.room] || 0) + 1;
    updateUnreadUI(msg.room);
    if (!isMine) notificationSound.play().catch(() => {});
  }
});

// 5. Отправка и "Печатает..."
function send() {
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (text && currentUser) {
    socket.emit("new message", { user: currentUser.username, text: text, room: currentRoom });
    input.value = "";
    socket.emit("typing", { user: currentUser.username, room: currentRoom, isTyping: false });
  }
}

let typingTimer;
document.getElementById("msg-input")?.addEventListener("input", () => {
  if (!currentUser) return;
  socket.emit("typing", { user: currentUser.username, room: currentRoom, isTyping: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("typing", { user: currentUser.username, room: currentRoom, isTyping: false });
  }, 2000);
});

socket.on("user typing", (data) => {
  const ind = document.getElementById("typing-indicator");
  if (!ind) return;
  ind.innerText = data.isTyping && data.room === currentRoom ? `${data.user} печатает...` : "";
});

// 6. Профиль и Фон
window.toggleProfileModal = () => {
  const modal = document.getElementById("profile-modal");
  modal.classList.toggle("hidden");

  // Если модалка открыта, подставляем текущие данные
  if (currentUser && !modal.classList.contains("hidden")) {
    document.getElementById("edit-email").value = currentUser.email || "";
    document.getElementById("edit-avatar").value = currentUser.avatar || "";
    const bgInput = document.getElementById("bg-input-modal");
    if (bgInput) bgInput.value = currentUser.bg || "";
  }
};

window.changeBackground = () => {
  const bgUrl = document.getElementById("bg-input").value;
  document.documentElement.style.setProperty("--chat-bg-img", bgUrl ? `url('${bgUrl}')` : "none");
  localStorage.setItem("chat-bg", bgUrl);
};

// 7. Клики
document.addEventListener("click", (e) => {
  // Авторизация
  if (e.target.id === "auth-btn") {
    const u = document.getElementById("username").value;
    const p = document.getElementById("password").value;
    const isLogin = document.getElementById("auth-title").innerText === "Вход в систему";
    if (!u || !p) return alert("Заполни поля!");
    socket.emit(isLogin ? "login" : "register", { username: u, password: p });
  }

  // Переключение Вход/Регистрация
  if (e.target.closest("#auth-toggle")) {
    const t = document.getElementById("auth-title");
    const b = document.getElementById("auth-btn");
    const isLogin = t.innerText === "Вход в систему";
    t.innerText = isLogin ? "Регистрация" : "Вход в систему";
    b.innerText = isLogin ? "Создать" : "Войти";
  }

  // СОХРАНЕНИЕ ПРОФИЛЯ
  if (e.target.id === "save-profile-btn") {
    if (!currentUser) return;

    // Используем ПРАВИЛЬНЫЙ ID из твоего HTML: bg-input-modal
    const emailVal = document.getElementById("edit-email")?.value || "";
    const avatarVal = document.getElementById("edit-avatar")?.value || "";
    const bgVal = document.getElementById("bg-input-modal")?.value || "";

    console.log("ОТПРАВЛЯЮ НА СЕРВЕР:", { avatar: avatarVal, bg: bgVal });

    socket.emit("update profile", {
      username: currentUser.username,
      email: emailVal,
      avatar: avatarVal,
      bg: bgVal,
    });
  }

  if (e.target.id === "logout-btn") {
    if (confirm("Выйти?")) location.reload();
  }

  if (e.target.id === "send-btn") send();
});

document.addEventListener("keydown", (e) => {
  if (e.target.id === "msg-input" && e.key === "Enter") send();
});

// 8. Сокеты (Онлайн, Успех, Обновления)
socket.on("update online list", (onlineNames) => {
  currentOnlineList = onlineNames;
  document.querySelectorAll(".contact-item").forEach((item) => {
    item.classList.toggle("online", onlineNames.includes(item.getAttribute("data-id")));
  });
});

socket.on("auth success", (data) => {
  currentUser = data.user;
  allMessages = data.history || {};
  if (currentUser.bg) {
    document.documentElement.style.setProperty("--chat-bg-img", `url('${currentUser.bg}')`);
    localStorage.setItem("chat-bg", currentUser.bg);
  }
  document.getElementById("current-user-name").innerText = currentUser.username;
  if (currentUser.avatar) document.getElementById("my-avatar").src = currentUser.avatar;

  const uList = document.getElementById("users-list");
  uList.innerHTML = "";
  data.allUsers.forEach((u) => {
    if (u.username === currentUser.username) return;
    const div = document.createElement("div");
    div.className = "contact-item";
    div.setAttribute("data-id", u.username);
    if (currentOnlineList.includes(u.username)) div.classList.add("online");
    div.innerHTML = `
      <div style="position: relative; margin-right: 10px; display: flex;">
        <img src="${u.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png"}" class="contact-avatar">
        <div class="status-dot"></div>
      </div>
      <span>${u.username}</span>
    `;
    div.onclick = () => window.switchRoom(u.username);
    uList.appendChild(div);
  });
  window.switchRoom("general");
  transitionTo("auth-screen", "chat-screen");
});

socket.on("profile saved", (user) => {
  currentUser = user;

  // Обновляем аватарку в шапке
  const avatarImg = document.getElementById("my-avatar");
  if (avatarImg) avatarImg.src = user.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png";

  // ПРИМЕНЯЕМ ФОН
  if (user.bg) {
    document.documentElement.style.setProperty("--chat-bg-img", `url('${user.bg}')`);
    localStorage.setItem("chat-bg", user.bg);
  } else {
    document.documentElement.style.setProperty("--chat-bg-img", "none");
    localStorage.removeItem("chat-bg");
  }

  alert("Настройки сохранены!");
  toggleProfileModal();
});

socket.on("user updated", (data) => {
  const contactImg = document.querySelector(`.contact-item[data-id="${data.username}"] img`);
  if (contactImg) contactImg.src = data.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png";
  document.querySelectorAll(`.msg-avatar[data-user="${data.username}"]`).forEach((img) => {
    img.src = data.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png";
  });
});

socket.on("auth error", (m) => alert(m));
setTimeout(() => transitionTo("loader", "auth-screen"), 3000);
