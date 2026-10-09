const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

const token = process.env.BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!token) {
  console.error("BOT_TOKEN не заданий");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

app.get("/", (req, res) => {
  res.send("🤖 Мій Запис Telegram Bot працює!");
});

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramUserId = String(msg.from.id);
  const suppliedClientId = match?.[1]?.trim();
  const clientId = suppliedClientId || `tg_${telegramUserId}`;

  try {
    if (!supabaseUrl || !supabaseKey) {
      await bot.sendMessage(
        chatId,
        "⚠️ Сервер працює, але Supabase ще не налаштований."
      );
      console.error("Не задано SUPABASE_URL або SUPABASE_SECRET_KEY");
      return;
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/telegram_clients?on_conflict=telegram_chat_id`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
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
      const error = await response.text();
      console.error("Помилка Supabase:", response.status, error);

      await bot.sendMessage(
        chatId,
        "❌ Не вдалося зберегти підключення. Потрібна перевірка налаштувань."
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      "✅ Telegram підключено!\nТепер цей чат можна використовувати для нагадувань про записи."
    );

    console.log("Telegram chat збережено:", chatId);
  } catch (error) {
    console.error("Помилка /start:", error.message);

    await bot.sendMessage(
      chatId,
      "❌ Ст
