// =============================================================================
// OpenMinis PC - Frontend Application
// Handles chat UI, SSE streaming, tool display, and settings
// =============================================================================

const API_BASE = '';

// State
let isProcessing = false;
let currentAssistantMsg = null;
let currentToolBlocks = {};
let eventSource = null;

// Session state
let currentSessionId = '';
let sessionsCache = [];

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// =============================================================================
// Navigation
// =============================================================================

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');

    if (view === 'settings') {
      // Refresh every settings panel when the view becomes active.
      // Keep this call aligned with the actual settings loaders below.
      renderProfileList();
      loadAllSettings();
    }
  });
});

// =============================================================================
// Session Management
// =============================================================================

const sessionsList = document.getElementById('sessionsList');
const newSessionBtn = document.getElementById('newSessionBtn');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const searchResults = document.getElementById('searchResults');

async function loadSessionList() {
  try {
    const resp = await fetch(`${API_BASE}/api/sessions`);
    const data = await resp.json();
    sessionsCache = data.sessions || [];
    // If no active session, pick first or create one
    if (!currentSessionId && sessionsCache.length > 0) {
      const activeId = data.activeSessionId || sessionsCache[0].id;
      await switchSession(activeId, false);
    } else if (sessionsCache.length === 0 && !currentSessionId) {
      await createSession();
    }
    renderSessionList();
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

function renderSessionList() {
  if (sessionsCache.length === 0) {
    sessionsList.innerHTML = '<div class="sessions-empty">' + escapeHtml(i18n.t('sidebar.noConversations')) + '</div>';
    return;
  }

  sessionsList.innerHTML = sessionsCache.map(s => {
    const active = s.id === currentSessionId ? ' active' : '';
    const timeStr = formatTime(s.updated);
    return `
      <div class="session-item${active}" data-id="${s.id}">
        <div class="session-item-info" onclick="event.stopPropagation(); switchSession('${s.id}')">
          <span class="session-item-title" data-sid="${s.id}" onclick="event.stopPropagation(); startRename('${s.id}')" title="Click to rename">${escapeHtml(s.title)}</span>
          <span class="session-item-time">${timeStr}</span>
        </div>
        <button class="session-item-delete" onclick="event.stopPropagation(); deleteSession('${s.id}')" title="Delete">×</button>
      </div>
    `;
  }).join('');
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return i18n.t('time.justNow');
  if (diffMin < 60) return i18n.t('time.minAgo', { n: diffMin });
  if (diffHr < 24) return i18n.t('time.hourAgo', { n: diffHr });
  if (diffDay < 7) return i18n.t('time.dayAgo', { n: diffDay });
  return d.toLocaleDateString();
}

async function createSession() {
  try {
    const resp = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' });
    const data = await resp.json();
    if (data.session) {
      currentSessionId = data.session.id;
      clearChat();
      await loadSessionList();
    }
  } catch (err) {
    console.error('Failed to create session:', err);
  }
}

async function switchSession(id, updateList = true) {
  if (isProcessing) {
    await stopProcessing();
  }

  currentSessionId = id;
  clearChat();

  // Load messages
  try {
    const resp = await fetch(`${API_BASE}/api/sessions/${id}`);
    const data = await resp.json();
    const msgs = data.messages || [];

    // Update title
    const sess = sessionsCache.find(s => s.id === id);

    if (msgs.length === 0) {
      // Empty session: show welcome
      showWelcome();
    } else {
      // Render messages
      for (const msg of msgs) {
        if (msg.role === 'user') {
          addMessage('user', msg.content);
        } else {
          const el = addMessage('assistant', msg.content);
          // Render tool calls if present
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const tc of msg.toolCalls) {
              const block = document.createElement('div');
              block.className = 'tool-block';
              block.innerHTML = `
                <div class="tool-header" onclick="toggleToolBody('tool-body-${tc.id}')">
                  <span class="tool-icon">🔧</span>
                  <span class="tool-name">${escapeHtml(tc.name)}</span>
                  <span class="tool-status done">${escapeHtml(i18n.t('chat.done'))}</span>
                </div>
                <div class="tool-body" id="tool-body-${tc.id}" style="display:none;">
                  <div class="tool-args">${escapeHtml(JSON.stringify(tc.args, null, 2))}</div>
                </div>
              `;
              el.appendChild(block);
            }
          }
          // Render usage if present
          if (msg.usage) {
            const usageEl = document.createElement('div');
            usageEl.className = 'message-usage';
            usageEl.style.cssText = 'font-size:0.7rem;color:var(--text-muted);margin-top:4px;';
            usageEl.textContent = `📊 ${(msg.usage.inputTokens || 0).toLocaleString()} in · ${(msg.usage.outputTokens || 0).toLocaleString()} out`;
            el.appendChild(usageEl);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to load messages:', err);
    showWelcome();
  }

  if (updateList) {
    // Update active in store
    try {
      await fetch(`${API_BASE}/api/profiles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeSessionId: id }),
      });
    } catch { /* ignore - sessions store handles this separately */ }
    renderSessionList();
  }
}

async function deleteSession(id) {
  if (!confirm(i18n.t('search.deleteConfirm'))) return;

  try {
    const resp = await fetch(`${API_BASE}/api/sessions/${id}`, { method: 'DELETE' });
    const data = await resp.json();

    // Remove from cache
    sessionsCache = sessionsCache.filter(s => s.id !== id);

    if (id === currentSessionId) {
      // Switch to another session or create new
      const next = sessionsCache[0];
      if (next) {
        await switchSession(next.id, false);
      } else {
        currentSessionId = '';
        clearChat();
        showWelcome();
      }
    }

    renderSessionList();

    // If no sessions left, create one
    if (sessionsCache.length === 0) {
      await createSession();
    }
  } catch (err) {
    console.error('Failed to delete session:', err);
  }
}

function startRename(sessionId) {
  const titleEl = document.querySelector(`.session-item-title[data-sid="${sessionId}"]`);
  if (!titleEl) return;

  const sess = sessionsCache.find(s => s.id === sessionId);
  const currentTitle = sess ? sess.title : '';

  // Replace span with input
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentTitle;
  input.className = 'session-item-rename-input';
  input.setAttribute('data-sid', sessionId);

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const finishRename = async () => {
    const newTitle = input.value.trim() || currentTitle;
    // Restore span
    const span = document.createElement('span');
    span.className = 'session-item-title';
    span.setAttribute('data-sid', sessionId);
    span.textContent = newTitle;
    span.title = 'Click to rename';
    span.onclick = (e) => { e.stopPropagation(); startRename(sessionId); };
    input.replaceWith(span);

    if (newTitle !== currentTitle) {
      try {
        await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        if (sess) sess.title = newTitle;
        renderSessionList();
      } catch (err) {
        console.error('Failed to rename:', err);
      }
    }
  };

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') {
      input.value = currentTitle;
      input.blur();
    }
  });
}

function clearChat() {
  chatMessages.innerHTML = '';
  currentAssistantMsg = null;
  currentToolBlocks = {};
}

function showWelcome() {
  chatMessages.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">🧠</div>
      <h2>${i18n.t('chat.welcomeTitle')}</h2>
      <p>${i18n.t('chat.welcomeDesc')}</p>
      <div class="quick-actions">
        <button class="quick-btn" id="quickListFiles">📂 <span>${i18n.t('chat.listFiles')}</span></button>
        <button class="quick-btn" id="quickSystemInfo">💻 <span>${i18n.t('chat.systemInfo')}</span></button>
        <button class="quick-btn" id="quickPythonScript">🐍 <span>${i18n.t('chat.pythonScript')}</span></button>
      </div>
    </div>
  `;
  attachQuickActions();
}

// Quick action buttons — prompts are localized
function attachQuickActions() {
  const map = {
    quickListFiles: 'chat.listFilesPrompt',
    quickSystemInfo: 'chat.systemInfoPrompt',
    quickPythonScript: 'chat.pythonScriptPrompt',
  };
  for (const [id, key] of Object.entries(map)) {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = () => sendQuick(i18n.t(key));
  }
}

// Event: New session button
newSessionBtn.addEventListener('click', () => {
  if (isProcessing) stopProcessing().then(() => createSession());
  else createSession();
});

// =============================================================================
// Search
// =============================================================================

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    performSearch();
  }
});

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchClear.style.display = q ? 'flex' : 'none';
  if (!q) {
    searchResults.style.display = 'none';
    sessionsList.style.display = '';
  }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  searchResults.style.display = 'none';
  sessionsList.style.display = '';
  searchInput.focus();
});

async function performSearch() {
  const q = searchInput.value.trim();
  if (!q) {
    searchResults.style.display = 'none';
    sessionsList.style.display = '';
    return;
  }

  try {
    const resp = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
    const data = await resp.json();
    const results = data.results || [];

    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-no-results">' + escapeHtml(i18n.t('search.noResults')) + '</div>';
    } else {
      searchResults.innerHTML = results.map(r => `
        <div class="search-result-item" onclick="switchSession('${r.session.id}')">
          <div class="search-result-title">${escapeHtml(r.session.title)}</div>
          ${r.matches.map(m => `
            <div class="search-result-snippet"><span class="search-role">${m.role === 'user' ? '👤' : '🤖'}</span> ${highlightMatch(m.snippet, q)}</div>
          `).join('')}
        </div>
      `).join('');
    }

    searchResults.style.display = 'block';
    sessionsList.style.display = 'none';
    searchClear.style.display = 'flex';
  } catch (err) {
    console.error('Search failed:', err);
  }
}

function highlightMatch(text, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(regex, '<em>$1</em>');
}

// =============================================================================
// Chat Input
// =============================================================================

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

sendBtn.addEventListener('click', sendMessage);
stopBtn.addEventListener('click', stopProcessing);

function sendQuick(text) {
  chatInput.value = text;
  sendMessage();
}

// =============================================================================
// Send Message
// =============================================================================

async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message || isProcessing) return;

  // Auto-create session if needed
  if (!currentSessionId) {
    await createSession();
    if (!currentSessionId) return;
  }

  // Clear welcome
  const welcome = chatMessages.querySelector('.welcome');
  if (welcome) welcome.remove();

  // Add user message
  addMessage('user', message);

  // Clear input
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // Start processing
  setProcessing(true);

  // Remove any old error messages
  document.querySelectorAll('.error-message').forEach((el) => el.remove());

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId: currentSessionId }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Server error: ${response.status}`);
    }

    // Create assistant message placeholder
    currentAssistantMsg = addMessage('assistant', '');
    currentToolBlocks = {};

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.trim()) continue;
        handleSSEEvent(part.trim());
      }
    }
  } catch (err) {
    addError(err.message);
    setProcessing(false);
  }
}

// =============================================================================
// SSE Event Handling
// =============================================================================

function handleSSEEvent(raw) {
  const lines = raw.split('\n');
  let eventType = '';
  let dataStr = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.substring(7);
    } else if (line.startsWith('data: ')) {
      dataStr = line.substring(6);
    }
  }

  if (!eventType || !dataStr) return;

  try {
    const data = JSON.parse(dataStr);

    switch (eventType) {
      case 'text':
        handleTextDelta(data.content);
        break;
      case 'thinking':
        handleThinkingDelta(data.content);
        break;
      case 'tool_start':
        handleToolStart(data.id, data.name);
        break;
      case 'tool_input':
        handleToolInput(data.name, data.args);
        break;
      case 'tool_complete':
        handleToolComplete(data.id, data.name, data.args);
        break;
      case 'tool_result':
        handleToolResult(data.id, data.output, data.success);
        break;
      case 'usage':
        handleUsage(data);
        break;
      case 'error':
        handleError(data.message);
        break;
      case 'done':
        handleDone(data.stopReason);
        break;
      case 'cancelled':
        handleCancelled();
        break;
    }
  } catch (e) {
    // Skip parse errors for partial chunks
  }
}

function handleTextDelta(fullText) {
  if (!currentAssistantMsg) return;
  const contentEl = currentAssistantMsg.querySelector('.message-content');
  if (contentEl) {
    contentEl.innerHTML = marked.parse(fullText);
    scrollToBottom();
  }
}

function handleThinkingDelta(text) {
  if (!currentAssistantMsg) return;
  let thinkBlock = currentAssistantMsg.querySelector('.thinking-block');
  if (!thinkBlock) {
    thinkBlock = document.createElement('div');
    thinkBlock.className = 'thinking-block';
    thinkBlock.textContent = '🤔 ' + i18n.t('chat.thinking');
    currentAssistantMsg.querySelector('.message-content').after(thinkBlock);
  }
  thinkBlock.textContent = '🤔 ' + text.substring(0, 500);
  scrollToBottom();
}

function handleToolStart(id, name) {
  if (!currentAssistantMsg) return;

  const block = document.createElement('div');
  block.className = 'tool-block';
  block.id = `tool-${id}`;
  block.innerHTML = `
    <div class="tool-header" onclick="toggleToolBody('tool-body-${id}')">
      <span class="tool-icon">🔧</span>
      <span class="tool-name">${escapeHtml(name)}</span>
      <span class="tool-status running">${escapeHtml(i18n.t('chat.running'))}</span>
    </div>
    <div class="tool-body" id="tool-body-${id}">
      <div class="tool-args">${escapeHtml(i18n.t('chat.preparing'))}</div>
    </div>
  `;

  currentAssistantMsg.appendChild(block);
  currentToolBlocks[id] = { block, name };
  scrollToBottom();
}

function handleToolInput(name, args) {
  // Update the tool body with parsed args
  for (const [id, info] of Object.entries(currentToolBlocks)) {
    if (info.name === name) {
      const argsEl = info.block.querySelector('.tool-args');
      if (argsEl) {
        try {
          const parsed = JSON.parse(args);
          argsEl.textContent = JSON.stringify(parsed, null, 2);
        } catch {
          argsEl.textContent = args;
        }
      }
    }
  }
}

function handleToolComplete(id, name, args) {
  const info = currentToolBlocks[id];
  if (!info) return;

  const argsEl = info.block.querySelector('.tool-args');
  if (argsEl) {
    argsEl.textContent = JSON.stringify(args, null, 2);
  }
}

function handleToolResult(id, output, success) {
  const info = currentToolBlocks[id];
  if (!info) return;

  const statusEl = info.block.querySelector('.tool-status');
  if (statusEl) {
    statusEl.textContent = success ? i18n.t('chat.done') : i18n.t('chat.error');
    statusEl.className = `tool-status ${success ? 'done' : 'error'}`;
  }

  const bodyEl = info.block.querySelector('.tool-body');
  if (bodyEl) {
    const truncated = output.length > 5000
      ? output.substring(0, 5000) + '\n\n' + i18n.t('chat.truncated')
      : output;
    const resultDiv = document.createElement('div');
    resultDiv.innerHTML = `<pre>${escapeHtml(truncated)}</pre>`;
    bodyEl.appendChild(resultDiv);
  }

  scrollToBottom();
}

function handleUsage(usage) {
  if (currentAssistantMsg) {
    let usageEl = currentAssistantMsg.querySelector('.message-usage');
    if (!usageEl) {
      usageEl = document.createElement('div');
      usageEl.className = 'message-usage';
      usageEl.style.cssText = 'font-size:0.7rem;color:var(--text-muted);margin-top:4px;';
      currentAssistantMsg.appendChild(usageEl);
    }
    const inTokens = usage.inputTokens || 0;
    const outTokens = usage.outputTokens || 0;
    usageEl.textContent = `📊 ${inTokens.toLocaleString()} in · ${outTokens.toLocaleString()} out`;
  }
}

function handleError(message) {
  addError(message);
  setProcessing(false);
}

function handleDone(stopReason) {
  setProcessing(false);

  // Remove thinking block
  if (currentAssistantMsg) {
    const thinkBlock = currentAssistantMsg.querySelector('.thinking-block');
    if (thinkBlock) thinkBlock.remove();
  }

  currentAssistantMsg = null;
  currentToolBlocks = {};

  // Refresh session list (title may have been updated)
  loadSessionList().catch(() => {});
}

function handleCancelled() {
  setProcessing(false);
  currentAssistantMsg = null;
  currentToolBlocks = {};

  const cancelNote = document.createElement('div');
  cancelNote.className = 'error-message';
  cancelNote.textContent = i18n.t('chat.cancelled');
  chatMessages.appendChild(cancelNote);
}

// =============================================================================
// Stop Processing
// =============================================================================

async function stopProcessing() {
  try {
    const sid = currentSessionId || '';
    await fetch(`${API_BASE}/api/cancel?sessionId=${encodeURIComponent(sid)}`);
  } catch { /* ignore */ }
  setProcessing(false);
}

// =============================================================================
// UI Helpers
// =============================================================================

function addMessage(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? i18n.t('chat.you') : i18n.t('chat.minis');

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  if (role === 'user') {
    contentDiv.textContent = content;
  } else {
    contentDiv.innerHTML = marked.parse(content);
  }

  msg.appendChild(label);
  msg.appendChild(contentDiv);
  chatMessages.appendChild(msg);
  scrollToBottom();
  return msg;
}

function addError(message) {
  const err = document.createElement('div');
  err.className = 'error-message';
  err.textContent = `❌ ${message}`;
  chatMessages.appendChild(err);
  scrollToBottom();
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setProcessing(processing) {
  isProcessing = processing;
  sendBtn.style.display = processing ? 'none' : 'flex';
  stopBtn.style.display = processing ? 'flex' : 'none';
  chatInput.disabled = processing;

  if (processing) {
    statusDot.className = 'status-dot processing';
    statusText.textContent = i18n.t('sidebar.processing');
  } else {
    statusDot.className = 'status-dot';
    statusText.textContent = i18n.t('sidebar.ready');
  }
}

function toggleToolBody(id) {
  const body = document.getElementById(id);
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
}

// =============================================================================
// Model Profiles (multi-model management)
// =============================================================================

const MODEL_PLACEHOLDERS = {
  anthropic: 'claude-sonnet-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat', openrouter: 'openai/gpt-4o', xai: 'grok-3', custom: 'your-model-id',
};

const BASE_URL_HINTS = {
  anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com', gemini: '',
  deepseek: 'https://api.deepseek.com', openrouter: 'https://openrouter.ai/api',
  xai: 'https://api.x.ai', custom: 'https://your-api-endpoint.com/v1',
};

let profilesCache = [];
let activeProfileId = '';

async function fetchProfiles() {
  const resp = await fetch(`${API_BASE}/api/profiles`);
  const data = await resp.json();
  profilesCache = data.profiles || [];
  activeProfileId = data.activeProfileId || '';
  return data;
}

// ---- Model Selector (chat bar) ----
async function refreshModelSelector() {
  const sel = document.getElementById('modelSelector');
  const hint = document.getElementById('modelBarHint');
  const data = await fetchProfiles();

  sel.innerHTML = '';
  if (data.profiles.length === 0) {
    sel.innerHTML = '<option value="">' + escapeHtml(i18n.t('chat.noModel')) + '</option>';
    hint.textContent = i18n.t('profile.addModelsHint');
    return;
  }

  for (const p of data.profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name + '  (' + p.provider + '/' + p.model + ')';
    if (p.id === data.activeProfileId) opt.selected = true;
    sel.appendChild(opt);
  }

  const active = data.profiles.find(p => p.id === data.activeProfileId);
  hint.textContent = active ? active.provider + ' · ' + active.model : '';
}

document.getElementById('modelSelector').addEventListener('change', async function () {
  const id = this.value;
  if (!id) return;
  await fetch(`${API_BASE}/api/profiles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeProfileId: id }),
  });
  activeProfileId = id;
  refreshModelSelector();
});

