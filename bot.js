/**
 * Nova AI — Telegram Bot (Node.js)
 * M-Pesa Manual Verification + Claude AI Chat
 */

import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const {
  BOT_TOKEN,
  ADMIN_TELEGRAM_ID,
  MPESA_NUMBER   = "0712XXXXXX",
  MPESA_NAME     = "Your Name",
  PAYMENT_AMOUNT = "500",
  ANTHROPIC_API_KEY,
  BOT_PERSONALITY = `You are Nova, a warm, clever, and friendly personal AI assistant.
You speak naturally like a real person — use contractions, occasional humor,
and always address the user by their first name when you know it.
Never mention that you are an AI unless directly and persistently asked.`,
} = process.env;

const ADMIN_ID = parseInt(ADMIN_TELEGRAM_ID, 10);

if (!BOT_TOKEN || !ANTHROPIC_API_KEY || !ADMIN_ID) {
  console.error("❌  Missing required env vars. Check your .env file.");
  process.exit(1);
}

// ─── CLIENTS ───────────────────────────────────────────────────────────────────
const bot       = new TelegramBot(BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

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

console.log("✅  Database ready.");

// ─── DB HELPERS ────────────────────────────────────────────────────────────────
const stmts = {
  getUser:       db.prepare("SELECT * FROM users WHERE telegram_id = ?"),
  insertUser:    db.prepare(`
    INSERT OR IGNORE INTO users (telegram_id, username, full_name, first_name, status, created_at)
    VALUES (@telegram_id, @username, @full_name, @first_name, 'unpaid', @created_at)
  `),
  setPending:    db.prepare("UPDATE users SET status = 'pending', mpesa_code = ? WHERE telegram_id = ?"),
  setPaid:       db.prepare("UPDATE users SET status = 'paid', paid_at = ? WHERE telegram_id = ?"),
  setUnpaid:     db.prepare("UPDATE users SET status = 'unpaid', mpesa_code = NULL WHERE telegram_id = ?"),
  isCodeUsed:    db.prepare("SELECT code FROM used_codes WHERE code = ?"),
  markCodeUsed:  db.prepare("INSERT OR IGNORE INTO used_codes (code, used_at) VALUES (?, ?)"),
  saveMsg:       db.prepare("INSERT INTO chat_history (telegram_id, role, content, created_at) VALUES (?, ?, ?, ?)"),
  getHistory:    db.prepare(`
    SELECT role, content FROM chat_history
    WHERE telegram_id = ?
    ORDER BY created_at DESC
    LIMIT 12
  `),
  allUsers:      db.prepare("SELECT full_name, username, status, created_at FROM users ORDER BY created_at DESC LIMIT 30"),
  statsByStatus: db.prepare("SELECT status, COUNT(*) as count FROM users GROUP BY status"),
};

const getUser      = (id)                => stmts.getUser.get(id);
const createUser   = (id, uname, full, first) =>
  stmts.insertUser.run({ telegram_id: id, username: uname, full_name: full, first_name: first, created_at: now() });
const setPending   = (id, code)          => stmts.setPending.run(code.toUpperCase(), id);
const setPaid      = (id)                => stmts.setPaid.run(now(), id);
const setUnpaid    = (id)                => stmts.setUnpaid.run(id);
const isCodeUsed   = (code)              => !!stmts.isCodeUsed.get(code.toUpperCase());
const markCodeUsed = (code)              => stmts.markCodeUsed.run(code.toUpperCase(), now());
const saveMsg      = (id, role, content) => stmts.saveMsg.run(id, role, content, now());
const getHistory   = (id)                => stmts.getHistory.all(id).reverse(); // oldest first
const now          = ()                  => new Date().toISOString();

// ─── HELPERS ───────────────────────────────────────────────────────────────────
const isMpesaCode = (text) =>
  /^[A-Z0-9]{8,15}$/i.test(text.replace(/\s/g, ""));

const paymentPrompt = (firstName) =>
  `👋 Hey *${firstName}!*\n\n` +
  `Welcome to *Nova AI* — your personal AI assistant.\n\n` +
  `━━━━━━━━━━━━━━━━━━━━━━\n` +
  `💳 *Unlock Access*\n` +
  `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
  `Send *KSh ${PAYMENT_AMOUNT}* via M\\-Pesa:\n\n` +
  `📱 *Till/Number:* \`${MPESA_NUMBER}\`\n` +
  `👤 *Name:* ${MPESA_NAME}\n\n` +
  `After paying, *send your M\\-Pesa confirmation code* here\\.\n` +
  `_Example: \`RG47XY1234\`_\n\n` +
  `⚡ Access is activated within minutes\\.`;

// ─── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(" ");

  createUser(id, username, fullName, first_name);
  const user = getUser(id);

  if (user.status === "paid") {
    bot.sendMessage(id,
      `Welcome back, *${first_name}\\!* 🎉\n\nI'm ready — what would you like to talk about?`,
      { parse_mode: "MarkdownV2" }
    );
  } else if (user.status === "pending") {
    bot.sendMessage(id,
      `⏳ Hi *${first_name}\\!* Your payment is being reviewed\\. Please hang tight\\.`,
      { parse_mode: "MarkdownV2" }
    );
  } else {
    bot.sendMessage(id, paymentPrompt(first_name), { parse_mode: "MarkdownV2" });
  }
});

