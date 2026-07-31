// =============================================================================
// OpenMinis PC - HTTP Server (multi-model profiles)
// =============================================================================

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { AgentLoop, AgentLoopConfig } from './agent/AgentLoop';
import { ProviderFactory } from './providers/ProviderFactory';
import { makeAgentTools } from './tools/ToolDefinitions';
import { AgentLoopCallbacks, LLMUsage, ProviderType } from './providers/types';
import { SkillManager } from './skills/SkillManager';
import { MCPManager, MCPServerConfig } from './mcp/MCPManager';

const PORT = 19840;
const WORKSPACE_DIR = process.env.OPENMINIS_WORKSPACE || path.join(process.cwd(), 'workspace');
const MEMORY_DIR = path.join(WORKSPACE_DIR, '.minis-memory');
const SETTINGS_FILE = path.join(WORKSPACE_DIR, '.minis-settings.json');
const SESSIONS_FILE = path.join(WORKSPACE_DIR, '.minis-sessions.json');
const SESSIONS_DIR = path.join(WORKSPACE_DIR, '.minis-sessions');
const SOUL_FILE = path.join(WORKSPACE_DIR, '.minis-soul.md');
const LOGS_FILE = path.join(WORKSPACE_DIR, '.minis-logs.json');
const RENDERER_DIR = path.resolve(__dirname, '..', '..', 'src', 'renderer');

// ---- Log buffer (persistent ring buffer) ----
const MAX_LOGS = 500;
function loadLogBuffer(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed.slice(-MAX_LOGS).map(String) : [];
  } catch { return []; }
}
const logBuffer: string[] = loadLogBuffer();
function persistLogs(): void {
  try { fs.writeFileSync(LOGS_FILE, JSON.stringify(logBuffer, null, 2), 'utf-8'); } catch { /* logging must not break the app */ }
}
function addLog(level: string, msg: string): void {
  const entry = `[${new Date().toISOString()}] [${level}] ${msg}`;
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.splice(0, logBuffer.length - MAX_LOGS);
  persistLogs();
}

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
fs.mkdirSync(MEMORY_DIR, { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const skillManager = new SkillManager(WORKSPACE_DIR);
const mcpManager = new MCPManager(WORKSPACE_DIR);

// ---- Profile Types ----
interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
}

interface AppSettings {
  profiles: ModelProfile[];
  activeProfileId: string;
}

// ---- Settings I/O ----
function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      // Migrate old format
      if (!raw.profiles && raw.provider) {
        return {
          profiles: [{
            id: 'default',
            name: 'Default',
            provider: raw.provider || 'anthropic',
            model: raw.model || 'claude-sonnet-4-20250514',
            apiKey: raw.apiKey || '',
            baseURL: raw.baseURL || '',
          }],
          activeProfileId: 'default',
        };
      }
      return {
        profiles: raw.profiles || [],
        activeProfileId: raw.activeProfileId || raw.profiles?.[0]?.id || '',
      };
    }
  } catch { /* ignore */ }
  return { profiles: [], activeProfileId: '' };
}

function saveSettings(s: AppSettings): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

function activeProfile(): ModelProfile | null {
  const s = loadSettings();
  return s.profiles.find(p => p.id === s.activeProfileId) || s.profiles[0] || null;
}

function maskKey(key: string): string {
  if (!key || key.length < 12) return key ? '***' : '';
  return key.substring(0, 8) + '...' + key.substring(key.length - 4);
}

// ---- Session Types ----
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  usage?: { inputTokens: number; outputTokens: number };
  timestamp: number;
}

interface Session {
  id: string;
  title: string;
  created: number;
  updated: number;
  messageCount: number;
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string;
}

// ---- Session I/O ----
function loadSessionStore(): SessionStore {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { sessions: [], activeSessionId: '' };
}

