/**
 * Nova AI — Telegram Bot (Node.js)
 * M-Pesa Manual Verification + Gemini AI Chat
 */

import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Database from "better-sqlite3";

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const {
  BOT_TOKEN,
  ADMIN_TELEGRAM_ID,
  MPESA_NUMBER   = "0712XXXXXX",
  MPESA_NAME     = "Your Name",
  PAYMENT_AMOUNT = "500",
  GEMINI_API_KEY,
  BOT_PERSONALITY = `You are Nova, a warm, clever, and friendly personal AI assistant.
You speak naturally like a real person — use contractions, occasional humor,
and always address the user by their first name when you know it.
Never mention that you are an AI unless directly and persistently asked.`,
} = process.env;

const ADMIN_ID = parseInt(ADMIN_TELEGRAM_ID, 10);

if (!BOT_TOKEN || !GEMINI_API_KEY || !ADMIN_ID) {
  console.error("❌  Missing required env vars. Check your .env file.");
  process.exit(1);
}

// ─── CLIENTS ───────────────────────────────────────────────────────────────────
const bot   = new TelegramBot(BOT_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-lite",
  systemInstruction: BOT_PERSONALITY,
});

// ─── DATABASE ──────────────────────────────────────────────────────────────────
const db = new Database("users.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id  INTEGER PRIMARY KEY,
    username     TEXT,
    full_name    TEXT,
    first_name   TEXT,
    status       TEXT    DEFAULT 'unpaid',
    mpesa_code   TEXT,
    awaiting_code INTEGER DEFAULT 0,
    created_at   TEXT,
    paid_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS used_codes (
    code     TEXT PRIMARY KEY,
    used_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS chat_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER,
    role        TEXT,
    content     TEXT,
    created_at  TEXT
  );
`);

// Add awaiting_code column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE users ADD COLUMN awaiting_code INTEGER DEFAULT 0`);
} catch (_) {}

console.log("✅  Database ready.");

// ─── DB HELPERS ────────────────────────────────────────────────────────────────
const stmts = {
  getUser:         db.prepare("SELECT * FROM users WHERE telegram_id = ?"),
  insertUser:      db.prepare(`
    INSERT OR IGNORE INTO users (telegram_id, username, full_name, first_name, status, awaiting_code, created_at)
    VALUES (@telegram_id, @username, @full_name, @first_name, 'unpaid', 0, @created_at)
  `),
  setPending:      db.prepare("UPDATE users SET status = 'pending', mpesa_code = ?, awaiting_code = 0 WHERE telegram_id = ?"),
  setPaid:         db.prepare("UPDATE users SET status = 'paid', paid_at = ? WHERE telegram_id = ?"),
  setUnpaid:       db.prepare("UPDATE users SET status = 'unpaid', mpesa_code = NULL, awaiting_code = 0 WHERE telegram_id = ?"),
  setAwaitingCode: db.prepare("UPDATE users SET awaiting_code = ? WHERE telegram_id = ?"),
  isCodeUsed:      db.prepare("SELECT code FROM used_codes WHERE code = ?"),
  markCodeUsed:    db.prepare("INSERT OR IGNORE INTO used_codes (code, used_at) VALUES (?, ?)"),
  saveMsg:         db.prepare("INSERT INTO chat_history (telegram_id, role, content, created_at) VALUES (?, ?, ?, ?)"),
  getHistory:      db.prepare(`
    SELECT role, content FROM chat_history
    WHERE telegram_id = ?
    ORDER BY created_at DESC
    LIMIT 12
  `),
  allUsers:        db.prepare("SELECT full_name, username, status, telegram_id, created_at FROM users ORDER BY created_at DESC LIMIT 30"),
  statsByStatus:   db.prepare("SELECT status, COUNT(*) as count FROM users GROUP BY status"),
};

const getUser         = (id)                => stmts.getUser.get(id);
const createUser      = (id, uname, full, first) =>
  stmts.insertUser.run({ telegram_id: id, username: uname, full_name: full, first_name: first, created_at: now() });
