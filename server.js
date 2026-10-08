const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error("❌ BOT_TOKEN не заданий");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

app.get("/", (req, res) => {
  res.send("🤖 Мій Запис Telegram Bot працює!");
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "✅ Telegram підключено!\n\nТепер цей чат можна використовувати для нагадувань про записи."
  );
});

bot.on("message", (msg) => {
  if (msg.text && msg.text !== "/start") {
    console.log("Повідомлення від:", msg.chat.id, msg.from?.username || "без username");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер працює на порту ${PORT}`);
});
