const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

const accounts = new Map();

let eventCallbacks = {
  onQR: () => {},
  onStatusChange: () => {},
  onAccountsUpdate: () => {},
  onLog: () => {}
};

function setEventCallbacks(callbacks) {
  eventCallbacks = { ...eventCallbacks, ...callbacks };
}

function getSessionsRootDir() {
  const dir = path.join(__dirname, '../data/sessions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function migrateLegacySessionIfNeeded() {
  const rootDir = getSessionsRootDir();
  const legacyCreds = path.join(rootDir, 'creds.json');
  if (fs.existsSync(legacyCreds)) {
    const acc1Dir = path.join(rootDir, 'acc_1');
    if (!fs.existsSync(acc1Dir)) {
      fs.mkdirSync(acc1Dir, { recursive: true });
    }
    const files = fs.readdirSync(rootDir);
    for (const file of files) {
      const fullPath = path.join(rootDir, file);
      if (fs.statSync(fullPath).isFile()) {
        try {
          fs.renameSync(fullPath, path.join(acc1Dir, file));
        } catch (e) {
          console.error(`Failed to move ${file} to acc_1:`, e.message);
        }
      }
    }
    console.log('Migrated legacy WhatsApp session to acc_1');
  }
}

async function initAccount(accountId, label) {
  const rootDir = getSessionsRootDir();
  const sessionPath = path.join(rootDir, accountId);
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  const accountNum = accountId.replace(/[^0-9]/g, '') || accountId;
  const accountLabel = label || `Account ${accountNum}`;

  let acc = accounts.get(accountId);
  if (!acc) {
    acc = {
      id: accountId,
      name: accountLabel,
      sessionPath,
      sock: null,
      connectionStatus: 'DISCONNECTED',
      qrCodeData: null,
      userInfo: null
    };
    accounts.set(accountId, acc);
  } else {
    acc.name = accountLabel;
  }

  if (acc.sock) {
    try { acc.sock.ev.removeAllListeners(); } catch (e) {}
    try { acc.sock.end(undefined); } catch (e) {}
    acc.sock = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  let version;
  try {
    const versionRes = await fetchLatestBaileysVersion();
    version = versionRes.version;
  } catch (e) {
    console.warn('Could not fetch latest Baileys version, using fallback:', e.message);
    version = [2, 3000, 1015901307];
  }

  acc.connectionStatus = 'CONNECTING';
  eventCallbacks.onLog(`[${acc.name}] Connecting to WhatsApp...`);
  notifyAccountsUpdate();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.macOS(`Desktop-${accountId}`)
  });

  acc.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.update', (updates) => {
    for (const update of updates) {
      if (update.update && update.update.status) {
        const statusVal = update.update.status;
        const statusText = statusVal === 2 ? 'Sent to WhatsApp Server' : statusVal === 3 ? 'Delivered to Recipient Phone' : statusVal === 4 ? 'Read by Recipient' : `Status Code ${statusVal}`;
        if (statusVal >= 2) {
          eventCallbacks.onLog(`[Delivery ACK - ${acc.name}] Message ${update.key.id} -> ${statusText}`, 'success');
        }
      }
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      acc.qrCodeData = await QRCode.toDataURL(qr);
      acc.connectionStatus = 'QR_READY';
      qrcodeTerminal.generate(qr, { small: true });
      eventCallbacks.onLog(`[${acc.name}] QR Code ready. Please scan with WhatsApp.`);
      eventCallbacks.onQR(accountId, acc.qrCodeData);
      notifyAccountsUpdate();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isLoggedOut;

      acc.connectionStatus = 'DISCONNECTED';
      acc.qrCodeData = null;
      acc.userInfo = null;
      notifyAccountsUpdate();
      eventCallbacks.onLog(`[${acc.name}] Connection closed: ${lastDisconnect?.error?.message || statusCode || 'Unknown'}. Reconnecting: ${shouldReconnect}`);

      if (isLoggedOut) {
        eventCallbacks.onLog(`[${acc.name}] Session logged out. Clearing session files...`, 'warning');
        try {
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
          }
        } catch (e) {
          console.error(`[${acc.name}] Error clearing session path:`, e.message);
        }
        setTimeout(() => initAccount(accountId, accountLabel), 1500);
      } else if (shouldReconnect) {
        setTimeout(() => initAccount(accountId, accountLabel), 3000);
      }
    } else if (connection === 'open') {
      acc.connectionStatus = 'CONNECTED';
      acc.qrCodeData = null;
      const rawUser = sock.user;
      const userPhone = rawUser?.id ? rawUser.id.split(':')[0] : '';
      const userName = rawUser?.name || userPhone || acc.name;

      acc.userInfo = {
        id: rawUser?.id || '',
        phone: userPhone,
        name: userName
      };
      eventCallbacks.onLog(`[${acc.name}] Connected as ${acc.userInfo.name} (${acc.userInfo.phone})`, 'success');
      notifyAccountsUpdate();
    }
  });

  return sock;
}