// ---- Profile List (settings) ----
async function renderProfileList() {
  const list = document.getElementById('profileList');
  const data = await fetchProfiles();

  if (data.profiles.length === 0) {
    list.innerHTML = '<div class="profile-empty">' + escapeHtml(i18n.t('settings.noModels')) + '</div>';
    return;
  }

  list.innerHTML = data.profiles.map(p => `
    <div class="profile-card ${p.id === data.activeProfileId ? 'active' : ''}" onclick="activateProfile('${p.id}')">
      <div class="profile-card-radio"></div>
      <div class="profile-card-info">
        <div class="profile-card-name">${escapeHtml(p.name)}</div>
        <div class="profile-card-detail">${escapeHtml(p.provider)} / ${escapeHtml(p.model)}</div>
        ${p.baseURL ? `<div class="profile-card-detail">${escapeHtml(p.baseURL)}</div>` : ''}
      </div>
      <span class="profile-card-badge">${escapeHtml(p.provider)}</span>
      <div class="profile-card-actions" onclick="event.stopPropagation()">
        <button onclick="editProfile('${p.id}')">✏️</button>
        <button class="danger" onclick="deleteProfile('${p.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

async function activateProfile(id) {
  await fetch(`${API_BASE}/api/profiles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeProfileId: id }),
  });
  activeProfileId = id;
  renderProfileList();
  refreshModelSelector();
}

