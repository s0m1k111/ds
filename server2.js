import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { JSONFilePreset } from "lowdb/node";
import bcrypt from "bcrypt";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const defaultData = {
  messages: { general: [], spam: [] },
  users: [],
  friends: {}, // { username: [friendUsernames] }
  friendRequests: {}, // { username: [fromUsernames] }
};
const db = await JSONFilePreset("db.json", defaultData);
const SALT_ROUNDS = 10;

app.use(express.static("."));

// онлайн
let onlineUsers = new Set();
// антиспам: username -> массив таймстампов
const messageHistory = new Map();

function getPrivateRoomId(u1, u2) {
  return [u1, u2].sort().join("_");
}

function ensureUserStructures(username) {
  if (!db.data.friends[username]) db.data.friends[username] = [];
  if (!db.data.friendRequests[username]) db.data.friendRequests[username] = [];
}

function isFriends(u1, u2) {
  ensureUserStructures(u1);
  ensureUserStructures(u2);
  return db.data.friends[u1].includes(u2) && db.data.friends[u2].includes(u1);
}

function checkSpam(username) {
  const now = Date.now();
  const windowMs = 5000; // 5 сек
  const maxMessages = 8;

  if (!messageHistory.has(username)) {
    messageHistory.set(username, []);
  }
  const arr = messageHistory.get(username);
  // очищаем старые
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  arr.push(now);
  if (arr.length > maxMessages) {
    return true;
  }
  return false;
}

