const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const APP_API_KEY = (process.env.APP_API_KEY || "").trim();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "32kb" }));

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN не заданий");
  process.exit(1);
}

function requireAppApiKey(req, res, next) {
  if (!APP_API_KEY) {
    return res.status(503).json({
      error: "APP_API_KEY ще не налаштований у Render."
    });
  }

  const suppliedKey = req.get("X-API-Key");

  if (!suppliedKey || suppliedKey !== APP_API_KEY) {
    return res.status(401).json({ error: "Невірний APP_API_KEY." });
  }

  next();
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "SUPABASE_URL або SUPABASE_SECRET_KEY не заданий у Render."
    );
  }

  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    ...(options.body !== undefined ? { body: options.body } : {})
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const details = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Supabase ${response.status}: ${details}`);
  }

  return data;
}

app.get("/", (_req, res) => {
  res.status(200).send("🤖 Мій Запис Telegram Bot працює!");
});

app.get("/api/test", requireAppApiKey, async (_req, res) => {
  try {
    await supabaseRequest("/rest/v1/telegram_clients?select=id&limit=1");
    res.json({ ok: true, message: "Сервер і Supabase підключені." });
  } catch (error) {
    console.error("API test error:", error.message);
    res.status(503).json({
      error: "Не вдалося підключитися до Supabase. Перевір URL і ключ у Render."
    });
  }
});

app.post("/api/appointments", requireAppApiKey, async (req, res) => {
  try {
    const body = req.body || {};
    const appointmentId = String(body.appointment_id || "").trim();
    const clientId = String(body.client_id || "").trim();
    const clientName = String(body.client_name || "").trim();
    const serviceName = String(body.service_name || "").trim();
    const startsAt = new Date(body.starts_at);
    const durationMinutes = Number(body.duration_minutes);
    const allowedModes = new Set(["24", "2", "24,2", "0"]);
    const reminderMode = String(body.reminder_mode || "24,2");

    if (!appointmentId || !clientId || !clientName || !serviceName) {
      return res.status(400).json({
        error: "Не заповнені обов'язкові поля запису."
      });
    }

    if (!body.starts_at || Number.isNaN(startsAt.getTime())) {
      return res.status(400).json({
        error: "Некоректна дата або час запису."
      });
    }

    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0 ||
      durationMinutes > 720
    ) {
      return res.status(400).json({
        error: "Тривалість запису має бути від 1 до 720 хвилин."
      });
    }

    if (!allowedModes.has(reminderMode)) {
      return res.status(400).json({
        error: "Некоректний режим нагадувань."
      });
    }

    const payload = {
      appointment_id: appointmentId,
      client_id: clientId,
      client_name: clientName,
      phone: body.phone ? String(body.phone).trim() : null,
      service_name: serviceName,
      starts_at: startsAt.toISOString(),
      duration_minutes: durationMinutes,
      reminder_mode: reminderMode,
      status: "scheduled"
    };

    const result = await supabaseRequest(
      "/rest/v1/appointments?on_conflict=appointment_id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(payload)
      }
    );

    console.log("Appointment saved to Supabase:", appointmentId);
    res.status(200).json({
      ok: true,
      appointment: Array.isArray(result) ? result[0] : result
    });
  } catch (error) {
    console.error("Appointment sync error:", error.message);
    res.status(500).json({
      error: "Не вдалося зберегти запис у базі. Перевір журнали Render."
    });
  }
});

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/^\/start(?:@\w+)?(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramUserId = msg.from && msg.from.id;
  const suppliedClientId = (match && match[1] ? match[1] : "").trim();

  if (!telegramUserId) {
    await bot.sendMessage(chatId, "Не вдалося визначити Telegram-користувача.");
    return;
  }

  let clientId = `tg_${telegramUserId}`;

  if (suppliedClientId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(suppliedClientId)) {
      await bot.sendMessage(
        chatId,
        "Посилання для підключення некоректне. Звернися до майстра."
      );
      return;
    }

    clientId = suppliedClientId;
  }

  try {
    await supabaseRequest(
      "/rest/v1/telegram_clients?on_conflict=telegram_chat_id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          client_id: clientId,
          telegram_chat_id: chatId
        })
      }
    );

    console.log("Telegram client connected:", clientId);

    await bot.sendMessage(
      chatId,
      "✅ Telegram підключено!\n\n" +
      "Твій Telegram-чат збережено для тестування нагадувань."
    );
  } catch (error) {
    console.error("Telegram /start error:", error.message);

    await bot.sendMessage(
      chatId,
      "❌ Не вдалося зберегти підключення. Перевір налаштування сервера."
    );
  }
});

bot.on("polling_error", (error) => {
  console.error("Telegram polling error:", error.message);
});

let reminderCheckRunning = false;

async function checkReminders() {
  if (reminderCheckRunning || !SUPABASE_URL || !SUPABASE_SECRET_KEY) return;

  reminderCheckRunning = true;

  try {
    const now = new Date();
    const lowerBound = new Date(
      now.getTime() - 26 * 60 * 60 * 1000
    ).toISOString();

    const appointmentQuery = new URLSearchParams({
      select:
        "appointment_id,client_id,client_name,service_name,starts_at,reminder_mode,reminder_24h_sent_at,reminder_2h_sent_at,status",
      status: "eq.scheduled",
      starts_at: `gte.${lowerBound}`,
      order: "starts_at.asc",
      limit: "500"
    });

    const appointments = await supabaseRequest(
      `/rest/v1/appointments?${appointmentQuery.toString()}`
    );

    if (!Array.isArray(appointments) || appointments.length === 0) return;

    const telegramClients = await supabaseRequest(
      "/rest/v1/telegram_clients?select=client_id,telegram_chat_id&limit=1000"
    );

    const chatByClientId = new Map(
      (Array.isArray(telegramClients) ? telegramClients : []).map((client) => [
        String(client.client_id),
        Number(client.telegram_chat_id)
      ])
    );

    for (const appointment of appointments) {
      const chatId = chatByClientId.get(String(appointment.client_id));
      if (!chatId) continue;

      const startTime = new Date(appointment.starts_at).getTime();
      const hoursUntil = (startTime - Date.now()) / 3600000;

      if (!Number.isFinite(hoursUntil) || hoursUntil <= 0) continue;

      const modes = String(appointment.reminder_mode || "24,2")
        .split(",")
        .map((value) => value.trim());

      let reminderField = null;
      let label = "";

      if (
        modes.includes("24") &&
        !appointment.reminder_24h_sent_at &&
        hoursUntil <= 25 &&
        hoursUntil >= 23
      ) {
        reminderField = "reminder_24h_sent_at";
        label = "приблизно за 24 години";
      } else if (
        modes.includes("2") &&
        !appointment.reminder_2h_sent_at &&
        hoursUntil <= 2.5 &&
        hoursUntil >= 1.5
      ) {
        reminderField = "reminder_2h_sent_at";
        label = "приблизно за 2 години";
      }

      if (!reminderField) continue;

      const dateText = new Intl.DateTimeFormat("uk-UA", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Europe/Kyiv"
      }).format(new Date(appointment.starts_at));

      const message =
        `🔔 Нагадування про запис (${label})\n\n` +
        `${appointment.client_name}, нагадуємо про ваш запис.\n` +
        `Послуга: ${appointment.service_name}\n` +
        `Дата та час: ${dateText}\n\n` +
        "До зустрічі! ❤️";

      try {
        await bot.sendMessage(chatId, message);

        await supabaseRequest(
          `/rest/v1/appointments?appointment_id=eq.${encodeURIComponent(
            appointment.appointment_id
          )}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              [reminderField]: new Date().toISOString()
            })
          }
        );

        console.log(
          `Reminder sent: ${reminderField} for ${appointment.appointment_id}`
        );
      } catch (error) {
        console.error(
          `Reminder error for ${appointment.appointment_id}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("Reminder scheduler error:", error.message);
  } finally {
    reminderCheckRunning = false;
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Сервер працює на порту ${PORT}`);
});

checkReminders();
setInterval(checkReminders, 60 * 1000);