async function deleteProfile(id) {
  if (!confirm(i18n.t('profile.deleteConfirm'))) return;
  await fetch(`${API_BASE}/api/profiles/${id}`, { method: 'DELETE' });
  renderProfileList();
  refreshModelSelector();
}

// ---- Profile Editor ----
function showProfileEditor(profile) {
  const overlay = document.getElementById('profileEditorOverlay');
  document.getElementById('profileEditorTitle').textContent = profile ? i18n.t('settings.editModelTitle') : i18n.t('settings.addModelTitle');
  document.getElementById('profileEditorId').value = profile ? profile.id : '';
  document.getElementById('profileEditorName').value = profile ? profile.name : '';
  document.getElementById('profileEditorProvider').value = profile ? profile.provider : 'anthropic';
  document.getElementById('profileEditorModel').value = profile ? profile.model : '';
  document.getElementById('profileEditorApiKey').value = '';
  document.getElementById('profileEditorBaseURL').value = profile ? (profile.baseURL || '') : '';
  overlay.style.display = 'flex';
  updateEditorPlaceholders();
}

function hideProfileEditor() {
  document.getElementById('profileEditorOverlay').style.display = 'none';
}

async function testProfile() {
  const id = document.getElementById('profileEditorId').value;
  if (!id) { alert(i18n.t('profile.modelIdRequired')); return; }
  const button = document.getElementById('testProfileBtn');
  if (button) { button.disabled = true; button.textContent = i18n.t('settings.testing'); }
  try {
    const response = await fetch(`${API_BASE}/api/profiles/${encodeURIComponent(id)}/test`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Connection failed');
    alert(i18n.t('settings.connectionPassed'));
  } catch (err) { alert(err.message); }
  finally {
    if (button) { button.disabled = false; button.textContent = i18n.t('settings.testConnection'); }
  }
}

function editProfile(id) {
  const p = profilesCache.find(p => p.id === id);
  if (p) showProfileEditor(p);
}

// Provider change → update model placeholder
document.getElementById('profileEditorProvider').addEventListener('change', updateEditorPlaceholders);
function updateEditorPlaceholders() {
  const prov = document.getElementById('profileEditorProvider').value;
  const m = document.getElementById('profileEditorModel');
  const b = document.getElementById('profileEditorBaseURL');
  if (!m.value) m.placeholder = MODEL_PLACEHOLDERS[prov] || '';
  b.placeholder = BASE_URL_HINTS[prov] || '';
}

async function saveProfile() {
  const id = document.getElementById('profileEditorId').value;
  const apiKey = document.getElementById('profileEditorApiKey').value.trim();
  const profile = {
    id: id || undefined,
    name: document.getElementById('profileEditorName').value.trim(),
    provider: document.getElementById('profileEditorProvider').value,
    model: document.getElementById('profileEditorModel').value.trim(),
    ...(apiKey ? { apiKey } : {}),
    baseURL: document.getElementById('profileEditorBaseURL').value.trim(),
  };

  if (!profile.name) profile.name = profile.model || i18n.t('profile.unnamed');
  if (!profile.model) { alert(i18n.t('profile.modelIdRequired')); return; }

  const response = await fetch(`${API_BASE}/api/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const data = await response.json();
  if (!response.ok) { alert(data.error || 'Failed to save model'); return; }

  hideProfileEditor();
  renderProfileList();
  refreshModelSelector();
}

// =============================================================================
// Utility
// =============================================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =============================================================================
// Theme Management (mirrors upstream OpenMinis Appearance settings)
// =============================================================================

const THEME_KEY = 'openminis-theme';

function resolveAutoTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveAutoLanguage() {
  return (navigator.languages || [navigator.language || 'en']).some(lang => lang.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

function applyTheme(pref) {
  const resolved = pref === 'auto' ? resolveAutoTheme() : pref;
  document.documentElement.setAttribute('data-theme', resolved);
}

function getThemePreference() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

// React to system theme changes when in 'auto' mode
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (getThemePreference() === 'auto') applyTheme('auto');
});

// Re-apply system language when following the system locale.
window.addEventListener('languagechange', () => {
  if (i18n.getLangPreference() === 'auto' && resolveAutoLanguage() !== i18n.getLang()) {
    i18n.setLang('auto');
  }
});

// =============================================================================
// Settings: Soul / Memory / Storage / Logs
// (mirrors upstream OpenMinis settings categories)
// =============================================================================

// ---- Soul ----
async function loadSoul() {
  try {
    const resp = await fetch(`${API_BASE}/api/soul`);
    const data = await resp.json();
    const editor = document.getElementById('soulEditor');
    if (editor) editor.value = data.content || '';
    const status = document.getElementById('soulStatus');
    if (status) status.textContent = '';
  } catch (err) { console.error('Failed to load soul:', err); }
}

async function saveSoul() {
  const editor = document.getElementById('soulEditor');
  if (!editor) return;
  try {
    const response = await fetch(`${API_BASE}/api/soul`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editor.value }),
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to save persona');
    const status = document.getElementById('soulStatus');
    if (status) status.textContent = i18n.t('settings.soulSaved');
  } catch (err) { alert(err.message); }
}

// ---- Memory ----
async function loadMemory() {
  try {
    const resp = await fetch(`${API_BASE}/api/memory`);
    const data = await resp.json();
    const info = document.getElementById('memoryInfo');
    const list = document.getElementById('memoryList');
    if (!info || !list) return;

    if (data.count === 0) {
      info.textContent = i18n.t('settings.noMemories');
      list.innerHTML = '';
      return;
    }

    info.textContent = i18n.t('settings.memoryCount', { n: data.count }) +
      ' · ' + formatBytes(data.totalSize);
    list.innerHTML = data.entries.map(e =>
      `<div class="memory-item"><span class="memory-file">${escapeHtml(e.file)}</span>` +
      `<span class="memory-meta">${e.entries} entries · ${formatBytes(e.size)}</span></div>`
    ).join('');
  } catch (err) { console.error('Failed to load memory:', err); }
}

async function clearMemories() {
  if (!confirm(i18n.t('settings.clearMemoriesConfirm'))) return;
  try {
    const response = await fetch(`${API_BASE}/api/memory`, { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to clear memories');
    loadMemory();
  } catch (err) { alert(err.message); }
}

// ---- Skills ----
let skillsCache = [];
async function loadSkills() {
  try {
    const data = await (await fetch(`${API_BASE}/api/skills`)).json();
    skillsCache = data.skills || [];
    const list = document.getElementById('skillsList');
    if (!list) return;
    if (skillsCache.length === 0) {
      list.innerHTML = `<div class="profile-empty">${escapeHtml(i18n.t('settings.noSkills'))}</div>`;
      return;
    }
    list.innerHTML = skillsCache.map(s => `
      <div class="extension-card">
        <input class="extension-toggle" type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleSkill('${s.id}', this.checked)">
        <div class="extension-card-info">
          <div class="extension-card-name">${escapeHtml(s.name)}</div>
          <div class="extension-card-description">${escapeHtml(s.description || '')}</div>
          <div class="extension-card-meta">${escapeHtml(s.id)} · ${formatBytes(s.size)}</div>
        </div>
        <div class="extension-card-actions">
          <button onclick="editSkill('${s.id}')">${escapeHtml(i18n.t('settings.edit'))}</button>
          <button class="danger" onclick="deleteSkill('${s.id}')">${escapeHtml(i18n.t('settings.delete'))}</button>
        </div>
      </div>`).join('');
  } catch (err) { console.error('Failed to load skills:', err); }
}

async function toggleSkill(id, enabled) {
  try {
    const response = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(id)}/enabled`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to update skill');
    loadSkills();
  } catch (err) { alert(err.message); loadSkills(); }
}

function showSkillEditor(skill) {
  document.getElementById('skillEditorId').value = skill ? skill.id : '';
  document.getElementById('skillEditorName').value = skill ? skill.id : '';
  document.getElementById('skillEditorName').disabled = !!skill;
  document.getElementById('skillEditorContent').value = skill ? skill.content : '';
  document.getElementById('skillEditorTitle').textContent = i18n.t(skill ? 'settings.editSkill' : 'settings.addSkill');
  document.getElementById('skillEditorOverlay').style.display = 'flex';
}
function hideSkillEditor() { document.getElementById('skillEditorOverlay').style.display = 'none'; }
async function editSkill(id) {
  const data = await (await fetch(`${API_BASE}/api/skills/${encodeURIComponent(id)}`)).json();
  if (data.skill) showSkillEditor(data.skill);
}
async function saveSkill() {
  const id = document.getElementById('skillEditorId').value || document.getElementById('skillEditorName').value.trim();
  const content = document.getElementById('skillEditorContent').value;
  if (!id || !content.trim()) return;
  const response = await fetch(`${API_BASE}/api/skills`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id, content, enabled: true }),
  });
  const data = await response.json();
  if (!response.ok) { alert(data.error || 'Failed to save skill'); return; }
  hideSkillEditor(); loadSkills();
}
async function deleteSkill(id) {
  if (!confirm(i18n.t('settings.deleteConfirm'))) return;
  try {
    const response = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete skill');
    loadSkills();
  } catch (err) { alert(err.message); }
}

