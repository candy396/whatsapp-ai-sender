const socket = io();
let contacts = [];
let currentQueueState = [];
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);

function extractPhone(clientObj) {
  if (!clientObj) return '';
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

  return '';
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server response error (${res.status}): ${text.slice(0, 100)}`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error status ${res.status}`);
  return data;
}

function addLog(msg, type='info', ts=new Date().toLocaleTimeString()) {
  const c = {info:'text-slate-400',success:'text-emerald-400',error:'text-rose-400',warning:'text-amber-400'};
  const d = document.createElement('div');
  d.className = c[type]||c.info;
  d.textContent = `[${ts}] ${msg}`;
  $('logs-box').appendChild(d);
  $('logs-box').scrollTop = $('logs-box').scrollHeight;
}

function renderAccountsGrid(accounts = []) {
  accountsList = accounts;
  const grid = $('accounts-grid');
  if (!grid) return;

  const connected = accounts.filter(a => a.status === 'CONNECTED');
  const connectedCount = connected.length;

  if ($('wa-status-text')) {
    $('wa-status-text').textContent = connectedCount > 0 ? `${connectedCount} Account${connectedCount > 1 ? 's' : ''} Ready` : 'Disconnected';
  }
  if ($('wa-status-badge')) {
    $('wa-status-badge').className = `flex items-center space-x-2.5 px-4 py-2 rounded-full bg-slate-900/90 border border-slate-700/80 text-xs font-semibold ${connectedCount > 0 ? 'text-emerald-400 font-bold' : 'text-rose-400'} shadow-inner`;
  }

  if (!accounts.length) {
    grid.innerHTML = `
      <div class="col-span-2 p-6 glass-card rounded-xl text-center text-slate-400 text-xs italic">
        No WhatsApp accounts added. Click "+ Add WhatsApp Account" to start.
      </div>`;
    return;
  }

  grid.innerHTML = accounts.map((acc, index) => {
    const isConnected = acc.status === 'CONNECTED';
    const isQR = acc.status === 'QR_READY';
    const statusCls = isConnected ? 'border-emerald-500/40 bg-emerald-950/20' : isQR ? 'border-amber-500/40 bg-amber-950/20' : 'border-slate-800 bg-slate-950/60';
    const badgeCls = isConnected ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : isQR ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold' : 'bg-slate-800 text-slate-400 border-slate-700';
    const statusText = isConnected ? 'Active & Ready' : isQR ? 'Scan QR Code' : acc.status;

    const qrBlock = isQR && acc.qrCode ? `
      <div class="mt-3 p-3 bg-slate-950 rounded-xl border border-amber-500/30 flex flex-col items-center justify-center">
        <img src="${acc.qrCode}" alt="WhatsApp QR Code" class="w-44 h-44 rounded-lg bg-white p-2 shadow-lg transition hover:scale-105 duration-300">
        <span class="text-[10px] text-amber-400 mt-2 font-mono flex items-center gap-1.5">
          <i class="fa-solid fa-arrows-rotate animate-spin text-amber-400"></i> Open WhatsApp > Linked Devices > Scan
        </span>
      </div>` : '';

    const userBlock = isConnected && acc.user ? `
      <div class="mt-2 text-xs font-mono text-emerald-300 flex items-center gap-1.5">
        <i class="fa-solid fa-user-check text-emerald-400"></i> ${esc(acc.user.name || 'WhatsApp User')} ${acc.user.phone ? `(+${esc(acc.user.phone)})` : ''}
      </div>` : '';

    return `
      <div class="glass-panel p-4 rounded-xl border ${statusCls} space-y-2 relative group">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2.5">
            <div class="w-8 h-8 rounded-lg ${isConnected ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'} flex items-center justify-center text-sm font-bold border">
              <i class="fa-brands fa-whatsapp"></i>
            </div>
            <div>
              <h3 class="text-xs font-bold text-white flex items-center gap-1.5 font-mono">${esc(acc.name)}</h3>
              <span class="text-[10px] font-mono text-slate-400">${esc(acc.id)}</span>
            </div>
          </div>
          <span class="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full border ${badgeCls}">${statusText}</span>
        </div>

        ${userBlock}
        ${qrBlock}

        <div class="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800/60">
          ${isConnected || isQR ? `
            <button onclick="logoutAccount('${acc.id}')" class="px-2 py-1 text-[10px] font-mono font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg transition">
              <i class="fa-solid fa-rotate mr-1"></i> Reset Session
            </button>` : ''}
          ${accounts.length > 1 ? `
            <button onclick="removeAccount('${acc.id}')" class="px-2 py-1 text-[10px] font-mono font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg transition">
              <i class="fa-solid fa-trash mr-1"></i> Remove
            </button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function addAccount() {
  try {
    addLog('Initializing new WhatsApp account session...', 'info');
    const res = await fetchJSON('/api/accounts/add', { method: 'POST' });
    renderAccountsGrid(res.accounts || []);
    addLog(`Created new slot: ${res.account?.name || 'New Account'}. Please scan QR code.`, 'success');
  } catch (err) {
    addLog(`Failed adding account: ${err.message}`, 'error');
  }
}

async function logoutAccount(accountId) {
  if (!confirm(`Reset session for account ${accountId}?`)) return;
  try {
    addLog(`Resetting session for ${accountId}...`, 'warning');
    const res = await fetchJSON(`/api/accounts/${accountId}/logout`, { method: 'POST' });
    renderAccountsGrid(res.accounts || []);
    addLog(`Account ${accountId} session reset. Scan fresh QR code.`, 'info');
  } catch (err) {
    addLog(`Logout error: ${err.message}`, 'error');
  }
}

async function removeAccount(accountId) {
  if (!confirm(`Remove ${accountId} completely?`)) return;
  try {
    addLog(`Removing account ${accountId}...`, 'warning');
    const res = await fetchJSON(`/api/accounts/${accountId}`, { method: 'DELETE' });
    renderAccountsGrid(res.accounts || []);
    addLog(`Account ${accountId} removed.`, 'info');
  } catch (err) {
    addLog(`Remove error: ${err.message}`, 'error');
  }
}

window.logoutAccount = logoutAccount;
window.removeAccount = removeAccount;

function renderContacts() {
  $('contact-count-badge').textContent = `${contacts.length} loaded`;
  const b = $('queue-tbody');
  b.innerHTML = contacts.length ? contacts.map((c,i) =>
    `<tr><td class="p-2">${i+1}</td><td class="p-2">${esc(extractPhone(c))}</td><td class="p-2">${esc(c.name||c.Name||'')}</td><td class="p-2 text-slate-400">READY</td></tr>`
  ).join('') : '<tr><td colspan="4" class="p-4 text-center text-slate-500 italic">No contacts loaded</td></tr>';
}

function renderProgress(d={}) {
  $('stat-total').textContent = d.total||0;
  $('stat-sent').textContent = d.sentCount||0;
  $('stat-pending').textContent = d.pendingCount||0;
  $('stat-failed').textContent = d.failedCount||0;
  const done = (d.sentCount||0)+(d.failedCount||0);
  const pct = d.total ? Math.round((done/d.total)*100) : 0;
  $('progress-percent').textContent = pct+'%';
  $('progress-bar-inner').style.width = pct+'%';
  $('batch-status-label').textContent = d.isPaused?'Paused':d.isRunning?'Running':done?'Complete':'Idle';
  if(d.queue?.length) {
    currentQueueState = d.queue;
    $('queue-tbody').innerHTML = d.queue.map(it => {
      const cls = it.status==='SENT' ? 'text-emerald-400 font-semibold' : it.status==='FAILED' ? 'text-rose-400 font-semibold' : 'text-slate-400';
      const errNote = it.error ? ` (${esc(it.error)})` : '';
      const phoneVal = extractPhone(it.client) || it.client.phone || '';
      return `<tr><td class="p-2">${it.id}</td><td class="p-2">${esc(phoneVal)}</td><td class="p-2">${esc(it.client.name||it.client.Name||'')}</td><td class="p-2 ${cls}">${esc(it.status)}${errNote}</td></tr>`;
    }).join('');
  }
  $('btn-start-send').classList.toggle('hidden', !!d.isRunning);
  $('btn-pause-send').classList.toggle('hidden', !d.isRunning||d.isPaused);
  $('btn-resume-send').classList.toggle('hidden', !d.isRunning||!d.isPaused);
  $('btn-stop-send').classList.toggle('hidden', !d.isRunning);
}

async function loadContactsFromCSV(file) {
  const fd = new FormData();
  fd.append('csvFile', file);
  const d = await fetchJSON('/api/parse-contacts', {method:'POST', body:fd});
  contacts = d.contacts;
  renderContacts();
  addLog(`Loaded ${contacts.length} contacts from CSV.`, 'success');
}

async function loadContactsFromText(text) {
  const d = await fetchJSON('/api/parse-contacts', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ contactsList: text })
  });
  contacts = d.contacts;
  renderContacts();
  addLog(`Loaded ${contacts.length} contacts.`, 'success');
}

