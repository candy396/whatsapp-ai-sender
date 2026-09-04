# Deployment Guide: WhatsApp AI Sender

WhatsApp Baileys and the background queue require a **persistent Node.js process** maintaining an active WebSocket connection and persistent disk storage for WhatsApp session keys (`data/session`).

---

## Option 1: Deploy on Render (Recommended - Free Persistent Disk Support)

1. Push your repository to GitHub / GitLab.
2. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** -> **Blueprint**.
3. Connect your GitHub repository containing this code.
4. Render will automatically detect `render.yaml`:
   - It will attach a 1GB **Persistent Disk** mounted at `/app/data` (so your WhatsApp QR scan persists across restarts).
   - Set environment variables (`OPENAI_API_KEY`, etc.) if desired.
5. Click **Apply**. Once deployed, Render provides a public `https://...onrender.com` URL.

---

## Option 2: Deploy on Railway

1. Push your repository to GitHub.
2. Go to [Railway.app](https://railway.app/) and click **New Project** -> **Deploy from GitHub repo**.
3. Select your repository.
4. Go to project **Settings** -> **Volumes** -> Add Volume mounted at `/app/data`.
5. Under **Networking**, click **Generate Domain** to get your public HTTPS URL.

---

## Option 3: Docker / VPS (DigitalOcean, AWS EC2, Linode)

Run using Docker:

```bash
# Build Docker image
docker build -t whatsapp-ai-sender .

# Run with persistent data volume
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --name whatsapp-sender \
  whatsapp-ai-sender
```
