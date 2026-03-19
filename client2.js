const socket = io();
let currentUser = null;
let currentRoom = "general";
let allMessages = {};
let unreadCounts = {};
let currentOnlineList = [];
let friends = [];
let friendRequests = [];

// --- УВЕДОМЛЕНИЯ ---
const notificationSound = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
notificationSound.volume = 0.5;

const getPrivateRoomId = (u1, u2) => [u1, u2].sort().join("_");
const isImageUrl = (url) => /\.(jpg|jpeg|png|webp|gif)$/.test(url) || url.startsWith("https://images.unsplash.com");

// ТЕМА / ФОН
const savedTheme = localStorage.getItem("theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);
const savedBg = localStorage.getItem("chat-bg");
if (savedBg) document.documentElement.style.setProperty("--chat-bg-img", `url('${savedBg}')`);

window.setTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
};

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

// ================== UI ДОПОЛНЕНИЯ ==================

// создаём кнопку прикрепления файла и input
const inputContainer = document.querySelector(".input-container");
let fileInput = null;
if (inputContainer) {
  const attachBtn = document.createElement("button");
  attachBtn.textContent = "📎";
  attachBtn.style.padding = "0 10px";
  attachBtn.title = "Прикрепить изображение";
  attachBtn.onclick = () => fileInput?.click();

  fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", handleFileSelected);

  inputContainer.insertBefore(attachBtn, document.getElementById("msg-input"));
  inputContainer.appendChild(fileInput);
}

// кнопка звонка в хедере (для приватных чатов)
const chatHeader = document.querySelector(".chat-header");
let callBtn = null;
if (chatHeader) {
  callBtn = document.createElement("button");
  callBtn.className = "call-btn";
  callBtn.textContent = "📞";
  callBtn.style.display = "none";
  callBtn.title = "Голосовой чат";
  callBtn.onclick = toggleVoiceRoom;
  chatHeader.appendChild(callBtn);
}

// ================== РЕНДЕР СООБЩЕНИЙ ==================

function renderMessage(msg) {
  if (msg.room !== currentRoom) return;
  const container = document.getElementById("messages-container");
  const isMine = currentUser && msg.user === currentUser.username;
  const avatarSrc = msg.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png";

  let content;
  if (msg.type === "image" || isImageUrl(msg.text)) {
    content = `<img src="${msg.text}" class="chat-img" onclick="window.open('${msg.text}')" />`;
  } else {
    content = `<div class="msg-text">${msg.text}</div>`;
  }

  const div = document.createElement("div");
  div.className = `message-wrapper ${isMine ? "mine" : ""}`;
  div.dataset.id = msg.id;
  div.dataset.room = msg.room;

  const editDeleteControls = isMine
    ? `
      <div style="position:absolute; top:5px; right:5px; font-size:0.7rem; display:flex; gap:5px;">
        <span class="msg-edit" style="cursor:pointer;">✏️</span>
        <span class="msg-delete" style="cursor:pointer;">🗑</span>
      </div>
    `
    : "";

  const editedMark = msg.edited ? `<span style="font-size:0.6rem; opacity:0.6; margin-left:5px;">(изменено)</span>` : "";

  div.innerHTML = `
    <img src="${avatarSrc}" class="msg-avatar" data-user="${msg.user}" style="${
    isMine ? "order:2; margin-left:10px; margin-right:0;" : "margin-right:10px;"
  }">
    <div class="message-bubble" style="position:relative;">
      ${editDeleteControls}
      <div class="msg-author" style="font-size:0.7rem; font-weight:bold; color:var(--neon-blue)">
        ${msg.user}${editedMark}
      </div>
      ${content}
      <div style="font-size:0.55rem; opacity:0.4; text-align:right; margin-top:5px">${msg.time}</div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Уведомления (бейджи)
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

// Переключение комнат
window.switchRoom = (target) => {
  const isPrivate = !["general", "spam"].includes(target);
  const newRoom = isPrivate ? getPrivateRoomId(currentUser.username, target) : target;

  if (newRoom === currentRoom) return;

  socket.emit("join room", { oldRoom: currentRoom, newRoom: newRoom });
  currentRoom = newRoom;
  unreadCounts[currentRoom] = 0;
  updateUnreadUI(currentRoom);

  document.querySelector(".chat-header").innerText = isPrivate ? `👤 ${target}` : `# ${target}`;
  if (isPrivate && callBtn) {
    callBtn.style.display = "inline-flex";
  } else if (callBtn) {
    callBtn.style.display = "none";
  }

  document.querySelectorAll(".contact-item").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-id") === target);
  });

  const container = document.getElementById("messages-container");
  container.innerHTML = "";
  if (allMessages[currentRoom]) {
    allMessages[currentRoom].forEach(renderMessage);
  }
};

