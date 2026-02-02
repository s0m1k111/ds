import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { JSONFilePreset } from "lowdb/node";
import bcrypt from "bcrypt";

const app = express();
const server = createServer(app);
const io = new Server(server);

const defaultData = {
  messages: { general: [], spam: [] },
  users: [],
};
const db = await JSONFilePreset("db.json", defaultData);
const SALT_ROUNDS = 10;

app.use(express.static("."));

// Помощник для генерации имен приватных комнат (такой же как на клиенте)
function getPrivateRoomId(u1, u2) {
  return [u1, u2].sort().join("_");
}

io.on("connection", (socket) => {
  // 1. ВХОД В КОМНАТЫ ПРИ АВТОРИЗАЦИИ
  // Эта функция подписывает сокет на все возможные чаты
  const subscribeToAllRooms = (username) => {
    socket.join("general"); // Общий чат

    // Подписываем пользователя на все возможные личные комнаты с другими участниками
    db.data.users.forEach((otherUser) => {
      if (otherUser.username !== username) {
        const roomId = getPrivateRoomId(username, otherUser.username);
        socket.join(roomId);
      }
    });
  };

  // РЕГИСТРАЦИЯ
  socket.on("register", async (userData) => {
    try {
      const exists = db.data.users.find((u) => u.username === userData.username);
      if (exists) return socket.emit("auth error", "Ник занят");

      const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
      const newUser = { username: userData.username, password: hashedPassword };

      db.data.users.push(newUser);
      await db.write();

      subscribeToAllRooms(newUser.username); // Входим в комнаты

      socket.emit("auth success", {
        user: { username: newUser.username },
        history: db.data.messages,
        allUsers: db.data.users.map((u) => u.username),
      });
    } catch (err) {
      socket.emit("auth error", "Ошибка регистрации");
    }
  });

  // ВХОД
  socket.on("login", async (userData) => {
    const user = db.data.users.find((u) => u.username === userData.username);
    if (user && (await bcrypt.compare(userData.password, user.password))) {
      subscribeToAllRooms(user.username); // Входим в комнаты

      socket.emit("auth success", {
        user: { username: user.username },
        history: db.data.messages,
        allUsers: db.data.users.map((u) => u.username),
      });
    } else {
      socket.emit("auth error", "Неверный логин или пароль");
    }
  });

  // СООБЩЕНИЯ
  socket.on("new message", async (msgData) => {
    const room = msgData.room;
    const message = {
      id: Date.now(),
      user: msgData.user,
      text: msgData.text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      room: room,
    };

    if (!db.data.messages[room]) db.data.messages[room] = [];
    db.data.messages[room].push(message);
    await db.write();

    // Теперь, так как оба пользователя в комнате с самого начала,
    // сообщение дойдет даже если один из них сидит в другом чате
    io.to(room).emit("render message", message);
  });

  // ПЕЧАТАЕТ...
  socket.on("typing", (data) => {
    socket.to(data.room).emit("user typing", data);
  });

  // При смене комнаты клиентом (необязательно для доставки, но полезно для логики)
  socket.on("join room", (rooms) => {
    // Мы не выходим из приватных комнат, чтобы получать уведомления в фоне!
    // Просто переключаем фокус
    console.log(`Фокус пользователя на: ${rooms.newRoom}`);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});