// ---- MCP Plugins ----
let mcpCache = [];
async function loadMcpServers() {
  try {
    const data = await (await fetch(`${API_BASE}/api/mcp`)).json();
    mcpCache = data.servers || [];
    const list = document.getElementById('mcpList');
    if (!list) return;
    if (mcpCache.length === 0) {
      list.innerHTML = `<div class="profile-empty">${escapeHtml(i18n.t('settings.noPlugins'))}</div>`;
      return;
    }
    list.innerHTML = mcpCache.map(s => `
      <div class="extension-card" id="mcp-card-${s.id}">
        <input class="extension-toggle" type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleMcp('${s.id}', this.checked)">
        <div class="extension-card-info">
          <div class="extension-card-name">${escapeHtml(s.name)}</div>
          <div class="extension-card-description">${escapeHtml(s.transport === 'http' ? (s.url || '') : [s.command, ...(s.args || [])].filter(Boolean).join(' '))}</div>
          <div class="extension-card-meta"><span class="extension-status" id="mcp-status-${s.id}">${escapeHtml(i18n.t(s.enabled ? 'settings.enabled' : 'settings.disabled'))}</span></div>
          <div class="extension-tools" id="mcp-tools-${s.id}" style="display:none;"></div>
        </div>
        <div class="extension-card-actions">
          <button onclick="inspectMcp('${s.id}')">${escapeHtml(i18n.t('settings.inspect'))}</button>
          <button onclick="editMcp('${s.id}')">${escapeHtml(i18n.t('settings.edit'))}</button>
          <button class="danger" onclick="deleteMcp('${s.id}')">${escapeHtml(i18n.t('settings.delete'))}</button>
        </div>
      </div>`).join('');
  } catch (err) { console.error('Failed to load MCP servers:', err); }
}