// Получение сообщений
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

// Редактирование / удаление (события от сервера)
socket.on("message edited", ({ id, room, newText, edited }) => {
  const msgs = allMessages[room];
  if (msgs) {
    const m = msgs.find((x) => x.id === id);
    if (m) {
      m.text = newText;
      m.edited = edited;
    }
  }
  if (room === currentRoom) {
    const wrapper = document.querySelector(`.message-wrapper[data-id="${id}"]`);
    if (wrapper) {
      const textDiv = wrapper.querySelector(".msg-text");
      if (textDiv) textDiv.textContent = newText;
      const author = wrapper.querySelector(".msg-author");
      if (author && !author.innerHTML.includes("(изменено)")) {
        author.innerHTML += `<span style="font-size:0.6rem; opacity:0.6; margin-left:5px;">(изменено)</span>`;
      }
    }
  }
});

socket.on("message deleted", ({ id, room }) => {
  if (allMessages[room]) {
    allMessages[room] = allMessages[room].filter((m) => m.id !== id);
  }
  if (room === currentRoom) {
    const wrapper = document.querySelector(`.message-wrapper[data-id="${id}"]`);
    if (wrapper) wrapper.remove();
  }
});

// Отправка и "Печатает..."
function send() {
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (text && currentUser) {
    socket.emit("new message", { user: currentUser.username, text: text, room: currentRoom, type: "text" });
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

// ================== ПРИКРЕПЛЕНИЕ ИЗОБРАЖЕНИЙ ==================

function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file || !currentUser) return;
  if (!file.type.startsWith("image/")) {
    alert("Можно отправлять только изображения");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert("Файл слишком большой (максимум 5MB)");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    socket.emit("new message", {
      user: currentUser.username,
      text: dataUrl,
      room: currentRoom,
      type: "image",
    });
  };
  reader.readAsDataURL(file);
  e.target.value = "";
}

// ================== ПРОФИЛЬ / МОДАЛКА ==================

window.toggleProfileModal = () => {
  const modal = document.getElementById("profile-modal");
  modal.classList.toggle("hidden");

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

// ================== КЛИКИ ==================

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

    const emailVal = document.getElementById("edit-email")?.value || "";
    const avatarVal = document.getElementById("edit-avatar")?.value || "";
    const bgVal = document.getElementById("bg-input-modal")?.value || "";

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

  // Редактирование / удаление сообщений
  const editBtn = e.target.closest(".msg-edit");
  const delBtn = e.target.closest(".msg-delete");

  if (editBtn) {
    const wrapper = editBtn.closest(".message-wrapper");
    if (!wrapper) return;
    const id = Number(wrapper.dataset.id);
    const room = wrapper.dataset.room;
    const msgObj = (allMessages[room] || []).find((m) => m.id === id);
    if (!msgObj || msgObj.user !== currentUser.username) return;

    const newText = prompt("Изменить сообщение:", msgObj.text);
    if (newText && newText.trim() && newText !== msgObj.text) {
      socket.emit("edit message", { id, room, newText: newText.trim() });
    }
  }

  if (delBtn) {
    const wrapper = delBtn.closest(".message-wrapper");
    if (!wrapper) return;
    const id = Number(wrapper.dataset.id);
    const room = wrapper.dataset.room;
    const msgObj = (allMessages[room] || []).find((m) => m.id === id);
    if (!msgObj || msgObj.user !== currentUser.username) return;

    if (confirm("Удалить сообщение?")) {
      socket.emit("delete message", { id, room });
    }
  }

  // Добавление в друзья (по клику ПКМ или модификатору можно усложнить, но пока сделаем простую кнопку)
});

// ENTER для отправки
document.addEventListener("keydown", (e) => {
  if (e.target.id === "msg-input" && e.key === "Enter") send();
});

