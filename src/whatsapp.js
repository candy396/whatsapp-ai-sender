const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

let sock = null;
let qrCodeData = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED
let userInfo = null;
let eventCallbacks = {
  onQR: () => {},
  onStatusChange: () => {},
  onLog: () => {}
};

function setEventCallbacks(callbacks) {
  eventCallbacks = { ...eventCallbacks, ...callbacks };
}

async function initWhatsApp(sessionPath = path.join(__dirname, '../data/sessions')) {
  try {
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    if (sock) {
      try { sock.ev.removeAllListeners(); } catch (e) {}
      try { sock.end(undefined); } catch (e) {}
      sock = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    let version;
    try {
      const versionRes = await fetchLatestBaileysVersion();
      version = versionRes.version;
    } catch (e) {
      console.warn('Could not fetch latest Baileys version, using default fallback:', e.message);
      version = [2, 3000, 1015901307];
    }

    eventCallbacks.onLog('Connecting to WhatsApp...');
    connectionStatus = 'CONNECTING';
    eventCallbacks.onStatusChange(connectionStatus);

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        if (update.update && update.update.status) {
          const statusVal = update.update.status;
          const statusText = statusVal === 2 ? 'Sent to WhatsApp Server' : statusVal === 3 ? 'Delivered to Recipient Phone' : statusVal === 4 ? 'Read by Recipient' : `Status Code ${statusVal}`;
          if (statusVal >= 2) {
            eventCallbacks.onLog(`[Delivery ACK] Message ${update.key.id} -> ${statusText}`, 'success');
          }
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeData = await QRCode.toDataURL(qr);
        connectionStatus = 'QR_READY';
        qrcodeTerminal.generate(qr, { small: true });
        eventCallbacks.onLog('QR Code received. Please scan with WhatsApp.');
        eventCallbacks.onQR(qrCodeData);
        eventCallbacks.onStatusChange(connectionStatus);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isLoggedOut;

        connectionStatus = 'DISCONNECTED';
        qrCodeData = null;
        userInfo = null;
        eventCallbacks.onStatusChange(connectionStatus);
        eventCallbacks.onLog(`Connection closed due to: ${lastDisconnect?.error?.message || statusCode || 'Unknown'}. Reconnecting: ${shouldReconnect}`);

        if (isLoggedOut) {
          eventCallbacks.onLog('Session logged out or invalidated. Purging session and generating fresh QR code...', 'warning');
          try {
            if (fs.existsSync(sessionPath)) {
              fs.rmSync(sessionPath, { recursive: true, force: true });
            }
          } catch (e) {
            console.error('Failed to clear session path:', e);
          }
          setTimeout(() => initWhatsApp(sessionPath), 1500);
        } else if (shouldReconnect) {
          setTimeout(() => initWhatsApp(sessionPath), 3000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'CONNECTED';
        qrCodeData = null;
        userInfo = {
          id: sock.user.id,
          name: sock.user.name || 'WhatsApp User'
        };
        eventCallbacks.onLog(`Successfully connected to WhatsApp as ${userInfo.name} (${userInfo.id})`);
        eventCallbacks.onStatusChange(connectionStatus, userInfo);
      }
    });

    return sock;
  } catch (error) {
    console.error('Error initializing WhatsApp socket:', error);
    eventCallbacks.onLog(`WhatsApp Connection Error: ${error.message}`);
    connectionStatus = 'DISCONNECTED';
    eventCallbacks.onStatusChange(connectionStatus);
  }
}

/**
 * Format phone number to digits-only JID
 */
function formatJID(phoneNumber) {
  let cleaned = String(phoneNumber || '').replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  if (!cleaned.endsWith('@s.whatsapp.net')) {
    cleaned = `${cleaned}@s.whatsapp.net`;
  }
  return cleaned;
}

/**
 * Send message (text, image, or video) to a specific number with typing simulation and fallback
 */
async function sendMessage(phoneNumber, text, media = null) {
  if (!sock || connectionStatus !== 'CONNECTED') {
    throw new Error('WhatsApp is NOT connected. Please scan the QR code first!');
  }

  const digits = String(phoneNumber || '').replace(/[^0-9]/g, '');
  if (!digits || digits.length < 7) {
    throw new Error(`Invalid phone number "${phoneNumber}". Please include international country code (e.g. +91... or +1...).`);
  }

  let targetJid = `${digits}@s.whatsapp.net`;

  // Verify on WhatsApp network
  try {
    const results = await sock.onWhatsApp(digits);
    if (results && results.length > 0 && results[0].exists) {
      targetJid = results[0].jid;
      eventCallbacks.onLog(`Verified +${digits} exists on WhatsApp (${targetJid})`);
    } else {
      throw new Error(`Phone number +${digits} is NOT registered on WhatsApp or country code is missing/invalid.`);
    }
  } catch (e) {
    if (e.message.includes('NOT registered')) {
      throw e;
    }
    console.warn(`onWhatsApp check warning for ${digits}:`, e.message);
  }

  // Check if sending to self
  const senderNumber = sock.user?.id ? sock.user.id.split(':')[0].replace(/[^0-9]/g, '') : '';
  const isSelf = senderNumber && (digits === senderNumber || targetJid.startsWith(senderNumber));
  if (isSelf) {
    eventCallbacks.onLog(`ℹ️ Sending test message to your OWN WhatsApp number (+${digits}). Note: Self-messages appear under the "(You)" / "Message Yourself" chat on WhatsApp, without triggering an incoming push notification.`, 'warning');
  }

  // Simulate human typing presence
  try {
    await sock.sendPresenceUpdate('composing', targetJid);
    const typingTimeMs = Math.floor(Math.random() * 1000) + 1000;
    await new Promise(res => setTimeout(res, typingTimeMs));
    await sock.sendPresenceUpdate('paused', targetJid);
  } catch (e) {
    // Ignore presence errors
  }

  // Build payload based on media attachment type
  let messagePayload = { text: text || '' };

  if (media && (media.buffer || media.path)) {
    let mediaBuffer = null;

    if (media.path && fs.existsSync(media.path)) {
      mediaBuffer = fs.readFileSync(media.path);
    } else if (media.buffer) {
      if (Buffer.isBuffer(media.buffer)) {
        mediaBuffer = media.buffer;
      } else if (media.buffer.data) {
        mediaBuffer = Buffer.from(media.buffer.data);
      } else {
        mediaBuffer = Buffer.from(media.buffer);
      }
    }

    if (!mediaBuffer || !mediaBuffer.length) {
      throw new Error('Media attachment file content is empty or invalid.');
    }

    const mime = (media.mimetype || '').toLowerCase();
    const fileName = (media.fileName || '').toLowerCase();

    const isImage = mime.startsWith('image/') ||
      /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|svg)$/i.test(fileName);
    const isVideo = mime.startsWith('video/') ||
      /\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/i.test(fileName);
    const isAudio = mime.startsWith('audio/') ||
      /\.(mp3|ogg|wav|m4a|aac|opus|flac)$/i.test(fileName);

    if (isImage) {
      let imageMime = 'image/jpeg';
      if (mime.includes('png') || fileName.endsWith('.png')) {
        imageMime = 'image/png';
      }
      messagePayload = {
        image: mediaBuffer,
        mimetype: imageMime
      };
      if (text && text.trim()) messagePayload.caption = text.trim();
    } else if (isVideo) {
      messagePayload = {
        video: mediaBuffer,
        mimetype: 'video/mp4'
      };
      if (text && text.trim()) messagePayload.caption = text.trim();
    } else if (isAudio) {
      let audioMime = 'audio/mp4';
      if (mime.includes('ogg') || fileName.endsWith('.ogg')) {
        audioMime = 'audio/ogg; codecs=opus';
      }
      messagePayload = {
        audio: mediaBuffer,
        mimetype: audioMime,
        ptt: false
      };
    } else {
      // General document fallback (PDF, DOCX, ZIP, etc.)
      const docMime = media.mimetype && media.mimetype !== 'application/octet-stream' ? media.mimetype : 'application/pdf';
      messagePayload = {
        document: mediaBuffer,
        mimetype: docMime,
        fileName: media.fileName || 'document.pdf'
      };
      if (text && text.trim()) messagePayload.caption = text.trim();
    }

    const sent = await sock.sendMessage(targetJid, messagePayload);
    eventCallbacks.onLog(`Successfully delivered media to ${targetJid} (Message ID: ${sent?.key?.id || 'OK'})`, 'success');
    return sent;
  }

  // Send text-only message
  const sent = await sock.sendMessage(targetJid, messagePayload);
  eventCallbacks.onLog(`Successfully delivered to ${targetJid} (Message ID: ${sent?.key?.id || 'OK'})`, 'success');
  return sent;
  return sent;
}

async function logoutWhatsApp() {
  try {
    if (sock) {
      try { await sock.logout(); } catch(e){}
      try { sock.end(undefined); } catch(e){}
      sock = null;
    }
    connectionStatus = 'DISCONNECTED';
    qrCodeData = null;
    userInfo = null;

    const sessionPath = path.join(__dirname, '../data/sessions');
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    eventCallbacks.onLog('Session cleared. Resetting WhatsApp connection for fresh QR code...', 'warning');
    eventCallbacks.onStatusChange(connectionStatus);

    setTimeout(() => {
      initWhatsApp();
    }, 1500);

    return true;
  } catch (error) {
    console.error('Error during logout:', error);
    throw error;
  }
}

function getStatus() {
  return {
    status: connectionStatus,
    qrCode: qrCodeData,
    user: userInfo
  };
}

module.exports = {
  initWhatsApp,
  sendMessage,
  logoutWhatsApp,
  getStatus,
  setEventCallbacks,
  formatJID
};