$('csv-input').addEventListener('change', async e => {
  if(!e.target.files[0]) return;
  try { await loadContactsFromCSV(e.target.files[0]); }
  catch(err) { addLog(err.message, 'error'); }
});

$('btn-load-manual').addEventListener('click', async () => {
  try {
    const val = $('manual-contacts-text').value.trim();
    if(!val) return addLog('Please enter phone numbers first.', 'warning');
    await loadContactsFromText(val);
  } catch(err) { addLog(err.message, 'error'); }
});

$('btn-preview-ai').addEventListener('click', async () => {
  try {
    const d = await fetchJSON('/api/preview-ai', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        template: $('message-template').value,
        clientData: contacts[0]||{name:'Client',company:'Company',notes:'your request'},
        promptInstruction: $('ai-prompt').value,
        apiKey: $('openai-key').value||undefined
      })
    });
    const box = $('ai-preview-box');
    const textEl = box.querySelector('.preview-text') || $('ai-preview-content');
    if (textEl) textEl.textContent = d.preview;
    box.classList.remove('hidden');
  } catch(err) { addLog(err.message, 'error'); }
});

let selectedMediaFile = null;

// Media input handler
const mediaInput = $('media-input');
if (mediaInput) {
  mediaInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      selectedMediaFile = e.target.files[0];
      $('attached-media-name').textContent = selectedMediaFile.name;
      $('media-preview-container').classList.remove('hidden');
      $('media-filename').textContent = `Attached: ${selectedMediaFile.name}`;
      addLog(`Attached media file: ${selectedMediaFile.name} (${(selectedMediaFile.size/1024/1024).toFixed(2)} MB)`, 'info');
    }
  });
}

