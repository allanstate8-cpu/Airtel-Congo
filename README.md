# Nova AI — Telegram Bot (Node.js)

A Telegram bot powered by Claude AI, locked behind manual M-Pesa payment verification.

---

## 📁 Files

```
novabot-js/
├── bot.js            ← Main bot (Node.js)
├── package.json
├── .env.example      ← Config template
├── index.html        ← Landing page
└── README.md
```

---

## ⚙️ Setup

### 1. Create Your Telegram Bot

1. Open Telegram → search **@BotFather**
2. Send `/newbot` and follow the steps
3. Copy your **Bot Token**

### 2. Get Your Telegram Admin ID

1. Search **@userinfobot** on Telegram
2. Start it — it shows your numeric ID
3. Save it as `ADMIN_TELEGRAM_ID`

### 3. Get Anthropic API Key

Go to https://console.anthropic.com → create an API key

### 4. Configure

```bash
cp .env.example .env
# Then edit .env with your values
```

### 5. Install & Run

```bash
npm install
npm start

# Or for auto-restart during dev:
npm run dev
```

---

## 🔄 Payment Flow

```
User starts bot
    ↓
Bot shows M-Pesa number + instructions
    ↓
User pays and sends M-Pesa code to bot
    ↓
Bot alerts YOU with ✅ Approve / ❌ Reject buttons
    ↓
You verify on your M-Pesa statement
    ↓
Click Approve → user gets unlocked instantly
    ↓
User chats freely with Nova AI
```

---

## 👨‍💼 Admin Commands

| Command  | What it does              |
|----------|---------------------------|
| `/users` | List all registered users |
| `/stats` | See paid/pending/unpaid counts |

---

## 🛡️ Security

- M-Pesa codes are stored — **each code can only be used once**
- Users are tracked by Telegram ID
- Only the admin Telegram ID can approve/reject
- Conversations are private per user (last 12 messages sent as context)

---

## 🌐 Landing Page

Open `index.html` in a browser — or deploy free on:
- **Netlify** — drag and drop the file
- **GitHub Pages** — push to a repo

Replace `https://t.me/YourBotUsername` with your real bot link.