// ─── /users (admin) ────────────────────────────────────────────────────────────
bot.onText(/\/users/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const users = stmts.allUsers.all();
  if (!users.length) return bot.sendMessage(ADMIN_ID, "No users yet.");

  const emap = { paid: "✅", pending: "⏳", unpaid: "🔒" };
  const lines = ["👥 *All Users:*\n"];
  for (const { full_name, username, status } of users) {
    lines.push(`${emap[status] ?? "❓"} ${full_name} (@${username ?? "N/A"}) — _${status}_`);
  }
  bot.sendMessage(ADMIN_ID, lines.join("\n"), { parse_mode: "Markdown" });
});

// ─── /stats (admin) ────────────────────────────────────────────────────────────
bot.onText(/\/stats/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const rows  = stmts.statsByStatus.all();
  const total = rows.reduce((s, r) => s + r.count, 0);
  const emap  = { paid: "✅", pending: "⏳", unpaid: "🔒" };
  const lines = [`📊 *Bot Stats*\n\nTotal users: *${total}*\n`];
  for (const { status, count } of rows) {
    lines.push(`${emap[status] ?? "❓"} ${status}: *${count}*`);
  }
  bot.sendMessage(ADMIN_ID, lines.join("\n"), { parse_mode: "Markdown" });
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
    bot.sendMessage(id,
      "⏳ Your payment is still being verified. Please be patient — the admin will approve shortly."
    );
    return;
  }

  // ── UNPAID: check if they sent an M-Pesa code ─────────────────────────────
  if (isMpesaCode(text)) {
    const code = text.replace(/\s/g, "").toUpperCase();

    if (isCodeUsed(code)) {
      bot.sendMessage(id,
        "❌ This M-Pesa code has already been used.\nPlease check your SMS and send the correct code."
      );
      return;
    }

    setPending(id, code);

    // Notify admin
    const adminText =
      `🔔 *New Payment Claim*\n\n` +
      `👤 *Name:* ${fullName}\n` +
      `🆔 *Username:* @${username ?? "N/A"}\n` +
      `📲 *Telegram ID:* \`${id}\`\n` +
      `💳 *M-Pesa Code:* \`${code}\`\n` +
      `💰 *Amount:* KSh ${PAYMENT_AMOUNT}\n` +
      `🕐 *Time:* ${new Date().toLocaleString("en-KE")}\n\n` +
      `Verify on your M-Pesa statement, then approve or reject below.`;

    const keyboard = {
      inline_keyboard: [[
        { text: "✅  Approve", callback_data: `approve|${id}|${code}` },
        { text: "❌  Reject",  callback_data: `reject|${id}|${code}`  },
      ]],
    };

    try {
      await bot.sendMessage(ADMIN_ID, adminText, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error("Admin notification failed:", err.message);
    }

    bot.sendMessage(id,
      `✅ Code *${code}* received\\!\n\n` +
      `We're verifying your payment now\\. You'll be notified as soon as it's confirmed\\. ⏳`,
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  // ── UNPAID, no code ────────────────────────────────────────────────────────
  bot.sendMessage(id, paymentPrompt(first_name), { parse_mode: "MarkdownV2" });
});

// ─── CALLBACK: Approve / Reject ────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const adminId = query.from.id;
  if (adminId !== ADMIN_ID) {
    bot.answerCallbackQuery(query.id, { text: "❌ Not authorized.", show_alert: true });
    return;
  }

  bot.answerCallbackQuery(query.id);

  // FIX: Use "|" as separator so M-Pesa codes with underscores don't break parsing
  const [action, targetIdStr, code] = query.data.split("|");
  const targetId = parseInt(targetIdStr, 10);
  const suffix   = action === "approve" ? "\n\n✅ *Approved by admin.*" : "\n\n❌ *Rejected by admin.*";

  // ── APPROVE ────────────────────────────────────────────────────────────────
  if (action === "approve") {
    setPaid(targetId);
    markCodeUsed(code);

    try {
      await bot.sendMessage(targetId,
        `🎉 *Payment Verified\\!*\n\n` +
        `Your access is now unlocked\\. Welcome to Nova AI\\! 🚀\n\n` +
        `I'm your personal assistant — ask me anything, anytime\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      console.error(`Could not message user ${targetId}:`, err.message);
    }
  }

  // ── REJECT ─────────────────────────────────────────────────────────────────
  if (action === "reject") {
    setUnpaid(targetId);

    try {
      await bot.sendMessage(targetId,
        `❌ *Payment Not Verified*\n\n` +
        `We couldn't confirm your payment\\. Please check:\n` +
        `• The M-Pesa code was entered correctly\n` +
        `• Payment was sent to the right number\n` +
        `• The amount was KSh ${PAYMENT_AMOUNT}\n\n` +
        `Try again or contact support\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      console.error(`Could not message user ${targetId}:`, err.message);
    }
  }

  // Update admin message
  try {
    await bot.editMessageText(
      query.message.text + suffix,
      {
        chat_id:    ADMIN_ID,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (_) {}
});

// ─── AI CHAT ───────────────────────────────────────────────────────────────────
async function chatWithAI(telegramId, firstName, userText) {
  bot.sendChatAction(telegramId, "typing");

  // Get history BEFORE saving the new message to avoid duplicate user turn
  const history = getHistory(telegramId);

  // Save new user message
  saveMsg(telegramId, "user", userText);

  // Build messages array: history + new user message
  const messages = [
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: userText },
  ];

  try {
    const response = await anthropic.messages.create({
      model:      "claude-sonnet-4-5",   // FIX: corrected model name
      max_tokens: 1000,
      system:     BOT_PERSONALITY,
      messages,
    });

    const reply = response.content[0].text;
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
