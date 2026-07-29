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
      loadSettings();
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
    sessionsList.innerHTML = '<div class="sessions-empty">No conversations yet</div>';
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

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
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
                  <span class="tool-status done">✓ done</span>
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
  if (!confirm('Delete this conversation?')) return;

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
      <h2>Welcome to OpenMinis PC</h2>
      <p>Your private, on-device AI agent with a real shell.</p>
      <div class="quick-actions">
        <button class="quick-btn" onclick="sendQuick('List files in the current directory')">📂 List files</button>
        <button class="quick-btn" onclick="sendQuick('What is my operating system and hardware?')">💻 System info</button>
        <button class="quick-btn" onclick="sendQuick('Create a simple Python web server script')">🐍 Python script</button>
      </div>
    </div>
  `;
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
      searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
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
    thinkBlock.textContent = '🤔 Thinking...';
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
      <span class="tool-status running">running...</span>
    </div>
    <div class="tool-body" id="tool-body-${id}">
      <div class="tool-args">Preparing...</div>
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
    statusEl.textContent = success ? '✓ done' : '✗ error';
    statusEl.className = `tool-status ${success ? 'done' : 'error'}`;
  }

  const bodyEl = info.block.querySelector('.tool-body');
  if (bodyEl) {
    const truncated = output.length > 5000
      ? output.substring(0, 5000) + '\n\n... (truncated)'
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
  cancelNote.textContent = '⏹ Task cancelled.';
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
  label.textContent = role === 'user' ? 'You' : 'Minis';

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
    statusText.textContent = 'Processing...';
  } else {
    statusDot.className = 'status-dot';
    statusText.textContent = 'Ready';
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
    sel.innerHTML = '<option value="">— No model configured —</option>';
    hint.textContent = '⚙️ Add models in Settings';
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
    list.innerHTML = '<div class="profile-empty">No models configured yet. Click "+ Add Model" to get started.</div>';
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
  if (!confirm('Delete this model profile?')) return;
  await fetch(`${API_BASE}/api/profiles/${id}`, { method: 'DELETE' });
  renderProfileList();
  refreshModelSelector();
}

// ---- Profile Editor ----
function showProfileEditor(profile) {
  const overlay = document.getElementById('profileEditorOverlay');
  document.getElementById('profileEditorTitle').textContent = profile ? 'Edit Model' : 'Add Model';
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
  const profile = {
    id: id || undefined,
    name: document.getElementById('profileEditorName').value.trim(),
    provider: document.getElementById('profileEditorProvider').value,
    model: document.getElementById('profileEditorModel').value.trim(),
    apiKey: document.getElementById('profileEditorApiKey').value.trim(),
    baseURL: document.getElementById('profileEditorBaseURL').value.trim(),
  };

  if (!profile.name) profile.name = profile.model || 'Unnamed';
  if (!profile.model) { alert('Model ID is required.'); return; }

  await fetch(`${API_BASE}/api/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });

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
// Initialize
// =============================================================================

// When entering settings view, refresh the list
const settingsBtn = document.querySelector('[data-view="settings"]');
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    renderProfileList();
  });
}

// Start
async function init() {
  await refreshModelSelector();
  await loadSessionList();
}

init();