async function initAllAccounts() {
  migrateLegacySessionIfNeeded();
  const rootDir = getSessionsRootDir();
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const accountDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  if (accountDirs.length === 0) {
    accountDirs.push('acc_1');
  }

  for (const accDir of accountDirs) {
    const numMatch = accDir.match(/\d+/);
    const label = numMatch ? `Account ${numMatch[0]}` : accDir;
    await initAccount(accDir, label);
  }
}

async function addNewAccount() {
  const rootDir = getSessionsRootDir();
  let maxId = 0;

  for (const [id] of accounts) {
    const match = id.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      if (num > maxId) maxId = num;
    }
  }

  if (fs.existsSync(rootDir)) {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (num > maxId) maxId = num;
        }
      }
    }
  }

  const newId = `acc_${maxId + 1}`;
  const newLabel = `Account ${maxId + 1}`;
  await initAccount(newId, newLabel);
  notifyAccountsUpdate();
  return getAccountStatus(newId);
}

async function logoutAccount(accountId) {
  const acc = accounts.get(accountId);
  if (!acc) return false;

  if (acc.sock) {
    try { await acc.sock.logout(); } catch(e){}
    try { acc.sock.end(undefined); } catch(e){}
    acc.sock = null;
  }
  acc.connectionStatus = 'DISCONNECTED';
  acc.qrCodeData = null;
  acc.userInfo = null;

  if (fs.existsSync(acc.sessionPath)) {
    try { fs.rmSync(acc.sessionPath, { recursive: true, force: true }); } catch(e){}
  }

  eventCallbacks.onLog(`[${acc.name}] Session cleared. Resetting for fresh QR...`, 'warning');
  notifyAccountsUpdate();

  setTimeout(() => {
    initAccount(accountId, acc.name);
  }, 1000);

  return true;
}