io.on("connection", (socket) => {
  let socketUsername = null;

  const subscribeToAllRooms = (username) => {
    socket.join("general");
    socket.join("spam");
    db.data.users.forEach((u) => {
      if (u.username !== username) {
        socket.join(getPrivateRoomId(username, u.username));
      }
    });
  };

  const setUserOnline = (username) => {
    socketUsername = username;
    onlineUsers.add(username);
    io.emit("update online list", Array.from(onlineUsers));
  };

  // РЕГИСТРАЦИЯ
  socket.on("register", async (userData) => {
    const exists = db.data.users.find((u) => u.username === userData.username);
    if (exists) return socket.emit("auth error", "Ник занят");

    const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
    const newUser = {
      username: userData.username,
      password: hashedPassword,
      email: "",
      avatar: "",
      bg: "",
    };

    db.data.users.push(newUser);
    ensureUserStructures(newUser.username);
    await db.write();

    setUserOnline(newUser.username);
    subscribeToAllRooms(newUser.username);

    socket.emit("auth success", {
      user: newUser,
      history: db.data.messages,
      allUsers: db.data.users.map((u) => ({ username: u.username, avatar: u.avatar })),
      friends: db.data.friends[newUser.username] || [],
      friendRequests: db.data.friendRequests[newUser.username] || [],
    });
    socket.broadcast.emit("user updated", { username: newUser.username, avatar: newUser.avatar });
  });

  // ВХОД
  socket.on("login", async (userData) => {
    const user = db.data.users.find((u) => u.username === userData.username);
    if (user && (await bcrypt.compare(userData.password, user.password))) {
      ensureUserStructures(user.username);
      setUserOnline(user.username);
      subscribeToAllRooms(user.username);

      socket.emit("auth success", {
        user: user,
        history: db.data.messages,
        allUsers: db.data.users.map((u) => ({ username: u.username, avatar: u.avatar })),
        friends: db.data.friends[user.username] || [],
        friendRequests: db.data.friendRequests[user.username] || [],
      });
    } else {
      socket.emit("auth error", "Неверный логин или пароль");
    }
  });

  // ВЫХОД
  socket.on("disconnect", () => {
    if (socketUsername) {
      onlineUsers.delete(socketUsername);
      io.emit("update online list", Array.from(onlineUsers));
    }
  });

  // ОБНОВЛЕНИЕ ПРОФИЛЯ
  socket.on("update profile", async (data) => {
    const user = db.data.users.find((u) => u.username === data.username);
    if (user) {
      user.email = data.email || "";
      user.avatar = data.avatar || "";
      user.bg = data.bg || "";
      await db.write();

      socket.emit("profile saved", user);
      io.emit("user updated", { username: user.username, avatar: user.avatar });
    }
  });

  // НОВОЕ СООБЩЕНИЕ
  socket.on("new message", async (msgData) => {
    if (!msgData || !msgData.user || !msgData.text || !msgData.room) return;

    // антиспам
    if (checkSpam(msgData.user)) {
      socket.emit("spam warning", "Слишком много сообщений. Попробуй чуть позже.");
      return;
    }

    const user = db.data.users.find((u) => u.username === msgData.user);
    const allowedRooms = new Set(["general", "spam"]);
    // приватные комнаты только между друзьями
    if (!allowedRooms.has(msgData.room)) {
      const [u1, u2] = msgData.room.split("_");
      if (!isFriends(u1, u2)) {
        return; // не друзья — не даём писать
      }
    }

    const message = {
      id: Date.now(),
      user: msgData.user,
      avatar: user ? user.avatar : "",
      text: msgData.text,
      type: msgData.type || "text", // text | image
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      room: msgData.room,
    };

    if (!db.data.messages[message.room]) db.data.messages[message.room] = [];
    db.data.messages[message.room].push(message);
    await db.write();
    io.to(message.room).emit("render message", message);
  });

  // РЕДАКТИРОВАНИЕ СООБЩЕНИЯ
  socket.on("edit message", async ({ id, room, newText }) => {
    if (!id || !room || !newText) return;
    const msgs = db.data.messages[room];
    if (!msgs) return;
    const msg = msgs.find((m) => m.id === id);
    if (!msg) return;
    if (msg.user !== socketUsername) return; // только свои

    msg.text = newText;
    msg.edited = true;
    await db.write();
    io.to(room).emit("message edited", { id, room, newText, edited: true });
  });

  // УДАЛЕНИЕ СООБЩЕНИЯ
  socket.on("delete message", async ({ id, room }) => {
    if (!id || !room) return;
    const msgs = db.data.messages[room];
    if (!msgs) return;
    const msg = msgs.find((m) => m.id === id);
    if (!msg) return;
    if (msg.user !== socketUsername) return;

    db.data.messages[room] = msgs.filter((m) => m.id !== id);
    await db.write();
    io.to(room).emit("message deleted", { id, room });
  });

  // ПРИСОЕДИНЕНИЕ К КОМНАТЕ
  socket.on("join room", (rooms) => {
    if (rooms?.newRoom) {
      socket.join(rooms.newRoom);
    }
  });

  // TYPING
  socket.on("typing", (data) => {
    socket.to(data.room).emit("user typing", data);
  });

  // ДРУЗЬЯ: запрос
  socket.on("friend request", async ({ to }) => {
    if (!socketUsername || !to || to === socketUsername) return;
    const target = db.data.users.find((u) => u.username === to);
    if (!target) return;

    ensureUserStructures(socketUsername);
    ensureUserStructures(to);

    if (db.data.friends[socketUsername].includes(to)) return;
    if (db.data.friendRequests[to].includes(socketUsername)) return;

    db.data.friendRequests[to].push(socketUsername);
    await db.write();

    io.emit("friend requests updated", {
      username: to,
      requests: db.data.friendRequests[to],
    });
  });

  // ДРУЗЬЯ: ответ
  socket.on("friend response", async ({ from, accept }) => {
    if (!socketUsername || !from) return;
    ensureUserStructures(socketUsername);
    ensureUserStructures(from);

    db.data.friendRequests[socketUsername] = db.data.friendRequests[socketUsername].filter((u) => u !== from);

    if (accept) {
      if (!db.data.friends[socketUsername].includes(from)) db.data.friends[socketUsername].push(from);
      if (!db.data.friends[from].includes(socketUsername)) db.data.friends[from].push(socketUsername);
    }
    await db.write();

    io.emit("friends updated", {
      user: socketUsername,
      friends: db.data.friends[socketUsername],
      requests: db.data.friendRequests[socketUsername],
    });
    io.emit("friends updated", {
      user: from,
      friends: db.data.friends[from],
      requests: db.data.friendRequests[from],
    });
  });

  // ГОЛОСОВЫЕ КОМНАТЫ (WebRTC сигналинг)
  socket.on("voice join", ({ room }) => {
    if (!room) return;
    socket.join(`voice_${room}`);
    socket.to(`voice_${room}`).emit("voice user joined", { user: socketUsername });
  });

  socket.on("voice leave", ({ room }) => {
    if (!room) return;
    socket.leave(`voice_${room}`);
    socket.to(`voice_${room}`).emit("voice user left", { user: socketUsername });
  });

  socket.on("voice signal", ({ room, data }) => {
    if (!room || !data) return;
    socket.to(`voice_${room}`).emit("voice signal", { from: socketUsername, data });
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});