const setPending      = (id, code)          => stmts.setPending.run(code.toUpperCase(), id);
const setPaid         = (id)                => stmts.setPaid.run(now(), id);
const setUnpaid       = (id)                => stmts.setUnpaid.run(id);
const setAwaitingCode = (id, val)           => stmts.setAwaitingCode.run(val, id);
const isCodeUsed      = (code)              => !!stmts.isCodeUsed.get(code.toUpperCase());
const markCodeUsed    = (code)              => stmts.markCodeUsed.run(code.toUpperCase(), now());
const saveMsg         = (id, role, content) => stmts.saveMsg.run(id, role, content, now());
const getHistory      = (id)                => stmts.getHistory.all(id).reverse();
const now             = ()                  => new Date().toISOString();

// ─── KEYBOARDS ─────────────────────────────────────────────────────────────────

// Shown to unpaid users — replaces text input with one big button
const PAY_KEYBOARD = {
  keyboard: [[{ text: "💳 I've Paid — Enter M-Pesa Code" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
  input_field_placeholder: "Tap the button below to continue...",
};

// Shown after they tap "I've Paid" — asks for code
const ENTER_CODE_KEYBOARD = {
  keyboard: [[{ text: "🔙 Back" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
  input_field_placeholder: "Type your M-Pesa code here, e.g. RG47XY1234",
};

// Shown to pending users
const PENDING_KEYBOARD = {
  keyboard: [[{ text: "🔄 Check Status" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
  input_field_placeholder: "Waiting for admin approval...",
};

// Remove keyboard (for paid users — free to chat)
const REMOVE_KEYBOARD = { remove_keyboard: true };

// ─── HELPERS ───────────────────────────────────────────────────────────────────
const escMd = (text) =>
  String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");

const isMpesaCode = (text) =>
  /^[A-Z0-9]{8,15}$/i.test(text.replace(/\s/g, ""));

// Payment info message (plain, shown with pay keyboard)
const paymentScreen = (firstName) =>
  `👋 Hey *${escMd(firstName)}\\!*\n\n` +
  `To unlock *Nova AI*, send *KSh ${escMd(PAYMENT_AMOUNT)}* via M\\-Pesa:\n\n` +
  `━━━━━━━━━━━━━━━━━━━━━━\n` +
  `📱 *Till/Number:* \`${escMd(MPESA_NUMBER)}\`\n` +
  `👤 *Name:* ${escMd(MPESA_NAME)}\n` +
  `💰 *Amount:* KSh ${escMd(PAYMENT_AMOUNT)}\n` +
  `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
  `After paying, tap the button below 👇`;

// ─── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(" ");

  createUser(id, username, fullName, first_name);
  const user = getUser(id);

  if (user.status === "paid") {
    bot.sendMessage(id,
      `Welcome back, *${escMd(first_name)}\\!* 🎉\n\nI'm ready — what would you like to talk about\\?`,
      { parse_mode: "MarkdownV2", reply_markup: REMOVE_KEYBOARD }
    );
  } else if (user.status === "pending") {
    bot.sendMessage(id,
      `⏳ Hi *${escMd(first_name)}\\!* Your payment is being reviewed\\. Please hang tight\\.`,
      { parse_mode: "MarkdownV2", reply_markup: PENDING_KEYBOARD }
    );
  } else {
    setAwaitingCode(id, 0);
    bot.sendMessage(id, paymentScreen(first_name), {
      parse_mode: "MarkdownV2",
      reply_markup: PAY_KEYBOARD,
    });
  }
});

// ─── /approve (admin only) ─────────────────────────────────────────────────────
bot.onText(/\/approve(?:\s+(\d+))?/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  const targetId = match[1] ? parseInt(match[1], 10) : ADMIN_ID;
  const user = getUser(targetId);

  if (!user) {
    bot.sendMessage(ADMIN_ID, `❌ No user found with ID ${targetId}.\nThey must send /start first.`);
    return;
  }
  if (user.status === "paid") {
    bot.sendMessage(ADMIN_ID, `ℹ️ ${user.full_name} is already approved.`);
    return;
  }

  setPaid(targetId);
  bot.sendMessage(ADMIN_ID, `✅ ${user.full_name} (ID: ${targetId}) approved!`);

  if (targetId !== ADMIN_ID) {
    bot.sendMessage(targetId,
      `🎉 *Payment Verified\\!*\n\nWelcome to Nova AI\\! 🚀\n\nI'm your personal assistant — ask me anything\\.`,
      { parse_mode: "MarkdownV2", reply_markup: REMOVE_KEYBOARD }
    ).catch(() => {});
  }
});

// ─── /myid ─────────────────────────────────────────────────────────────────────
bot.onText(/\/myid/, (msg) => {
  bot.sendMessage(msg.from.id, `🆔 Your Telegram ID is: ${msg.from.id}`);
});

// ─── /users (admin) ────────────────────────────────────────────────────────────
bot.onText(/\/users/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const users = stmts.allUsers.all();
  if (!users.length) return bot.sendMessage(ADMIN_ID, "No users yet.");
  const emap = { paid: "✅", pending: "⏳", unpaid: "🔒" };
  const lines = ["👥 All Users:\n"];
  for (const { full_name, username, status, telegram_id } of users) {
    lines.push(`${emap[status] ?? "❓"} ${full_name} (@${username ?? "N/A"}) [${telegram_id}] — ${status}`);
  }
  bot.sendMessage(ADMIN_ID, lines.join("\n"));
});

// ─── /stats (admin) ────────────────────────────────────────────────────────────
bot.onText(/\/stats/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const rows  = stmts.statsByStatus.all();
  const total = rows.reduce((s, r) => s + r.count, 0);
  const emap  = { paid: "✅", pending: "⏳", unpaid: "🔒" };
  const lines = [`📊 Bot Stats\n\nTotal users: ${total}\n`];
  for (const { status, count } of rows) lines.push(`${emap[status] ?? "❓"} ${status}: ${count}`);
  bot.sendMessage(ADMIN_ID, lines.join("\n"));
});

// ─── MAIN MESSAGE HANDLER ──────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const { id, username, first_name, last_name } = msg.from;
  const text     = msg.text.trim();
  const fullName = [first_name, last_name].filter(Boolean).join(" ");

  createUser(id, username, fullName, first_name);
  const user = getUser(id);

  // ── PAID → AI ──────────────────────────────────────────────────────────────
  if (user.status === "paid") {
    await chatWithAI(id, first_name, text);
    return;
  }

  // ── PENDING ────────────────────────────────────────────────────────────────
  if (user.status === "pending") {
    if (text === "🔄 Check Status") {
      bot.sendMessage(id,
        "⏳ Still being verified\\. The admin will approve you shortly\\. Please wait\\.",
        { parse_mode: "MarkdownV2", reply_markup: PENDING_KEYBOARD }
      );
    } else {
      bot.sendMessage(id,
        "⏳ Your payment is still being verified\\. Please be patient\\.",
        { parse_mode: "MarkdownV2", reply_markup: PENDING_KEYBOARD }
      );
    }
    return;
  }

  // ── UNPAID ─────────────────────────────────────────────────────────────────

  // User tapped "I've Paid" button
  if (text === "💳 I've Paid — Enter M-Pesa Code") {
    setAwaitingCode(id, 1);
    bot.sendMessage(id,
      `📩 Please type your *M\\-Pesa confirmation code* now\\.\n\n_Example: \`RG47XY1234\`_`,
      { parse_mode: "MarkdownV2", reply_markup: ENTER_CODE_KEYBOARD }
    );
    return;
  }

  // User tapped "Back"
  if (text === "🔙 Back") {
    setAwaitingCode(id, 0);
    bot.sendMessage(id, paymentScreen(first_name), {
      parse_mode: "MarkdownV2",
      reply_markup: PAY_KEYBOARD,
    });
    return;
  }

  // User is in code-entry mode
  if (user.awaiting_code === 1) {
    if (!isMpesaCode(text)) {
      bot.sendMessage(id,
        `❌ That doesn't look like a valid M\\-Pesa code\\.\n\nCodes are 8\\-15 characters, letters and numbers only\\.\n_Example: \`RG47XY1234\`_`,
        { parse_mode: "MarkdownV2", reply_markup: ENTER_CODE_KEYBOARD }
      );
      return;
    }

    const code = text.replace(/\s/g, "").toUpperCase();

    if (isCodeUsed(code)) {
      bot.sendMessage(id,
        "❌ This M\\-Pesa code has already been used\\.\nPlease check your SMS and send the correct code\\.",
        { parse_mode: "MarkdownV2", reply_markup: ENTER_CODE_KEYBOARD }
      );
      return;
    }

    setPending(id, code); // also resets awaiting_code to 0

    // Notify admin — plain text to avoid Markdown parse errors
    const adminText =
      `🔔 New Payment Claim\n\n` +
      `👤 Name: ${fullName}\n` +
      `🆔 Username: @${username ?? "N/A"}\n` +
      `📲 Telegram ID: ${id}\n` +
      `💳 M-Pesa Code: ${code}\n` +
      `💰 Amount: KSh ${PAYMENT_AMOUNT}\n` +
      `🕐 Time: ${new Date().toLocaleString("en-KE")}\n\n` +
      `Verify on your M-Pesa statement, then approve or reject below.`;

    const keyboard = {
      inline_keyboard: [[
        { text: "✅  Approve", callback_data: `approve|${id}|${code}` },
        { text: "❌  Reject",  callback_data: `reject|${id}|${code}`  },
      ]],
    };

    try {
      await bot.sendMessage(ADMIN_ID, adminText, { reply_markup: keyboard });
    } catch (err) {
      console.error("Admin notification failed:", err.message);
    }

    bot.sendMessage(id,
      `✅ Code *${escMd(code)}* received\\!\n\nWe're verifying your payment now\\. You'll be notified shortly\\. ⏳`,
      { parse_mode: "MarkdownV2", reply_markup: PENDING_KEYBOARD }
    );
    return;
  }

  // Catch-all for unpaid users typing randomly
  setAwaitingCode(id, 0);
  bot.sendMessage(id, paymentScreen(first_name), {
    parse_mode: "MarkdownV2",
    reply_markup: PAY_KEYBOARD,
  });
});