async function toggleMcp(id, enabled) {
  try {
    const response = await fetch(`${API_BASE}/api/mcp/${encodeURIComponent(id)}/enabled`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to update plugin');
    loadMcpServers();
  } catch (err) { alert(err.message); loadMcpServers(); }
}

function updateMcpFields() {
  const isHttp = document.getElementById('mcpEditorTransport').value === 'http';
  document.getElementById('mcpStdioFields').style.display = isHttp ? 'none' : '';
  document.getElementById('mcpHttpFields').style.display = isHttp ? '' : 'none';
}
function showMcpEditor(server) {
  document.getElementById('mcpEditorId').value = server ? server.id : '';
  document.getElementById('mcpEditorName').value = server ? server.name : '';
  document.getElementById('mcpEditorTransport').value = server ? server.transport : 'stdio';
  document.getElementById('mcpEditorCommand').value = server ? (server.command || '') : '';
  document.getElementById('mcpEditorArgs').value = JSON.stringify(server?.args || [], null, 2);
  document.getElementById('mcpEditorEnv').value = JSON.stringify(server?.env || {}, null, 2);
  document.getElementById('mcpEditorUrl').value = server ? (server.url || '') : '';
  document.getElementById('mcpEditorHeaders').value = JSON.stringify(server?.headers || {}, null, 2);
  document.getElementById('mcpEditorTitle').textContent = i18n.t(server ? 'settings.editPlugin' : 'settings.addPlugin');
  updateMcpFields();
  document.getElementById('mcpEditorOverlay').style.display = 'flex';
}
function hideMcpEditor() { document.getElementById('mcpEditorOverlay').style.display = 'none'; }
function editMcp(id) { const server = mcpCache.find(s => s.id === id); if (server) showMcpEditor(server); }
function parseJsonField(id, fallback) {
  const value = document.getElementById(id).value.trim();
  return value ? JSON.parse(value) : fallback;
}
async function saveMcp() {
  try {
    const id = document.getElementById('mcpEditorId').value;
    const name = document.getElementById('mcpEditorName').value.trim();
    const transport = document.getElementById('mcpEditorTransport').value;
    const payload = { id: id || undefined, name, transport, enabled: true };
    if (transport === 'http') {
      payload.url = document.getElementById('mcpEditorUrl').value.trim();
      payload.headers = parseJsonField('mcpEditorHeaders', {});
    } else {
      payload.command = document.getElementById('mcpEditorCommand').value.trim();
      payload.args = parseJsonField('mcpEditorArgs', []);
      payload.env = parseJsonField('mcpEditorEnv', {});
    }
    const response = await fetch(`${API_BASE}/api/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) { alert(data.error || 'Failed to save plugin'); return; }
    hideMcpEditor(); loadMcpServers();
  } catch (err) { alert(err.message); }
}
async function inspectMcp(id) {
  const status = document.getElementById(`mcp-status-${id}`);
  const tools = document.getElementById(`mcp-tools-${id}`);
  if (status) { status.textContent = i18n.t('sidebar.processing'); status.className = 'extension-status'; }
  try {
    const response = await fetch(`${API_BASE}/api/mcp/${encodeURIComponent(id)}/inspect`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Connection failed');
    if (status) {
      status.textContent = i18n.t(data.status === 'connected' ? 'settings.connected' : 'settings.disconnected');
      status.className = `extension-status ${data.status === 'connected' ? 'connected' : 'error'}`;
    }
    if (tools) {
      tools.style.display = '';
      tools.textContent = data.status === 'connected'
        ? i18n.t('settings.toolsCount', { n: data.tools.length }) + (data.tools.length ? ': ' + data.tools.map(t => t.name).join(', ') : '')
        : (data.error || 'Connection failed');
    }
  } catch (err) {
    if (status) { status.textContent = i18n.t('settings.disconnected'); status.className = 'extension-status error'; }
    if (tools) { tools.style.display = ''; tools.textContent = err.message; }
  }
}
async function deleteMcp(id) {
  if (!confirm(i18n.t('settings.deleteConfirm'))) return;
  try {
    const response = await fetch(`${API_BASE}/api/mcp/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete plugin');
    loadMcpServers();
  } catch (err) { alert(err.message); }
}

// ---- Storage ----
async function loadStorage() {
  try {
    const resp = await fetch(`${API_BASE}/api/storage`);
    const data = await resp.json();
    const el = document.getElementById('storageStats');
    if (!el) return;
    el.innerHTML = [
      statRow(i18n.t('settings.storageSessions'), data.sessions),
      statRow(i18n.t('settings.storageMessages'), data.messages),
      statRow(i18n.t('settings.storageMemory'), data.memoryFiles),
      statRow(i18n.t('settings.storageSkills'), data.skills || 0),
      statRow(i18n.t('settings.storageMcp'), data.mcpServers || 0),
      statRow(i18n.t('settings.storageTotal'), formatBytes(data.totalSize)),
    ].join('');
  } catch (err) { console.error('Failed to load storage:', err); }
}

// ---- Logs ----
async function loadLogs() {
  try {
    const resp = await fetch(`${API_BASE}/api/logs`);
    const data = await resp.json();
    const el = document.getElementById('logsView');
    if (!el) return;
    el.textContent = data.logs.length > 0
      ? data.logs.join('\n')
      : i18n.t('settings.noLogs');
  } catch (err) { console.error('Failed to load logs:', err); }
}

async function clearLogs() {
  try {
    const response = await fetch(`${API_BASE}/api/logs`, { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to clear logs');
    loadLogs();
  } catch (err) { alert(err.message); }
}

// ---- Helpers ----
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function statRow(label, value) {
  return `<div class="stat-row"><span class="stat-label">${escapeHtml(String(label))}</span>` +
    `<span class="stat-value">${escapeHtml(String(value))}</span></div>`;
}

// Load all settings-panel data
function loadAllSettings() {
  loadSoul();
  loadMemory();
  loadSkills();
  loadMcpServers();
  loadStorage();
  loadLogs();
}

// =============================================================================
// Initialize
// =============================================================================

// Settings are refreshed by the navigation handler above.

// Start
async function init() {
  // Apply translations to static DOM
  i18n.apply();
  // Attach quick-action handlers for the static welcome screen
  attachQuickActions();

  // Language selector
  const langSel = document.getElementById('langSelector');
  if (langSel) {
    langSel.value = i18n.getLangPreference();
    langSel.addEventListener('change', () => {
      i18n.setLang(langSel.value);
    });
  }

  // Theme selector
  const themeSel = document.getElementById('themeSelector');
  if (themeSel) {
    themeSel.value = getThemePreference();
    applyTheme(themeSel.value);
    themeSel.addEventListener('change', () => {
      localStorage.setItem(THEME_KEY, themeSel.value);
      applyTheme(themeSel.value);
    });
  }

  // Soul editor
  const soulSaveBtn = document.getElementById('soulSaveBtn');
  if (soulSaveBtn) soulSaveBtn.addEventListener('click', saveSoul);
  const testProfileBtn = document.getElementById('testProfileBtn');
  if (testProfileBtn) testProfileBtn.addEventListener('click', testProfile);

  // Memory management
  const clearMemBtn = document.getElementById('clearMemoriesBtn');
  if (clearMemBtn) clearMemBtn.addEventListener('click', clearMemories);

  // Skills management
  const addSkillBtn = document.getElementById('addSkillBtn');
  if (addSkillBtn) addSkillBtn.addEventListener('click', () => showSkillEditor());
  const saveSkillBtn = document.getElementById('saveSkillBtn');
  if (saveSkillBtn) saveSkillBtn.addEventListener('click', saveSkill);
  const cancelSkillBtn = document.getElementById('cancelSkillBtn');
  if (cancelSkillBtn) cancelSkillBtn.addEventListener('click', hideSkillEditor);

  // MCP plugin management
  const addMcpBtn = document.getElementById('addMcpBtn');
  if (addMcpBtn) addMcpBtn.addEventListener('click', () => showMcpEditor());
  const saveMcpBtn = document.getElementById('saveMcpBtn');
  if (saveMcpBtn) saveMcpBtn.addEventListener('click', saveMcp);
  const cancelMcpBtn = document.getElementById('cancelMcpBtn');
  if (cancelMcpBtn) cancelMcpBtn.addEventListener('click', hideMcpEditor);
  const mcpTransport = document.getElementById('mcpEditorTransport');
  if (mcpTransport) mcpTransport.addEventListener('change', updateMcpFields);

  // Storage
  const refreshStorageBtn = document.getElementById('refreshStorageBtn');
  if (refreshStorageBtn) refreshStorageBtn.addEventListener('click', loadStorage);

  // Logs
  const refreshLogsBtn = document.getElementById('refreshLogsBtn');
  if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', loadLogs);
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  if (clearLogsBtn) clearLogsBtn.addEventListener('click', clearLogs);

  // Re-render dynamic content when language changes
  i18n.onChange(() => {
    // Re-render welcome if visible
    const welcome = chatMessages.querySelector('.welcome');
    if (welcome) showWelcome();
    // Re-render session list (time labels, empty state)
    renderSessionList();
    // Re-render profile list if in settings view
    if (document.getElementById('view-settings').classList.contains('active')) {
      renderProfileList();
      loadAllSettings();
    }
    // Update model selector placeholder
    if (profilesCache.length === 0) refreshModelSelector();
    // Re-apply static DOM translations
    i18n.apply();
    // Update lang selector to reflect resolved preference
    if (langSel) langSel.value = i18n.getLangPreference();
  });

  await refreshModelSelector();
  await loadSessionList();
}

init();
