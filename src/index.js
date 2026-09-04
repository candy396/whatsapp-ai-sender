const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const { initWhatsApp, getStatus: getWAStatus, logoutWhatsApp, setEventCallbacks } = require('./whatsapp');
const { generateAIMessage } = require('./ai');
const queueManager = require('./queue');
const { parseCSVBuffer, parseJSONString } = require('./csv');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Connect Socket.io to Queue Manager
queueManager.setSocketIO(io);

// Setup WhatsApp Event Callbacks for socket updates
setEventCallbacks({
  onQR: (qrCodeData) => {
    io.emit('waQR', qrCodeData);
    io.emit('waStatus', getWAStatus());
  },
  onStatusChange: (status, user) => {
    io.emit('waStatus', getWAStatus());
  },
  onLog: (msg) => {
    io.emit('systemLog', { timestamp: new Date().toLocaleTimeString(), message: msg });
  }
});

// Socket connection
io.on('connection', (socket) => {
  console.log('Web client connected:', socket.id);
  // Send initial state on connection
  socket.emit('waStatus', getWAStatus());
  socket.emit('queueProgress', queueManager.getStatus());
});

// API Routes

// 1. Get Status
app.get('/api/status', (req, res) => {
  res.json({
    whatsapp: getWAStatus(),
    queue: queueManager.getStatus()
  });
});

// 2. Parse CSV / Contacts upload
app.post('/api/parse-contacts', (req, res) => {
  upload.single('csvFile')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }
    try {
      let contacts = [];
      if (req.file) {
        contacts = await parseCSVBuffer(req.file.buffer);
      } else if (req.body && req.body.jsonContacts) {
        contacts = parseJSONString(req.body.jsonContacts);
      } else if (req.body && req.body.contactsList) {
        if (Array.isArray(req.body.contactsList)) {
          contacts = req.body.contactsList;
        } else {
          const lines = req.body.contactsList.split('\n').map(l => l.trim()).filter(Boolean);
          contacts = lines.map(line => {
            const parts = line.split(',').map(p => p.trim());
            return { phone: parts[0], name: parts[1] || '', notes: parts[2] || '' };
          });
        }
      } else {
        return res.status(400).json({ error: 'No CSV file or contact list provided.' });
      }

      res.json({ success: true, count: contacts.length, contacts });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

// 3. AI Preview
app.post('/api/preview-ai', async (req, res) => {
  try {
    const { template, clientData, promptInstruction, apiKey } = req.body;
    if (!template) {
      return res.status(400).json({ error: 'Template is required.' });
    }

    const preview = await generateAIMessage({
      template,
      clientData: clientData || { name: 'Alex Johnson', company: 'Tech Inc', notes: 'Interested in AI tools' },
      promptInstruction,
      useAI: true,
      apiKey
    });

    res.json({ success: true, preview });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Start Batch Sending (supports JSON or multipart media uploads)
app.post('/api/send-batch', (req, res) => {
  upload.single('mediaFile')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: `Media upload error: ${err.message}` });
    }
    try {
      let payload = req.body;
      if (typeof payload.contacts === 'string') {
        try { payload.contacts = JSON.parse(payload.contacts); } catch(e){}
      }

      const { contacts, template, minDelay, maxDelay, dayDistributionHours, defaultCountryCode, useAI, promptInstruction, apiKey } = payload;

      if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'Contacts list is empty or invalid.' });
      }

      if (!template && !req.file) {
        return res.status(400).json({ error: 'Message template or media attachment is required.' });
      }

      const waStatus = getWAStatus();
      if (waStatus.status !== 'CONNECTED') {
        return res.status(400).json({ error: 'WhatsApp is not connected. Please scan QR code first.' });
      }

      let media = null;
      if (req.file) {
        media = {
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          fileName: req.file.originalname
        };
      }

      queueManager.startBatch(contacts, template || '', {
        minDelay,
        maxDelay,
        dayDistributionHours: dayDistributionHours ? parseFloat(dayDistributionHours) : undefined,
        defaultCountryCode,
        useAI: useAI === undefined ? true : (useAI === 'true' || useAI === true),
        promptInstruction,
        apiKey,
        media
      });

      res.json({ success: true, message: 'Batch sending initiated.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

// 6. Logout / Reset WhatsApp session
app.post('/api/logout', async (req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ success: true, message: 'WhatsApp session cleared. Scan new QR code.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post('/api/queue/:action', (req, res) => {
  const { action } = req.params;
  try {
    if (action === 'pause') queueManager.pause();
    else if (action === 'resume') queueManager.resume();
    else if (action === 'stop') queueManager.stop();
    else return res.status(400).json({ error: 'Invalid action.' });

    res.json({ success: true, status: queueManager.getStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Global JSON error handler middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Start WhatsApp and Express Server
server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 AI WhatsApp Tool Server listening on http://localhost:${PORT}`);
  console.log(`==================================================\n`);
  
  // Initialize WhatsApp connection
  initWhatsApp();
});
