const socket = io();
let currentUser = null;
let currentRoom = "general";
let allMessages = {};
let typingTimeout;
let unreadCounts = {};

// 1. Вспомогательные функции
function getPrivateRoomId(u1, u2) {
  return [u1, u2].sort().join("_");
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|webp|gif)$/.test(url) || url.startsWith("https://images.unsplash.com");
}

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

// 2. Отрисовка сообщения на экране
function renderMessage(msg) {
  // Рисуем, только если комната совпадает с открытой
  if (msg.room !== currentRoom) return;

  const container = document.getElementById("messages-container");
  const isMine = currentUser && msg.user === currentUser.username;

  let content = isImageUrl(msg.text)
    ? `<img src="${msg.text}" class="chat-img" onclick="window.open('${msg.text}')">`
    : `<div class="msg-text">${msg.text}</div>`;

  const div = document.createElement("div");
  div.className = `message-wrapper ${isMine ? "mine" : ""}`;
  div.innerHTML = `
        <div class="message-bubble">
            <div class="msg-author" style="font-size:0.7rem; font-weight:bold; color:var(--neon-blue)">${msg.user}</div>
            ${content}
            <div style="font-size:0.55rem; opacity:0.4; text-align:right; margin-top:5px">${msg.time}</div>
        </div>
    `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// 3. Обновление значка непрочитанных (справа от ника/канала)
function updateUnreadUI(room) {
  const targetId = room.includes("_") ? room.split("_").find((u) => u !== currentUser?.username) : room;
  const item = document.querySelector(`[data-id="${targetId}"]`);
  if (!item) return;

  let badge = item.querySelector(".unread-badge");
  // Показываем бейдж только если есть сообщения И мы не в этой комнате
  if (unreadCounts[room] > 0 && room !== currentRoom) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "unread-badge";
      item.appendChild(badge);
    }
    badge.innerText = unreadCounts[room];
  } else if (badge) {
    badge.remove();
  }
}

// 4. Смена комнаты
window.switchRoom = (target, isPrivate = false) => {
  const newRoom = isPrivate ? getPrivateRoomId(currentUser.username, target) : target;

  // Выходим из старой и входим в новую
  socket.emit("join room", { oldRoom: currentRoom, newRoom: newRoom });

  currentRoom = newRoom;
  unreadCounts[currentRoom] = 0; // Обнуляем уведомления
  updateUnreadUI(currentRoom);

  document.querySelector(".chat-header").innerText = isPrivate ? `👤 ${target}` : `# ${target}`;
  document.getElementById("typing-indicator").innerText = "";

  document.querySelectorAll(".contact-item").forEach((el) => {
    el.classList.remove("active");
    if (el.getAttribute("data-id") === target) el.classList.add("active");
  });

  const container = document.getElementById("messages-container");
  container.innerHTML = "";

  // Отрисовываем историю из кэша браузера
  if (allMessages[currentRoom]) {
    allMessages[currentRoom].forEach((m) => renderMessage(m));
  }
};

// 5. Обработка событий сокета
socket.on("auth success", (data) => {
  currentUser = data.user;
  allMessages = data.history || {};
  document.getElementById("current-user-name").innerText = currentUser.username;

  const uList = document.getElementById("users-list");
  uList.innerHTML = "";
  data.allUsers.forEach((u) => {
    if (u !== currentUser.username) {
      const div = document.createElement("div");
      div.className = "contact-item";
      div.setAttribute("data-id", u);
      div.innerText = `👤 ${u}`;
      div.onclick = () => window.switchRoom(u, true);
      uList.appendChild(div);
    }
  });

  window.switchRoom("general");
  transitionTo("auth-screen", "chat-screen");
});

socket.on("render message", (msg) => {
  // 1. Сохраняем в кэш (чтобы сообщения не пропадали при переключении чатов)
  if (!allMessages[msg.room]) allMessages[msg.room] = [];
  if (!allMessages[msg.room].some((m) => m.id === msg.id)) {
    allMessages[msg.room].push(msg);
  }

  // 2. Если мы сейчас в этом чате — рисуем
  if (msg.room === currentRoom) {
    renderMessage(msg);
  } else {
    // 3. Если в другом — копим уведомления
    unreadCounts[msg.room] = (unreadCounts[msg.room] || 0) + 1;
    updateUnreadUI(msg.room);
  }
});

// 6. Отправка и индикация печати
function send() {
  const input = document.getElementById("msg-input");
  if (input.value.trim() && currentUser) {
    socket.emit("new message", {
      user: currentUser.username,
      text: input.value.trim(),
      room: currentRoom,
    });
    input.value = "";
    socket.emit("typing", { user: currentUser.username, room: currentRoom, isTyping: false });
  }
}

document.getElementById("msg-input").addEventListener("input", () => {
  socket.emit("typing", { user: currentUser.username, room: currentRoom, isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("typing", { user: currentUser.username, room: currentRoom, isTyping: false });
  }, 2000);
});

socket.on("user typing", (data) => {
  const ind = document.getElementById("typing-indicator");
  if (data.isTyping && data.room === currentRoom) {
    ind.innerText = `${data.user} печатает...`;
  } else if (data.room === currentRoom) {
    ind.innerText = "";
  }
});

// 7. Настройки и кнопки
window.setTheme = (t) => document.documentElement.setAttribute("data-theme", t);
window.changeBackground = () => {
  const url = document.getElementById("bg-input").value;
  if (url) document.documentElement.style.setProperty("--chat-bg-img", `url('${url}')`);
};

document.getElementById("send-btn").onclick = send;
document.getElementById("msg-input").onkeydown = (e) => {
  if (e.key === "Enter") send();
};
document.getElementById("logout-btn").onclick = () => location.reload();

document.getElementById("auth-btn").onclick = () => {
  const u = document.getElementById("username").value,
    p = document.getElementById("password").value;
  const isL = document.getElementById("auth-title").innerText === "Вход в систему";
  if (!u || !p) return alert("Заполни поля!");
  socket.emit(isL ? "login" : "register", { username: u, password: p });
};

document.getElementById("auth-toggle").onclick = () => {
  const t = document.getElementById("auth-title"),
    b = document.getElementById("auth-btn");
  const isL = t.innerText === "Вход в систему";
  t.innerText = isL ? "Регистрация" : "Вход в систему";
  b.innerText = isL ? "Создать" : "Войти";
};

socket.on("auth error", (m) => alert(m));
setTimeout(() => transitionTo("loader", "auth-screen"), 3000);