const btnReset = $('btn-reset-session');
if (btnReset) {
  btnReset.addEventListener('click', async () => {
    if (!confirm('Clear existing WhatsApp session and generate a fresh QR code?')) return;
    try {
      addLog('Resetting WhatsApp session...', 'warning');
      const res = await fetchJSON('/api/logout', { method: 'POST' });
      addLog(res.message || 'Session reset initiated.', 'info');
    } catch (err) {
      addLog(`Reset failed: ${err.message}`, 'error');
    }
  });
}

const btnRemoveMedia = $('btn-remove-media');
if (btnRemoveMedia) {
  btnRemoveMedia.addEventListener('click', () => {
    selectedMediaFile = null;
    if (mediaInput) mediaInput.value = '';
    $('media-preview-container').classList.add('hidden');
    $('media-filename').textContent = 'Click or drag photo (JPG/PNG/HEIC), video (MP4/MOV), or PDF here';
    addLog('Removed media attachment.', 'info');
  });
}

// Mode switch handler
document.querySelectorAll('input[name="pacing-mode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const isDay = e.target.value === 'day';
    $('day-pacing-container').classList.toggle('hidden', !isDay);
    $('custom-delay-container').classList.toggle('hidden', isDay);
    
    $('lbl-mode-day').className = `glass-card flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer ${isDay ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-700 bg-slate-950/60'}`;
    $('lbl-mode-custom').className = `glass-card flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer ${!isDay ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-700 bg-slate-950/60'}`;
    
    updatePacingEstimate();
  });
});

function updatePacingEstimate() {
  const count = contacts.length || 100;
  const hours = parseFloat($('day-hours-select').value) || 8;
  const totalSec = hours * 3600;
  const avgSec = totalSec / Math.max(1, count);
  const minSec = Math.max(10, Math.floor(avgSec * 0.65));
  const maxSec = Math.floor(avgSec * 1.35);

  const formatSec = s => s >= 60 ? `${(s/60).toFixed(1)} mins` : `${s} secs`;

  $('pacing-estimate-text').textContent = 
    `For ${count} contacts over ${hours} Hours: messages will be sent randomly every ~${formatSec(minSec)} to ~${formatSec(maxSec)} with human typing state simulation.`;
}

$('day-hours-select').addEventListener('change', updatePacingEstimate);

