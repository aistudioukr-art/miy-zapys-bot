const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN не заданий");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.get("/", (_req, res) => {
  res.status(200).send("Мій Запис Telegram Bot працює!");
});

bot.onText(/^\/start(?:@\w+)?(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramUserId = msg.from.id;
  const providedId = match && match[1] ? match[1].trim() : "";

  let clientId = `tg_${telegramUserId}`;

  if (providedId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(providedId)) {
      await bot.sendMessage(chatId, "Посилання для підключення некоректне.");
      return;
    }

    clientId = providedId;
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("Не задано SUPABASE_URL або SUPABASE_SECRET_KEY");
    await bot.sendMessage(
      chatId,
      "Бот працює, але база даних ще не налаштована."
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
      console.error("Supabase error:", response.status, details);

      await bot.sendMessage(
        chatId,
        "Не вдалося зберегти підключення. Перевіримо налаштування."
      );
      return;
    }

    console.log("Telegram-клієнта збережено в Supabase.");

    await bot.sendMessage(
      chatId,
      "✅ Telegram підключено!\n\nТвій Telegram-чат збережено для тестування нагадувань."
    );
  } catch (error) {
    console.error("Помилка підключення до Supabase:", error.message);

    await bot.sendMessage(
      chatId,
      "Сталася помилка під час збереження. Спробуй пізніше."
    ).catch(() => {});
  }
});

bot.on("polling_error", (error) => {
  console.error("Telegram polling error:", error.message);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Сервер працює на порту ${PORT}`);
});
