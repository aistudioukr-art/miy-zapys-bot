const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN не заданий");
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    "SUPABASE_URL або SUPABASE_SECRET_KEY не заданий"
  );
}

app.get("/", (_req, res) => {
  res.status(200).send("🤖 Мій Запис Telegram Bot працює!");
});

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

bot.onText(/^\/start(?:@\w+)?(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramUserId = msg.from?.id;
  const suppliedClientId = (match?.[1] || "").trim();

  if (!telegramUserId) {
    await bot.sendMessage(chatId, "Не вдалося визначити Telegram-користувача.");
    return;
  }

  let clientId;

  if (suppliedClientId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(suppliedClientId)) {
      await bot.sendMessage(
        chatId,
        "Посилання для підключення некоректне. Звернися до майстра."
      );
      return;
    }

    clientId = suppliedClientId;
  } else {
    clientId = `tg_${telegramUserId}`;
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    await bot.sendMessage(
      chatId,
      "⚠️ Бот працює, але база даних ще не налаштована. Спробуй пізніше."
    );
    return;
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/telegram_clients?on_conflict=telegram_chat_id`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          client_id: clientId,
          telegram_chat_id: chatId
        })
      }
    );

    if (!response.ok) {
      const details = await response.text();

      console.error(
        `Supabase error ${response.status}: ${details}`
      );

      await bot.sendMessage(
        chatId,
        "❌ Не вдалося зберегти підключення. Потрібно перевірити налаштування."
      );