$('btn-start-send').addEventListener('click', async () => {
  if (!contacts.length) return addLog('Please load contacts before starting broadcast sequence.', 'warning');
  const template = $('message-template').value.trim();
  const fileToSend = selectedMediaFile || $('media-input')?.files?.[0];
  if (!template && !fileToSend) return addLog('Please enter a message template or attach a photo/video.', 'warning');

  const isDayMode = document.querySelector('input[name="pacing-mode"]:checked')?.value === 'day';
  
  try {
    let resData;
    const countryCode = $('country-code-select') ? $('country-code-select').value : '91';

    if (fileToSend) {
      // Send as FormData for file upload
      const formData = new FormData();
      formData.append('mediaFile', fileToSend);
      formData.append('contacts', JSON.stringify(contacts));
      formData.append('template', template);
      formData.append('defaultCountryCode', countryCode);
      formData.append('useAI', 'true');
      formData.append('promptInstruction', $('ai-prompt').value);
      if ($('openai-key').value) formData.append('apiKey', $('openai-key').value);
      
      if (isDayMode) {
        formData.append('dayDistributionHours', $('day-hours-select').value);
      } else {
        formData.append('minDelay', $('min-delay').value);
        formData.append('maxDelay', $('max-delay').value);
      }

      const res = await fetch('/api/send-batch', { method: 'POST', body: formData });
      resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Failed to start batch');
    } else {
      // Send JSON
      const bodyPayload = {
        contacts,
        template,
        defaultCountryCode: countryCode,
        useAI: true,
        promptInstruction: $('ai-prompt').value,
        apiKey: $('openai-key').value || undefined
      };

      if (isDayMode) {
        bodyPayload.dayDistributionHours = $('day-hours-select').value;
      } else {
        bodyPayload.minDelay = $('min-delay').value;
        bodyPayload.maxDelay = $('max-delay').value;
      }

      resData = await fetchJSON('/api/send-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
    }

    addLog(resData.message, 'success');
  } catch (err) { addLog(err.message, 'error'); }
});

async function queueAction(act) {
  try { await fetchJSON(`/api/queue/${act}`, {method:'POST'}); }
  catch(err) { addLog(err.message, 'error'); }
}

$('btn-pause-send').addEventListener('click', () => queueAction('pause'));

// Drag & Drop File Handlers
const csvDropZone = document.querySelector('#csv-input')?.parentElement;
if (csvDropZone) {
  ['dragenter', 'dragover'].forEach(eventName => {
    csvDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      csvDropZone.classList.add('border-sky-500', 'bg-sky-950/20');
    }, false);
  });
  ['dragleave', 'drop'].forEach(eventName => {
    csvDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      csvDropZone.classList.remove('border-sky-500', 'bg-sky-950/20');
    }, false);
  });
  csvDropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files[0]) {
      loadContactsFromCSV(files[0]).catch(err => addLog(err.message, 'error'));
    }
  });
}

const mediaDropZone = document.querySelector('#media-input')?.parentElement;
if (mediaDropZone) {
  ['dragenter', 'dragover'].forEach(eventName => {
    mediaDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      mediaDropZone.classList.add('border-sky-500', 'bg-sky-950/20');
    }, false);
  });
  ['dragleave', 'drop'].forEach(eventName => {
    mediaDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      mediaDropZone.classList.remove('border-sky-500', 'bg-sky-950/20');
    }, false);
  });
  mediaDropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files[0]) {
      selectedMediaFile = files[0];
      $('attached-media-name').textContent = selectedMediaFile.name;
      $('media-preview-container').classList.remove('hidden');
      $('media-filename').textContent = `Attached: ${selectedMediaFile.name}`;
      addLog(`Attached media file via drop: ${selectedMediaFile.name}`, 'info');
    }
  });
}
$('btn-resume-send').addEventListener('click', () => queueAction('resume'));
$('btn-stop-send').addEventListener('click', () => queueAction('stop'));
$('btn-clear-logs').addEventListener('click', () => $('logs-box').innerHTML='');

const btnAddAcc = $('btn-add-account');
if (btnAddAcc) {
  btnAddAcc.addEventListener('click', addAccount);
}

socket.on('waAccounts', renderAccountsGrid);
socket.on('waStatus', (data) => {
  if (data.accounts) renderAccountsGrid(data.accounts);
});
socket.on('queueProgress', renderProgress);
socket.on('queueLog', i => addLog(i.message, i.type, i.timestamp));
socket.on('systemLog', i => addLog(i.message, 'info', i.timestamp));

fetchJSON('/api/status')
  .then(d => {
    if (d.accounts) renderAccountsGrid(d.accounts);
    renderProgress(d.queue);
  })
  .catch(() => addLog('Unable to reach server.', 'error'));

$('btn-toggle-manual').addEventListener('click', () => $('manual-paste-area').classList.toggle('hidden'));
