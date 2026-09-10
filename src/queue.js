const { sendMessage, getConnectedAccounts } = require('./whatsapp');
const { generateAIMessage } = require('./ai');

function extractPhone(clientObj) {
  if (!clientObj) return null;
  if (typeof clientObj === 'string') return clientObj;
  
  const priorityKeys = ['phone', 'number', 'mobile', 'whatsapp', 'contact', 'tele', 'cell', 'phone_number', 'mobile_number'];
  for (const k of priorityKeys) {
    if (clientObj[k]) return String(clientObj[k]);
  }

  for (const [key, val] of Object.entries(clientObj)) {
    if (!val) continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('phone') || lowerKey.includes('num') || lowerKey.includes('mobile') || lowerKey.includes('contact') || lowerKey.includes('whatsapp')) {
      return String(val);
    }
  }

  for (const val of Object.values(clientObj)) {
    if (val && String(val).replace(/[^0-9]/g, '').length >= 7) {
      return String(val);
    }
  }

  return null;
}

class QueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.isPaused = false;
    this.currentIndex = 0;
    this.timerId = null;
    this.config = {
      minDelay: parseInt(process.env.MIN_DELAY_SECONDS || 5, 10),
      maxDelay: parseInt(process.env.MAX_DELAY_SECONDS || 15, 10),
      useAI: true,
      promptInstruction: '',
      apiKey: null
    };
    this.io = null;
  }

  setSocketIO(io) {
    this.io = io;
  }

  emit(event, data) {
    if (this.io) this.io.emit(event, data);
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.emit('queueLog', { timestamp, message, type });
  }

  startBatch(items, template, options = {}) {
    if (this.isRunning) {
      throw new Error('A batch sending process is already running.');
    }

    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    this.queue = items.map((item, index) => ({
      id: index + 1,
      client: item,
      template: template,
      status: 'PENDING', // PENDING, PROCESSING, SENT, FAILED
      sentAt: null,
      generatedMessage: null,
      error: null
    }));

    // Calculate smart delay if Day Distribution mode is requested
    let minDelaySec = options.minDelay !== undefined ? parseInt(options.minDelay, 10) : (parseInt(process.env.MIN_DELAY_SECONDS, 10) || 5);
    let maxDelaySec = options.maxDelay !== undefined ? parseInt(options.maxDelay, 10) : (parseInt(process.env.MAX_DELAY_SECONDS, 10) || 15);

    if (options.dayDistributionHours && options.dayDistributionHours > 0) {
      const totalSecondsInWindow = options.dayDistributionHours * 3600;
      const totalItems = Math.max(1, items.length);
      const avgGapSec = totalSecondsInWindow / totalItems;
      minDelaySec = Math.max(10, Math.floor(avgGapSec * 0.65)); // 65% of average gap
      maxDelaySec = Math.floor(avgGapSec * 1.35); // 135% of average gap
    }

    this.config = {
      minDelay: minDelaySec,
      maxDelay: maxDelaySec,
      defaultCountryCode: options.defaultCountryCode || process.env.DEFAULT_COUNTRY_CODE || '91',
      useAI: options.useAI !== undefined ? options.useAI : true,
      promptInstruction: options.promptInstruction || '',
      apiKey: options.apiKey || null,
      media: options.media || null, // { buffer/path, mimetype, fileName }
      batchBreakEvery: options.batchBreakEvery || 20, // Pause after every 20 messages
      batchBreakDurationMin: options.batchBreakDurationMin || 10 // Pause for 10-15 minutes
    };

    this.currentIndex = 0;
    this.isRunning = true;
    this.isPaused = false;

    const delayDesc = this.config.minDelay >= 60 
      ? `${(this.config.minDelay/60).toFixed(1)}m - ${(this.config.maxDelay/60).toFixed(1)}m`
      : `${this.config.minDelay}s - ${this.config.maxDelay}s`;

    this.log(`Started batch dispatch for ${this.queue.length} contacts (Smart Delay: ${delayDesc}${this.config.media ? ' with media attachment' : ''}).`, 'info');
    this.emitProgress();
    this.processNext();
  }

  pause() {
    if (this.isRunning && !this.isPaused) {
      this.isPaused = true;
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      this.log('Batch execution PAUSED.', 'warning');
      this.emitProgress();
    }
  }

  resume() {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
      this.log('Batch execution RESUMED.', 'info');
      this.emitProgress();
      if (!this.timerId) {
        this.processNext();
      }
    }
  }

  stop() {
    if (this.isRunning) {
      this.isRunning = false;
      this.isPaused = false;
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      this.log('Batch execution STOPPED by user.', 'error');
      this.emitProgress();
    }
  }

  async processNext() {
    if (!this.isRunning || this.isPaused) return;

    if (this.currentIndex >= this.queue.length) {
      this.isRunning = false;
      this.log(`Batch complete! Finished processing ${this.queue.length} contacts.`, 'success');
      this.emitProgress();
      return;
    }

    const connectedAccounts = getConnectedAccounts();
    if (connectedAccounts.length === 0) {
      this.log('No active/connected WhatsApp accounts available! Pausing batch execution.', 'error');
      this.pause();
      return;
    }

    // Select account using Round-Robin across active connected WhatsApp accounts
    const accountIndex = this.currentIndex % connectedAccounts.length;
    const selectedAccount = connectedAccounts[accountIndex];
    const accLabel = selectedAccount.user?.name || selectedAccount.name || selectedAccount.id;

    const currentItem = this.queue[this.currentIndex];
    currentItem.status = 'PROCESSING';
    currentItem.sentByAccount = accLabel;
    currentItem.sentByAccountId = selectedAccount.id;
    this.emitProgress();

    const rawPhone = extractPhone(currentItem.client);
    let clientPhone = rawPhone;

    // Auto-prefix default country code and strip leading zeroes
    if (clientPhone) {
      let cleanDigits = String(clientPhone).replace(/[^0-9]/g, '');
      const defaultCC = (this.config.defaultCountryCode || '91').replace(/[^0-9]/g, '');

      // Strip leading 0 if 11 digits (e.g. 09876543210 -> 9876543210)
      if (cleanDigits.length === 11 && cleanDigits.startsWith('0')) {
        cleanDigits = cleanDigits.slice(1);
      }

      // If 10 digits, prepend selected country code (e.g. 9876543210 -> 919876543210)
      if (cleanDigits.length === 10) {
        clientPhone = `${defaultCC}${cleanDigits}`;
      } else {
        clientPhone = cleanDigits;
      }
    }

    if (!clientPhone) {
      currentItem.status = 'FAILED';
      currentItem.error = 'No phone number found in row';
      this.log(`Item ${currentItem.id} Failed: Missing phone number`, 'error');
      this.currentIndex++;
      this.emitProgress();
      this.scheduleNext();
      return;
    }

    try {
      this.log(`[${currentItem.id}/${this.queue.length}] Tailoring message for ${currentItem.client.name || clientPhone} (via ${accLabel})...`, 'info');
      
      const finalMessage = await generateAIMessage({
        template: currentItem.template,
        clientData: currentItem.client,
        promptInstruction: this.config.promptInstruction,
        useAI: this.config.useAI,
        apiKey: this.config.apiKey
      });

      currentItem.generatedMessage = finalMessage;
      this.log(`[${accLabel}] Sending to ${clientPhone}${this.config.media ? ' [with media]' : ''}...`, 'info');

      await sendMessage(selectedAccount.id, clientPhone, finalMessage, this.config.media);

      currentItem.status = 'SENT';
      currentItem.sentAt = new Date().toISOString();
      this.log(`[${accLabel}] Message sent to ${clientPhone} (${currentItem.client.name || 'Client'})`, 'success');

    } catch (err) {
      currentItem.status = 'FAILED';
      currentItem.error = err.message;
      this.log(`[${accLabel}] Failed sending to ${clientPhone}: ${err.message}`, 'error');
    }

    this.currentIndex++;
    this.emitProgress();

    if (this.currentIndex < this.queue.length && this.isRunning && !this.isPaused) {
      this.scheduleNext();
    } else if (this.currentIndex >= this.queue.length) {
      this.isRunning = false;
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      this.log(`Batch complete! Finished processing ${this.queue.length} contacts across ${connectedAccounts.length} WhatsApp accounts.`, 'success');
      this.emitProgress();
    }
  }

  scheduleNext() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    const minMs = Math.max(1, this.config.minDelay) * 1000;
    const maxMs = Math.max(minMs, this.config.maxDelay * 1000);
    const randomDelayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

    const delaySec = randomDelayMs / 1000;
    const delayText = delaySec >= 120 ? `${(delaySec / 60).toFixed(1)} minutes` : `${delaySec.toFixed(1)} seconds`;

    this.log(`Meta Safe Delay: waiting ${delayText} before next contact...`, 'info');
    
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.processNext();
    }, randomDelayMs);
  }

  emitProgress() {
    const progress = this.getStatus();
    this.emit('queueProgress', progress);
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      total: this.queue.length,
      current: this.currentIndex,
      sentCount: this.queue.filter(q => q.status === 'SENT').length,
      failedCount: this.queue.filter(q => q.status === 'FAILED').length,
      pendingCount: this.queue.filter(q => q.status === 'PENDING').length,
      queue: this.queue
    };
  }
}

module.exports = new QueueManager();