// ─── CALLBACK: Approve / Reject ────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const adminId = query.from.id;
  if (adminId !== ADMIN_ID) {
    bot.answerCallbackQuery(query.id, { text: "❌ Not authorized.", show_alert: true });
    return;
  }

  bot.answerCallbackQuery(query.id);

  const [action, targetIdStr, code] = query.data.split("|");
  const targetId = parseInt(targetIdStr, 10);

  if (action === "approve") {
    setPaid(targetId);
    markCodeUsed(code);

    try {
      await bot.sendMessage(targetId,
        `🎉 *Payment Verified\\!*\n\nYour access is now unlocked\\. Welcome to Nova AI\\! 🚀\n\nI'm your personal assistant — ask me anything, anytime\\.`,
        { parse_mode: "MarkdownV2", reply_markup: REMOVE_KEYBOARD }
      );
    } catch (err) {
      console.error(`Could not message user ${targetId}:`, err.message);
    }

    try {
      await bot.editMessageText(
        query.message.text + "\n\n✅ Approved.",
        { chat_id: ADMIN_ID, message_id: query.message.message_id }
      );
    } catch (_) {}
  }

  if (action === "reject") {
    setUnpaid(targetId);

    try {
      await bot.sendMessage(targetId,
        `❌ *Payment Not Verified*\n\nWe couldn't confirm your payment\\. Please check:\n` +
        `• The M\\-Pesa code was correct\n` +
        `• Payment was sent to the right number\n` +
        `• Amount was KSh ${escMd(PAYMENT_AMOUNT)}\n\nTap the button below to try again\\.`,
        { parse_mode: "MarkdownV2", reply_markup: PAY_KEYBOARD }
      );
    } catch (err) {
      console.error(`Could not message user ${targetId}:`, err.message);
    }

    try {
      await bot.editMessageText(
        query.message.text + "\n\n❌ Rejected.",
        { chat_id: ADMIN_ID, message_id: query.message.message_id }
      );
    } catch (_) {}
  }
});

// ─── AI CHAT (Gemini) ──────────────────────────────────────────────────────────
async function chatWithAI(telegramId, firstName, userText) {
  bot.sendChatAction(telegramId, "typing");

  const history = getHistory(telegramId);
  saveMsg(telegramId, "user", userText);

  const geminiHistory = history.map(({ role, content }) => ({
    role:  role === "assistant" ? "model" : "user",
    parts: [{ text: content }],
  }));

  try {
    const chat   = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(userText);
    const reply  = result.response.text();

    saveMsg(telegramId, "assistant", reply);
    bot.sendMessage(telegramId, reply);

  } catch (err) {
    console.error(`AI error for user ${telegramId}:`, err.message);
    bot.sendMessage(telegramId,
      "Hmm, I ran into a small hiccup. Give me a second and try again! 🙏"
    );
  }
}

// ─── ERROR HANDLING ────────────────────────────────────────────────────────────
bot.on("polling_error", (err) => console.error("Polling error:", err.message));

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

console.log("🤖  Nova Bot is running...");