// ================== ДРУЗЬЯ ==================

function renderFriendsUI() {
  // можно сделать отдельный блок, но пока просто лог в консоль
  console.log("Друзья:", friends);
  console.log("Запросы в друзья:", friendRequests);
}

// Пример: добавить кнопку "Добавить в друзья" при клике по пользователю
const usersList = document.getElementById("users-list");
if (usersList) {
  usersList.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const item = e.target.closest(".contact-item");
    if (!item || !currentUser) return;
    const username = item.getAttribute("data-id");
    if (!username || username === currentUser.username) return;
    if (friends.includes(username)) {
      alert(`${username} уже у тебя в друзьях`);
      return;
    }
    if (confirm(`Отправить запрос в друзья пользователю ${username}?`)) {
      socket.emit("friend request", { to: username });
    }
  });
}

socket.on("friend requests updated", ({ username, requests }) => {
  if (!currentUser || username !== currentUser.username) return;
  friendRequests = requests;
  renderFriendsUI();
});

socket.on("friends updated", ({ user, friends: fr, requests }) => {
  if (!currentUser || user !== currentUser.username) return;
  friends = fr;
  friendRequests = requests;
  renderFriendsUI();
});

// ================== ГОЛОСОВЫЕ КОМНАТЫ (WebRTC) ==================

let localStream = null;
let peerConnections = {}; // user -> RTCPeerConnection
let inVoiceRoom = false;

async function toggleVoiceRoom() {
  if (!currentRoom || !currentUser) return;
  const room = currentRoom;
  if (!inVoiceRoom) {
    // join
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert("Не удалось получить доступ к микрофону");
      return;
    }
    inVoiceRoom = true;
    socket.emit("voice join", { room });
  } else {
    // leave
    inVoiceRoom = false;
    socket.emit("voice leave", { room });
    Object.values(peerConnections).forEach((pc) => pc.close());
    peerConnections = {};
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
  }
}

function createPeerConnection(remoteUser) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("voice signal", {
        room: currentRoom,
        data: { type: "candidate", candidate: event.candidate, to: remoteUser },
      });
    }
  };

  pc.ontrack = (event) => {
    let audio = document.getElementById(`audio-${remoteUser}`);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `audio-${remoteUser}`;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
  };

  return pc;
}

socket.on("voice user joined", async ({ user }) => {
  if (!inVoiceRoom || user === currentUser.username) return;
  const pc = createPeerConnection(user);
  peerConnections[user] = pc;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("voice signal", {
    room: currentRoom,
    data: { type: "offer", offer, to: user },
  });
});

socket.on("voice user left", ({ user }) => {
  const pc = peerConnections[user];
  if (pc) pc.close();
  delete peerConnections[user];
  const audio = document.getElementById(`audio-${user}`);
  if (audio) audio.remove();
});

socket.on("voice signal", async ({ from, data }) => {
  if (!inVoiceRoom || from === currentUser.username) return;

  let pc = peerConnections[from];
  if (!pc) {
    pc = createPeerConnection(from);
    peerConnections[from] = pc;
  }

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("voice signal", {
      room: currentRoom,
      data: { type: "answer", answer, to: from },
    });
  } else if (data.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  } else if (data.type === "candidate" && data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.error("Error adding ICE candidate", e);
    }
  }
});

// ================== СОКЕТЫ: ОНЛАЙН / АВТОРИЗАЦИЯ ==================

socket.on("update online list", (onlineNames) => {
  currentOnlineList = onlineNames;
  document.querySelectorAll(".contact-item").forEach((item) => {
    item.classList.toggle("online", onlineNames.includes(item.getAttribute("data-id")));
  });
});

socket.on("auth success", (data) => {
  currentUser = data.user;
  allMessages = data.history || {};
  friends = data.friends || [];
  friendRequests = data.friendRequests || [];

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
  renderFriendsUI();
});

socket.on("profile saved", (user) => {
  currentUser = user;

  const avatarImg = document.getElementById("my-avatar");
  if (avatarImg) avatarImg.src = user.avatar || "https://cdn-icons-png.flaticon.com/128/149/149071.png";

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
socket.on("spam warning", (m) => alert(m));

setTimeout(() => transitionTo("loader", "auth-screen"), 3000);