async function removeAccount(accountId) {
  const acc = accounts.get(accountId);
  if (!acc) return false;

  if (acc.sock) {
    try { await acc.sock.logout(); } catch(e){}
    try { acc.sock.end(undefined); } catch(e){}
    acc.sock = null;
  }

  if (fs.existsSync(acc.sessionPath)) {
    try { fs.rmSync(acc.sessionPath, { recursive: true, force: true }); } catch(e){}
  }

  accounts.delete(accountId);
  eventCallbacks.onLog(`[${acc.name}] Removed WhatsApp account.`, 'warning');
  notifyAccountsUpdate();
  return true;
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
 * Send message via specified accountId (or fallback to any connected account)
 */
async function sendMessage(accountIdOrPhone, phoneNumber, text, media = null) {
  let accountId = accountIdOrPhone;
  let targetPhone = phoneNumber;
  let msgText = text;

  // Handle signature overloading if accountId was omitted: sendMessage(phone, text, media)
  if (typeof targetPhone === 'string' && typeof msgText === 'undefined' && media === null) {
    msgText = targetPhone;
    targetPhone = accountIdOrPhone;
    accountId = null;
  } else if (typeof msgText === 'undefined' || (targetPhone && typeof targetPhone === 'object')) {
    // Legacy call: sendMessage(phoneNumber, text, media)
    media = text;
    msgText = targetPhone;
    targetPhone = accountIdOrPhone;
    accountId = null;
  }

  let acc = accountId ? accounts.get(accountId) : null;

  if (!acc || acc.connectionStatus !== 'CONNECTED') {
    const connected = getConnectedAccounts();
    if (connected.length === 0) {
      throw new Error('No WhatsApp account is connected. Please scan QR code for at least one account!');
    }
    acc = accounts.get(connected[0].id);
  }

  const digits = String(targetPhone || '').replace(/[^0-9]/g, '');
  if (!digits || digits.length < 7) {
    throw new Error(`Invalid phone number "${targetPhone}". Please include international country code (e.g. +91... or +1...).`);
  }

  let targetJid = `${digits}@s.whatsapp.net`;

  // Typing simulation
  try {
    await acc.sock.sendPresenceUpdate('composing', targetJid);
    const typingTimeMs = Math.floor(Math.random() * 1000) + 800;
    await new Promise(res => setTimeout(res, typingTimeMs));
    await acc.sock.sendPresenceUpdate('paused', targetJid);
  } catch (e) {}

  let messagePayload = { text: (msgText || '').trim() };

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
      if (msgText && msgText.trim()) messagePayload.caption = msgText.trim();
    } else if (isVideo) {
      messagePayload = {
        video: mediaBuffer,
        mimetype: 'video/mp4'
      };
      if (msgText && msgText.trim()) messagePayload.caption = msgText.trim();
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
      const docMime = media.mimetype && media.mimetype !== 'application/octet-stream' ? media.mimetype : 'application/pdf';
      messagePayload = {
        document: mediaBuffer,
        mimetype: docMime,
        fileName: media.fileName || 'document.pdf'
      };
      if (msgText && msgText.trim()) messagePayload.caption = msgText.trim();
    }

    const sent = await acc.sock.sendMessage(targetJid, messagePayload);
    eventCallbacks.onLog(`[${acc.name}] Delivered media to ${targetJid} (Msg ID: ${sent?.key?.id || 'OK'})`, 'success');
    return sent;
  }

  const sent = await acc.sock.sendMessage(targetJid, messagePayload);
  eventCallbacks.onLog(`[${acc.name}] Delivered to ${targetJid} (Msg ID: ${sent?.key?.id || 'OK'})`, 'success');
  return sent;
}

function getAccountStatus(accountId) {
  const acc = accounts.get(accountId);
  if (!acc) return null;
  return {
    id: acc.id,
    name: acc.name,
    status: acc.connectionStatus,
    qrCode: acc.qrCodeData,
    user: acc.userInfo
  };
}

function getAllAccountsStatus() {
  const list = [];
  for (const acc of accounts.values()) {
    list.push({
      id: acc.id,
      name: acc.name,
      status: acc.connectionStatus,
      qrCode: acc.qrCodeData,
      user: acc.userInfo
    });
  }
  return list;
}

function getConnectedAccounts() {
  return getAllAccountsStatus().filter(a => a.status === 'CONNECTED');
}

function getStatus() {
  const connected = getConnectedAccounts();
  return {
    status: connected.length > 0 ? 'CONNECTED' : 'DISCONNECTED',
    accounts: getAllAccountsStatus(),
    connectedCount: connected.length
  };
}

function notifyAccountsUpdate() {
  const list = getAllAccountsStatus();
  if (eventCallbacks.onAccountsUpdate) eventCallbacks.onAccountsUpdate(list);
  if (eventCallbacks.onStatusChange) eventCallbacks.onStatusChange(getStatus());
}

async function logoutWhatsApp() {
  for (const [id] of accounts.keys()) {
    await logoutAccount(id);
  }
  return true;
}

module.exports = {
  initAccount,
  initAllAccounts,
  addNewAccount,
  logoutAccount,
  removeAccount,
  sendMessage,
  getStatus,
  getAccountStatus,
  getAllAccountsStatus,
  getConnectedAccounts,
  setEventCallbacks,
  formatJID,
  logoutWhatsApp
};