function saveSessionStore(s: SessionStore): void {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

function loadMessages(sessionId: string): ChatMessage[] {
  try {
    const fp = path.join(SESSIONS_DIR, sessionId + '.json');
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveMessages(sessionId: string, msgs: ChatMessage[]): void {
  const fp = path.join(SESSIONS_DIR, sessionId + '.json');
  fs.writeFileSync(fp, JSON.stringify(msgs, null, 2), 'utf-8');
}

// ---- AgentLoop Cache (per session) ----
const agentCache = new Map<string, AgentLoop>();

function getOrCreateAgent(sessionId: string): AgentLoop | null {
  let agent = agentCache.get(sessionId);
  if (agent) return agent;

  const profile = activeProfile();
  if (!profile || !profile.apiKey) return null;

  const provider = ProviderFactory.create({
    type: profile.provider as ProviderType,
    name: profile.provider,
    model: profile.model,
    apiKey: profile.apiKey,
    baseURL: profile.baseURL || undefined,
  });

  const config: AgentLoopConfig = {
    provider, workspaceDir: WORKSPACE_DIR, memoryDir: MEMORY_DIR,
    memoryEnabled: true, maxTokens: 64000,
  };
  agent = new AgentLoop(config);
  agentCache.set(sessionId, agent);
  return agent;
}

function cancelSessionAgent(sessionId: string): void {
  const agent = agentCache.get(sessionId);
  if (agent) {
    agent.cancel();
    agentCache.delete(sessionId);
  }
}

function resetAllAgents(): void {
  for (const sessionId of Array.from(agentCache.keys())) cancelSessionAgent(sessionId);
}

async function testProfileConnection(profile: ModelProfile): Promise<void> {
  if (!profile.apiKey) throw new Error('API key is required');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let url: string;
    let body: Record<string, unknown>;
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (profile.provider === 'anthropic') {
      url = `${(profile.baseURL || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`;
      headers = { ...headers, 'x-api-key': profile.apiKey, 'anthropic-version': '2023-06-01' };
      body = { model: profile.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] };
    } else if (profile.provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(profile.model)}:generateContent?key=${encodeURIComponent(profile.apiKey)}`;
      body = { contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } };
    } else {
      let base = profile.baseURL || (profile.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : profile.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : profile.provider === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com');
      base = base.replace(/\/+$/, '');
      if (!base.endsWith('/v1')) base += '/v1';
      url = `${base}/chat/completions`;
      headers = { ...headers, Authorization: `Bearer ${profile.apiKey}` };
      body = { model: profile.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] };
    }
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('Connection timed out');
    throw error;
  } finally { clearTimeout(timeout); }
}

// Helper: persist chat messages after a turn
function saveSessionMessages(
  sessionId: string,
  existingMessages: ChatMessage[],
  userMsg: ChatMessage,
  assistantText: string,
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[],
  usage: { inputTokens: number; outputTokens: number } | undefined,
): void {
  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: assistantText,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: usage,
    timestamp: Date.now(),
  };
  const updatedMessages = [...existingMessages, userMsg, assistantMsg];

  // Limit to last 200 messages per session (prevent bloat)
  const trimmed = updatedMessages.length > 200
    ? updatedMessages.slice(updatedMessages.length - 200)
    : updatedMessages;

  saveMessages(sessionId, trimmed);

  // Update session metadata
  const store = loadSessionStore();
  const sess = store.sessions.find(s => s.id === sessionId);
  if (sess) {
    sess.messageCount = trimmed.length;
    sess.updated = Date.now();
    saveSessionStore(store);
  }
}

// ---- Agent (per session) ----
// Agents are now cached per session via getOrCreateAgent()/cancelSessionAgent()
// See agentCache Map above.

// ---- MIME ----
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  let fp = req.url === '/' ? '/index.html' : req.url || '/index.html';
  fp = path.join(RENDERER_DIR, fp);
  const ext = path.extname(fp);
  try {
    const content = fs.readFileSync(fp);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}

function sendSSE(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function jsonReply(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
  });
}

// ---- Create Server ----
function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // =====================================================================
    // Search API — fuzzy search across all session messages
    // =====================================================================
    if (url.pathname === '/api/search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      if (!q) { jsonReply(res, 200, { results: [] }); return; }

      const store = loadSessionStore();
      const results: { session: Session; matches: { role: string; snippet: string }[] }[] = [];

      for (const sess of store.sessions) {
        const msgs = loadMessages(sess.id);
        const matches: { role: string; snippet: string }[] = [];
        for (const msg of msgs) {
          const content = msg.content.toLowerCase();
          if (content.includes(q)) {
            // Extract snippet around the match
            const idx = content.indexOf(q);
            const start = Math.max(0, idx - 40);
            const end = Math.min(content.length, idx + q.length + 40);
            let snippet = msg.content.substring(start, end);
            if (start > 0) snippet = '...' + snippet;
            if (end < msg.content.length) snippet += '...';
            matches.push({ role: msg.role, snippet });
            if (matches.length >= 5) break; // max 5 matches per session
          }
        }
        if (matches.length > 0) {
          results.push({ session: sess, matches });
        }
      }

      jsonReply(res, 200, { results, query: q });
      return;
    }

    // =====================================================================
    // Sessions API (CRUD)
    // =====================================================================
    if (url.pathname === '/api/sessions') {
      if (req.method === 'GET') {
        const store = loadSessionStore();
        // Sort newest first
        store.sessions.sort((a, b) => b.updated - a.updated);
        jsonReply(res, 200, { sessions: store.sessions, activeSessionId: store.activeSessionId });
        return;
      }

      if (req.method === 'POST') {
        const store = loadSessionStore();
        const session: Session = {
          id: 'sess_' + Date.now(),
          title: 'New Chat',
          created: Date.now(),
          updated: Date.now(),
          messageCount: 0,
        };
        store.sessions.push(session);
        store.activeSessionId = session.id;
        saveSessionStore(store);
        saveMessages(session.id, []);
        addLog('info', `Session created: ${session.id}`);
        jsonReply(res, 200, { session });
        return;
      }
    }

    // GET /api/sessions/:id — load messages
    // PUT /api/sessions/:id — rename
    // DELETE /api/sessions/:id — delete
    if (url.pathname.startsWith('/api/sessions/')) {
      const sid = url.pathname.split('/').pop() || '';

      if (req.method === 'GET') {
        const msgs = loadMessages(sid);
        jsonReply(res, 200, { messages: msgs });
        return;
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        try {
          const { title } = JSON.parse(body);
          const store = loadSessionStore();
          const s = store.sessions.find(s => s.id === sid);
          if (s) {
            s.title = title || s.title;
            s.updated = Date.now();
            saveSessionStore(store);
            jsonReply(res, 200, { ok: true });
          } else {
            jsonReply(res, 404, { error: 'Session not found' });
          }
        } catch { jsonReply(res, 400, { error: 'Invalid JSON' }); }
        return;
      }

      if (req.method === 'DELETE') {
        cancelSessionAgent(sid);
        const store = loadSessionStore();
        store.sessions = store.sessions.filter(s => s.id !== sid);
        if (store.activeSessionId === sid) {
          store.activeSessionId = store.sessions[0]?.id || '';
        }
        saveSessionStore(store);
        // Delete message file
        const fp = path.join(SESSIONS_DIR, sid + '.json');
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* ignore */ }
        jsonReply(res, 200, { ok: true, activeSessionId: store.activeSessionId });
        return;
      }
    }

    // =====================================================================
    // Chat API
    // =====================================================================
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { message, sessionId } = JSON.parse(body);
        if (!message) throw new Error('message required');
        if (!sessionId) throw new Error('sessionId required');

        const profile = activeProfile();
        if (!profile || !profile.apiKey) {
          jsonReply(res, 400, { error: 'Please configure at least one AI model in Settings first.' });
          return;
        }

        // Reuse the per-session agent so conversation history survives across turns.
        // The explicit cancel endpoint remains available for user cancellation.
        addLog('info', `Chat request: session=${sessionId} model=${profile.provider}/${profile.model}`);
        const agent = getOrCreateAgent(sessionId);
        if (!agent) {
          jsonReply(res, 400, { error: 'Failed to create agent.' });
          return;
        }
        await agent.initialize();
        const tools = makeAgentTools(true);

        // Save user message
        const userMsg: ChatMessage = { role: 'user', content: message, timestamp: Date.now() };
        const existingMessages = loadMessages(sessionId);

        // Auto-title: use first user message if title is still "New Chat"
        const store = loadSessionStore();
        const sess = store.sessions.find(s => s.id === sessionId);
        if (sess && sess.title === 'New Chat' && existingMessages.length === 0) {
          sess.title = message.substring(0, 40) + (message.length > 40 ? '...' : '');
          sess.updated = Date.now();
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });

        // Accumulate assistant response for saving
        let assistantFullText = '';
        let assistantToolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
        let lastUsage: { inputTokens: number; outputTokens: number } | undefined;

        const cb: AgentLoopCallbacks = {
          onTextDelta: (_t, ft) => {
            assistantFullText = ft;
            sendSSE(res, 'text', { content: ft });
          },
          onThinkingDelta: t => sendSSE(res, 'thinking', { content: t }),
          onToolCallStart: (id, name) => sendSSE(res, 'tool_start', { id, name }),
          onToolInputDelta: (name, acc) => sendSSE(res, 'tool_input', { name, args: acc }),
          onToolCallComplete: (id, name, args) => {
            assistantToolCalls.push({ id, name, args });
            sendSSE(res, 'tool_complete', { id, name, args });
          },
          onToolResult: (id, r) => sendSSE(res, 'tool_result', { id, output: r.output, success: r.success }),
          onUsage: (u: LLMUsage) => {
            lastUsage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens };
            sendSSE(res, 'usage', u);
          },
          onError: (e) => {
            sendSSE(res, 'error', { message: e });
            res.end();
            addLog('error', `Chat error (session=${sessionId}): ${e}`);
            // Save partial
            saveSessionMessages(sessionId, existingMessages, userMsg, assistantFullText, assistantToolCalls, lastUsage);
          },
          onDone: (sr) => {
            sendSSE(res, 'done', { stopReason: sr });
            addLog('info', `Chat done (session=${sessionId}): ${sr}`);
            res.end();
            saveSessionMessages(sessionId, existingMessages, userMsg, assistantFullText, assistantToolCalls, lastUsage);
          },
          onCancelled: () => {
            sendSSE(res, 'cancelled', {});
            res.end();
            saveSessionMessages(sessionId, existingMessages, userMsg, assistantFullText, assistantToolCalls, lastUsage);
          },
        };
        await agent.run(message, tools, cb);
      } catch (err: unknown) {
        if (!res.headersSent) jsonReply(res, 500, { error: (err as Error).message });
      }
      return;
    }

    if (url.pathname === '/api/cancel') {
      let sessionId = url.searchParams.get('sessionId') || '';
      if (!sessionId) {
        // Legacy fallback: try reading body
        try {
          const body = await readBody(req);
          const parsed = JSON.parse(body);
          sessionId = parsed.sessionId || '';
        } catch { /* ignore */ }
      }
      if (sessionId) {
        cancelSessionAgent(sessionId);
      }
      jsonReply(res, 200, { ok: true });
      return;
    }

    // =====================================================================
    // Profiles API (CRUD)
    // =====================================================================
    if (url.pathname === '/api/profiles') {
      if (req.method === 'GET') {
        const s = loadSettings();
        const masked = s.profiles.map(p => ({ ...p, apiKey: maskKey(p.apiKey) }));
        jsonReply(res, 200, { profiles: masked, activeProfileId: s.activeProfileId });
        return;
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        try {
          const incoming = JSON.parse(body) as Partial<ModelProfile>;
          const s = loadSettings();
          if (!incoming.id) incoming.id = 'p_' + Date.now();
          const existing = s.profiles.find(p => p.id === incoming.id);
          const profile: ModelProfile = {
            id: incoming.id,
            name: incoming.name || incoming.model || existing?.name || 'Unnamed',
            provider: incoming.provider || existing?.provider || 'openai',
            model: incoming.model || existing?.model || '',
            apiKey: incoming.apiKey || existing?.apiKey || '',
            baseURL: incoming.baseURL !== undefined ? incoming.baseURL : (existing?.baseURL || ''),
          };
          if (!profile.model) throw new Error('Model is required');
          if (!profile.apiKey) throw new Error('API key is required for a new model');
          const idx = s.profiles.findIndex(p => p.id === profile.id);
          if (idx >= 0) s.profiles[idx] = profile;
          else s.profiles.push(profile);
          if (!s.activeProfileId) s.activeProfileId = profile.id;
          saveSettings(s);
          resetAllAgents();
          jsonReply(res, 200, { ok: true, profile: { ...profile, apiKey: maskKey(profile.apiKey) } });
        } catch { jsonReply(res, 400, { error: 'Invalid JSON' }); }
        return;
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        try {
          const { activeProfileId } = JSON.parse(body);
          const s = loadSettings();
          if (s.profiles.find(p => p.id === activeProfileId)) {
            s.activeProfileId = activeProfileId;
            saveSettings(s);
            resetAllAgents();
            jsonReply(res, 200, { ok: true });
          } else {
            jsonReply(res, 404, { error: 'Profile not found' });
          }
        } catch { jsonReply(res, 400, { error: 'Invalid JSON' }); }
        return;
      }
    }

    // POST /api/profiles/:id/test — validate provider credentials
    if (url.pathname.startsWith('/api/profiles/') && url.pathname.endsWith('/test') && req.method === 'POST') {
      const id = url.pathname.split('/').filter(Boolean)[2] || '';
      const profile = loadSettings().profiles.find(p => p.id === id);
      if (!profile) { jsonReply(res, 404, { error: 'Profile not found' }); return; }
      try {
        await testProfileConnection(profile);
        addLog('info', `Provider connection test passed: ${id}`);
        jsonReply(res, 200, { ok: true });
      } catch (err) {
        addLog('warn', `Provider connection test failed: ${id}`);
        jsonReply(res, 502, { error: (err as Error).message });
      }
      return;
    }

    // DELETE /api/profiles/:id
    if (url.pathname.startsWith('/api/profiles/') && req.method === 'DELETE') {
      const id = url.pathname.split('/').pop() || '';
      const s = loadSettings();
      const before = s.profiles.length;
      s.profiles = s.profiles.filter(p => p.id !== id);
      if (s.profiles.length === before) { jsonReply(res, 404, { error: 'Profile not found' }); return; }
      if (s.activeProfileId === id) s.activeProfileId = s.profiles[0]?.id || '';
      saveSettings(s);
      resetAllAgents();
      jsonReply(res, 200, { ok: true });
      return;
    }

    // =====================================================================
    // Active profile info
    // =====================================================================
    if (url.pathname === '/api/active-profile' && req.method === 'GET') {
      const p = activeProfile();
      if (p) {
        jsonReply(res, 200, { id: p.id, name: p.name, provider: p.provider, model: p.model });
      } else {
        jsonReply(res, 200, { id: '', name: 'No model', provider: '', model: '' });
      }
      return;
    }

    // =====================================================================
    // Legacy compat + reset
    // =====================================================================
    if (url.pathname === '/api/settings') {
      if (req.method === 'GET') {
        const p = activeProfile();
        jsonReply(res, 200, {
          provider: p?.provider || '',
          model: p?.model || '',
          apiKey: maskKey(p?.apiKey || ''),
        });
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        try {
          const d = JSON.parse(body);
          if (d.provider && d.apiKey) {
            const profile: ModelProfile = {
              id: 'default', name: d.model || 'Default',
              provider: d.provider, model: d.model || '', apiKey: d.apiKey,
              baseURL: d.baseURL || '',
            };
            saveSettings({ profiles: [profile], activeProfileId: 'default' });
          }
          jsonReply(res, 200, { ok: true });
        } catch { jsonReply(res, 400, { error: 'Invalid JSON' }); }
        return;
      }
    }

    if (url.pathname === '/api/reset') {
      let sessionId = url.searchParams.get('sessionId') || '';
      if (sessionId) {
        cancelSessionAgent(sessionId);
      }
      jsonReply(res, 200, { ok: true });
      return;
    }

    // =====================================================================
    // Skills API — workspace SKILL.md management
    // =====================================================================
    if (url.pathname === '/api/skills') {
      if (req.method === 'GET') {
        jsonReply(res, 200, { skills: skillManager.list() });
        return;
      }
      if (req.method === 'POST') {
        try {
          const input = JSON.parse(await readBody(req));
          const skill = skillManager.save(input);
          addLog('info', `Skill saved: ${skill.id}`);
          jsonReply(res, 200, { ok: true, skill });
        } catch (err) { jsonReply(res, 400, { error: (err as Error).message }); }
        return;
      }
    }
    if (url.pathname.startsWith('/api/skills/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = decodeURIComponent(parts[2] || '');
      if (parts[3] === 'enabled' && req.method === 'PUT') {
        try {
          const { enabled } = JSON.parse(await readBody(req));
          skillManager.setEnabled(id, enabled === true);
          jsonReply(res, 200, { ok: true });
        } catch (err) { jsonReply(res, 400, { error: (err as Error).message }); }
        return;
      }
      if (req.method === 'GET') {
        try { jsonReply(res, 200, { skill: skillManager.get(id) }); }
        catch (err) { jsonReply(res, 404, { error: (err as Error).message }); }
        return;
      }
      if (req.method === 'DELETE') {
        try {
          skillManager.remove(id);
          addLog('info', `Skill removed: ${id}`);
          jsonReply(res, 200, { ok: true });
        } catch (err) { jsonReply(res, 404, { error: (err as Error).message }); }
        return;
      }
    }

    // =====================================================================
    // MCP API — server config, status and tool discovery
    // =====================================================================
    if (url.pathname === '/api/mcp') {
      if (req.method === 'GET') {
        jsonReply(res, 200, { servers: mcpManager.listConfigs() });
        return;
      }
      if (req.method === 'POST') {
        try {
          const config = mcpManager.save(JSON.parse(await readBody(req)) as MCPServerConfig);
          addLog('info', `MCP server saved: ${config.id}`);
          jsonReply(res, 200, { ok: true, server: config });
        } catch (err) { jsonReply(res, 400, { error: (err as Error).message }); }
        return;
      }
    }
    if (url.pathname.startsWith('/api/mcp/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = decodeURIComponent(parts[2] || '');
      if (parts[3] === 'enabled' && req.method === 'PUT') {
        try {
          const { enabled } = JSON.parse(await readBody(req));
          mcpManager.setEnabled(id, enabled === true);
          jsonReply(res, 200, { ok: true });
        } catch (err) { jsonReply(res, 400, { error: (err as Error).message }); }
        return;
      }
      if (parts[3] === 'inspect' && req.method === 'GET') {
        try { jsonReply(res, 200, await mcpManager.inspect(id)); }
        catch (err) { jsonReply(res, 404, { error: (err as Error).message }); }
        return;
      }
      if (req.method === 'DELETE') {
        try {
          mcpManager.remove(id);
          addLog('info', `MCP server removed: ${id}`);
          jsonReply(res, 200, { ok: true });
        } catch (err) { jsonReply(res, 404, { error: (err as Error).message }); }
        return;
      }
    }

    // =====================================================================
    // Memory API — list / clear memories (mirrors upstream Memory settings)
    // =====================================================================
    if (url.pathname === '/api/memory') {
      if (req.method === 'GET') {
        try {
          const files = fs.existsSync(MEMORY_DIR)
            ? fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md')).sort().reverse()
            : [];
          const entries = files.map(f => {
            const fp = path.join(MEMORY_DIR, f);
            const stat = fs.statSync(fp);
            const content = fs.readFileSync(fp, 'utf-8');
            const entryCount = (content.match(/^### /gm) || []).length;
            return { file: f, size: stat.size, entries: entryCount, modified: stat.mtime.toISOString() };
          });
          const totalSize = entries.reduce((s, e) => s + e.size, 0);
          jsonReply(res, 200, { entries, count: entries.length, totalSize });
        } catch (err) {
          jsonReply(res, 500, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === 'DELETE') {
        try {
          if (fs.existsSync(MEMORY_DIR)) {
            for (const f of fs.readdirSync(MEMORY_DIR)) {
              if (f.endsWith('.md')) fs.unlinkSync(path.join(MEMORY_DIR, f));
            }
          }
          addLog('info', 'All memories cleared');
          jsonReply(res, 200, { ok: true });
        } catch (err) {
          jsonReply(res, 500, { error: (err as Error).message });
        }
        return;
      }
    }

    // =====================================================================
    // Soul API — read / write persona (mirrors upstream Soul settings)
    // =====================================================================
    if (url.pathname === '/api/soul') {
      if (req.method === 'GET') {
        try {
          const content = fs.existsSync(SOUL_FILE)
            ? fs.readFileSync(SOUL_FILE, 'utf-8')
            : '';
          jsonReply(res, 200, { content });
        } catch (err) {
          jsonReply(res, 500, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        try {
          const { content } = JSON.parse(body);
          fs.writeFileSync(SOUL_FILE, content || '', 'utf-8');
          addLog('info', 'Soul/persona updated');
          jsonReply(res, 200, { ok: true });
        } catch (err) {
          jsonReply(res, 400, { error: (err as Error).message });
        }
        return;
      }
    }

    // =====================================================================
    // Storage API — workspace stats (mirrors upstream Storage settings)
    // =====================================================================
    if (url.pathname === '/api/storage' && req.method === 'GET') {
      try {
        function dirSize(dir: string): number {
          let size = 0;
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, entry.name);
              if (entry.isDirectory()) size += dirSize(p);
              else try { size += fs.statSync(p).size; } catch { /* skip */ }
            }
          } catch { /* skip */ }
          return size;
        }

        const store = loadSessionStore();
        let messageCount = 0;
        for (const s of store.sessions) {
          messageCount += loadMessages(s.id).length;
        }

        const memorySize = dirSize(MEMORY_DIR);
        const sessionsSize = dirSize(SESSIONS_DIR);
        const skillsSize = dirSize(path.join(WORKSPACE_DIR, '.minis-skills'));
        const settingsSize = fs.existsSync(SETTINGS_FILE) ? fs.statSync(SETTINGS_FILE).size : 0;
        const soulSize = fs.existsSync(SOUL_FILE) ? fs.statSync(SOUL_FILE).size : 0;
        const extensionsSize = ['.minis-skills.json', '.minis-mcp.json', LOGS_FILE].reduce((sum, filename) => {
          const file = path.join(WORKSPACE_DIR, filename);
          return sum + (fs.existsSync(file) ? fs.statSync(file).size : 0);
        }, 0);

        jsonReply(res, 200, {
          sessions: store.sessions.length,
          messages: messageCount,
          memoryFiles: fs.existsSync(MEMORY_DIR) ? fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md')).length : 0,
          skills: skillManager.list().length,
          mcpServers: mcpManager.listConfigs().length,
          memorySize,
          sessionsSize,
          skillsSize,
          settingsSize,
          soulSize,
          extensionsSize,
          totalSize: memorySize + sessionsSize + skillsSize + settingsSize + soulSize + extensionsSize,
        });
      } catch (err) {
        jsonReply(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // =====================================================================
    // Logs API — view / clear logs (mirrors upstream Logs settings)
    // =====================================================================
    if (url.pathname === '/api/logs') {
      if (req.method === 'GET') {
        jsonReply(res, 200, { logs: logBuffer.slice().reverse(), count: logBuffer.length });
        return;
      }
      if (req.method === 'DELETE') {
        logBuffer.length = 0;
        persistLogs();
        jsonReply(res, 200, { ok: true });
        return;
      }
    }

    serveStatic(req, res);
  });
}

// ---- Export ----
export function startServer(port: number = PORT, autoOpen: boolean = true): Promise<http.Server> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(port, () => {
      console.log(`OpenMinis server running on http://localhost:${port}`);
      if (autoOpen) {
        const { exec } = require('child_process');
        const cmd = process.platform === 'win32'
          ? `start http://localhost:${port}`
          : process.platform === 'darwin'
            ? `open http://localhost:${port}`
            : `xdg-open http://localhost:${port}`;
        exec(cmd);
      }
      resolve(srv);
    });
  });
}

const isDirectRun = require.main === module;
if (isDirectRun) {
  startServer(PORT, true).then(() => {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║          OpenMinis PC Client                 ║`);
    console.log(`║  Server: http://localhost:${PORT}                 ║`);
    console.log(`╚══════════════════════════════════════════════╝\n`);
  });
}
