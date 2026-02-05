const socket = io();
let currentUser = null;
let currentRoom = "general";
let allMessages = {};
let typingTimeout;
let unreadCounts = {};

const getPrivateRoomId = (u1, u2) => [u1, u2].sort().join("_");
const isImageUrl = (url) => /\.(jpg|jpeg|png|webp|gif)$/.test(url) || url.startsWith("https://images.unsplash.com");

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
  // Берем аватар из сообщения (сервер подставляет актуальный на момент отправки)
  const avatarSrc = msg.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png";

  const content = isImageUrl(msg.text)
    ? `<img src="${msg.text}" class="chat-img" style="max-width:200px; border-radius:10px; cursor:pointer" onclick="window.open('${msg.text}')">`
    : `<div class="msg-text">${msg.text}</div>`;

  const div = document.createElement("div");
  div.className = `message-wrapper ${isMine ? "mine" : ""}`;
  div.innerHTML = `
        <img src="${avatarSrc}" class="msg-avatar" style="width:35px; height:35px; border-radius:50%; object-fit:cover; ${
    isMine ? "order:2; margin-left:10px;" : "margin-right:10px;"
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

// 2. Обновление счетчиков в интерфейсе
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

  // Серверу просто сообщаем, что мы в этой комнате (для логирования/статуса)
  socket.emit("join room", { oldRoom: currentRoom, newRoom: newRoom });

  currentRoom = newRoom;
  unreadCounts[currentRoom] = 0;
  updateUnreadUI(currentRoom);

  document.querySelector(".chat-header").innerText = isPrivate ? `👤 ${target}` : `# ${target}`;
  document.querySelectorAll(".contact-item").forEach((el) => el.classList.toggle("active", el.getAttribute("data-id") === target));

  const container = document.getElementById("messages-container");
  container.innerHTML = "";
  if (allMessages[currentRoom]) {
    allMessages[currentRoom].forEach(renderMessage);
  }
};

// 4. Глобальный прием сообщений
socket.on("render message", (msg) => {
  if (!allMessages[msg.room]) allMessages[msg.room] = [];

  if (!allMessages[msg.room].some((m) => m.id === msg.id)) {
    allMessages[msg.room].push(msg);
  }

  if (msg.room === currentRoom) {
    renderMessage(msg);
  } else {
    unreadCounts[msg.room] = (unreadCounts[msg.room] || 0) + 1;
    updateUnreadUI(msg.room);
  }
});

// 5. Отправка
function send() {
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (text && currentUser) {
    socket.emit("new message", { user: currentUser.username, text: text, room: currentRoom });
    input.value = "";
    socket.emit("typing", { user: currentUser.username, room: currentRoom, isTyping: false });
  }
}

// Обработчики кликов
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "send-btn") send();

  if (e.target && e.target.id === "save-profile-btn") {
    const email = document.getElementById("edit-email").value;
    const avatar = document.getElementById("edit-avatar").value;
    const bgUrl = document.getElementById("bg-input-modal").value;
    if (bgUrl) document.documentElement.style.setProperty("--chat-bg-img", `url('${bgUrl}')`);
    socket.emit("update profile", { username: currentUser.username, email, avatar });
  }

  if (e.target && e.target.id === "logout-btn") location.reload();

  if (e.target && e.target.id === "auth-btn") {
    const u = document.getElementById("username").value,
      p = document.getElementById("password").value;
    const isLogin = document.getElementById("auth-title").innerText === "Вход в систему";
    socket.emit(isLogin ? "login" : "register", { username: u, password: p });
  }

  if (e.target && e.target.closest("#auth-toggle")) {
    const t = document.getElementById("auth-title"),
      b = document.getElementById("auth-btn");
    const isLogin = t.innerText === "Вход в систему";
    t.innerText = isLogin ? "Регистрация" : "Вход в систему";
    b.innerText = isLogin ? "Создать" : "Войти";
  }
});

document.addEventListener("keydown", (e) => {
  if (e.target && e.target.id === "msg-input" && e.key === "Enter") send();
});

// Настройки
window.toggleProfileModal = () => {
  document.getElementById("profile-modal").classList.toggle("hidden");
  if (currentUser) {
    document.getElementById("edit-email").value = currentUser.email || "";
    document.getElementById("edit-avatar").value = currentUser.avatar || "";
  }
};
window.setTheme = (t) => document.documentElement.setAttribute("data-theme", t);

// 6. События сокетов
socket.on("auth success", (data) => {
  currentUser = data.user;
  allMessages = data.history || {};
  document.getElementById("current-user-name").innerText = currentUser.username;
  if (currentUser.avatar) document.getElementById("my-avatar").src = currentUser.avatar;

  const uList = document.getElementById("users-list");
  uList.innerHTML = "";
  data.allUsers.forEach((u) => {
    if (u.username !== currentUser.username) {
      const div = document.createElement("div");
      div.className = "contact-item";
      div.setAttribute("data-id", u.username);
      div.innerHTML = `<span>👤 ${u.username}</span>`; // Обернули в span для верстки
      div.onclick = () => window.switchRoom(u.username);
      uList.appendChild(div);
    }
  });
  window.switchRoom("general");
  transitionTo("auth-screen", "chat-screen");
});

socket.on("profile saved", (user) => {
  currentUser = user;
  document.getElementById("my-avatar").src = user.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png";
  alert("Настройки сохранены!");
  toggleProfileModal();
});

// ВАЖНО: Обновление данных других пользователей (аватарки в списке)
socket.on("user updated", (data) => {
  const item = document.querySelector(`[data-id="${data.username}"]`);
  if (item) {
    item.innerHTML = `<span>👤 ${data.username}</span>`;
    // Если нужно, тут можно добавить логику смены аватара прямо в списке
  }
});

socket.on("user typing", (data) => {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) {
    indicator.innerText = data.isTyping && data.room === currentRoom ? `${data.user} печатает...` : "";
  }
});

socket.on("auth error", (m) => alert(m));
setTimeout(() => transitionTo("loader", "auth-screen"), 3000);
