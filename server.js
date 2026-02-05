import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { JSONFilePreset } from "lowdb/node";
import bcrypt from "bcrypt";

const app = express();
const server = createServer(app);
const io = new Server(server);

// Инициализация БД
const defaultData = {
  messages: { general: [], spam: [] },
  users: [],
};
const db = await JSONFilePreset("db.json", defaultData);
const SALT_ROUNDS = 10;

app.use(express.static("."));

function getPrivateRoomId(u1, u2) {
  return [u1, u2].sort().join("_");
}

io.on("connection", (socket) => {
  let socketUsername = null;

  // Функция подписки на ВСЕ доступные чаты
  const subscribeToAllRooms = (username) => {
    socket.join("general");
    socket.join("spam");
    db.data.users.forEach((u) => {
      if (u.username !== username) {
        socket.join(getPrivateRoomId(username, u.username));
      }
    });
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
    };

    db.data.users.push(newUser);
    await db.write();

    socketUsername = newUser.username;
    subscribeToAllRooms(newUser.username);

    socket.emit("auth success", {
      user: newUser,
      history: db.data.messages,
      allUsers: db.data.users.map((u) => ({ username: u.username, avatar: u.avatar })),
    });
    socket.broadcast.emit("user updated", { username: newUser.username, avatar: newUser.avatar });
  });

  // ВХОД
  socket.on("login", async (userData) => {
    const user = db.data.users.find((u) => u.username === userData.username);
    if (user && (await bcrypt.compare(userData.password, user.password))) {
      socketUsername = user.username;
      subscribeToAllRooms(user.username);

      socket.emit("auth success", {
        user: user,
        history: db.data.messages,
        allUsers: db.data.users.map((u) => ({ username: u.username, avatar: u.avatar })),
      });
    } else {
      socket.emit("auth error", "Неверный логин или пароль");
    }
  });

  // ОБНОВЛЕНИЕ ПРОФИЛЯ
  socket.on("update profile", async (data) => {
    const user = db.data.users.find((u) => u.username === data.username);
    if (user) {
      user.email = data.email || user.email;
      user.avatar = data.avatar || user.avatar;
      await db.write();

      socket.emit("profile saved", user);
      io.emit("user updated", { username: user.username, avatar: user.avatar });
    }
  });

  // СООБЩЕНИЯ
  socket.on("new message", async (msgData) => {
    const user = db.data.users.find((u) => u.username === msgData.user);

    const message = {
      id: Date.now(),
      user: msgData.user,
      avatar: user ? user.avatar : "",
      text: msgData.text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      room: msgData.room,
    };

    if (!db.data.messages[message.room]) db.data.messages[message.room] = [];
    db.data.messages[message.room].push(message);
    await db.write();

    // Транслируем всем в этой комнате
    io.to(message.room).emit("render message", message);
  });

  // ИСПРАВЛЕННЫЙ JOIN ROOM: Теперь мы не выходим из старой комнаты!
  socket.on("join room", (rooms) => {
    // Убрали socket.leave(rooms.oldRoom).
    // Теперь сокет просто подтверждает вход в целевую комнату.
    socket.join(rooms.newRoom);
    console.log(`Пользователь ${socketUsername} сфокусирован на: ${rooms.newRoom}`);
  });

  socket.on("typing", (data) => {
    socket.to(data.room).emit("user typing", data);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});
