import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { JSONFilePreset } from "lowdb/node";
import bcrypt from "bcrypt";

const app = express();
const server = createServer(app);
const io = new Server(server);

// Инициализация базы данных
const defaultData = {
  messages: { general: [], spam: [] },
  users: [],
};
const db = await JSONFilePreset("db.json", defaultData);

const SALT_ROUNDS = 10;

app.use(express.static("."));

io.on("connection", (socket) => {
  // ЛОГИКА КОМНАТ (Чтобы личные сообщения не видел весь сервер)
  socket.on("join room", (rooms) => {
    if (rooms.oldRoom) socket.leave(rooms.oldRoom);
    socket.join(rooms.newRoom);
    // console.log(`Пользователь вошел в: ${rooms.newRoom}`); // Для отладки
  });

  // РЕГИСТРАЦИЯ (С хешированием пароля)
  socket.on("register", async (userData) => {
    try {
      const exists = db.data.users.find((u) => u.username === userData.username);
      if (exists) return socket.emit("auth error", "Ник занят");

      const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);

      const newUser = {
        username: userData.username,
        password: hashedPassword,
      };

      db.data.users.push(newUser);
      await db.write();

      socket.emit("auth success", {
        user: { username: newUser.username },
        history: db.data.messages,
        allUsers: db.data.users.map((u) => u.username),
      });
    } catch (err) {
      console.error(err);
      socket.emit("auth error", "Ошибка сервера при регистрации");
    }
  });

  // ВХОД (С проверкой хеша)
  socket.on("login", async (userData) => {
    try {
      const user = db.data.users.find((u) => u.username === userData.username);

      if (user) {
        const match = await bcrypt.compare(userData.password, user.password);
        if (match) {
          socket.emit("auth success", {
            user: { username: user.username },
            history: db.data.messages,
            allUsers: db.data.users.map((u) => u.username),
          });
        } else {
          socket.emit("auth error", "Неверный пароль");
        }
      } else {
        socket.emit("auth error", "Пользователь не найден");
      }
    } catch (err) {
      socket.emit("auth error", "Ошибка сервера при входе");
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
      room: room, // Добавляем комнату в объект сообщения
    };

    // Создаем массив комнаты, если его нет
    if (!db.data.messages[room]) db.data.messages[room] = [];

    db.data.messages[room].push(message);
    await db.write();

    // Отправляем сообщение строго в ту комнату, для которой оно предназначено
    io.to(room).emit("render message", message);
  });

  // ИНДИКАТОР ПЕЧАТИ
  socket.on("typing", (data) => {
    // Рассылаем всем в комнате, кроме отправителя
    socket.to(data.room).emit("user typing", data);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
  console.log(`📝 База данных db.json готова к работе`);
  console.log(`=========================================`);
});
