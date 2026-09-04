# WhatsApp AI Message Dispatcher

An AI-powered tool that sends personalized WhatsApp messages to your clients directly from your personal or WhatsApp Business account, without any fixed timing restrictions or official Meta template limitations.

---

## 🌟 Key Features

1. **Direct WhatsApp Connection (Baileys WebSocket)**:
   - Links directly to your WhatsApp via QR code scan (once authenticated, session is saved in `data/sessions/`).
   - Send directly from your number to any client without fixed template restrictions or timing boundations.

2. **AI Personalization & Dynamic Formatting**:
   - Integrates with **OpenAI (GPT-4o-mini / custom models)**.
   - Automatically personalizes base templates using client variables (e.g. `{name}`, `{company}`, `{notes}`).
   - Re-words and adapts messages per client to prevent duplicate/spam detection on WhatsApp.

3. **Smart Queue & Anti-Ban Rate Limiting**:
   - Customizable random delay intervals (e.g., 5 to 15 seconds) between messages.
   - Live queue status (Sent, Pending, Failed) with Pause, Resume, and Stop controls.

4. **Multiple Contact Input Methods**:
   - Upload CSV files with column headers (`phone`, `name`, `company`, `notes`, etc.).
   - Directly paste phone numbers list.

5. **Modern Web Dashboard & Real-Time Logs**:
   - Clean UI built with Tailwind CSS & Socket.io for live updates, QR code scanning, and live log monitoring.

---

## 📁 Project Structure

```
whatsapp-ai-sender/
├── package.json
├── .env.example
├── README.md
├── data/
│   └── contacts.sample.csv      # Sample CSV contact file
└── src/
    ├── index.js                 # Express server & socket.io entry
    ├── whatsapp.js              # Baileys WhatsApp client & auth manager
    ├── ai.js                    # OpenAI message generation & template logic
    ├── queue.js                 # Message dispatch queue with anti-ban delays
    ├── csv.js                   # CSV file parsing helper
    └── public/
        ├── index.html           # Web Dashboard UI
        └── app.js               # Frontend interactive logic & websockets
```

---

## 🚀 Quick Start Guide

### 1. Installation

Navigate into the project folder:
```bash
cd whatsapp-ai-sender
npm install
```

### 2. Configure Environment Variables (Optional)

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Add your **OpenAI API Key** inside `.env`:
```env
OPENAI_API_KEY=sk-your-openai-api-key-here
PORT=3000
MIN_DELAY_SECONDS=5
MAX_DELAY_SECONDS=15
```
*(Note: If no OpenAI API key is provided, the tool will still send messages using template variable substitution like `{name}` and `{company}`).*

### 3. Start the Server

```bash
npm start
```

Then open your browser at:
👉 **`http://localhost:3000`**

---

## 📲 How to Use

1. **Link WhatsApp**:
   - When you open `http://localhost:3000`, a QR Code will appear on the dashboard (and in terminal).
   - Open WhatsApp on your phone -> Go to **Settings / Linked Devices** -> Tap **Link a Device** and scan the QR code.
   - Once connected, your status will change to `Connected` with your user profile name.

2. **Load Contacts**:
   - Click **Upload CSV** and select your file (e.g. `data/contacts.sample.csv`), OR paste phone numbers directly.

3. **Compose & Personalize Message**:
   - Type your template text using placeholders like `Hi {name}, regarding {notes}, we'd love to connect!`.
   - Click **Preview AI Output** to check how AI tailors the message.

4. **Set Delays & Dispatch**:
   - Adjust Min & Max delay (e.g., 5-15 seconds).
   - Click **Start Sending Messages**. Monitor live progress, logs, and statuses in real time.
