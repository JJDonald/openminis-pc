import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { AgentToolDefinition, ToolExecutionResult } from '../providers/types';

export type MCPTransport = 'stdio' | 'http';

export interface MCPServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPConfigFile { servers: MCPServerConfig[]; }
interface RPCResponse { jsonrpc: string; id?: number | string; result?: any; error?: { code: number; message: string; data?: unknown }; }

export class MCPManager {
  private readonly configFile: string;
  private readonly toolRoutes = new Map<string, { serverId: string; toolName: string }>();

  constructor(workspaceDir: string) {
    this.configFile = path.join(workspaceDir, '.minis-mcp.json');
  }

  listConfigs(): MCPServerConfig[] { return this.load().servers; }

  save(config: MCPServerConfig): MCPServerConfig {
    const normalized = this.normalizeConfig(config);
    const data = this.load();
    const index = data.servers.findIndex(s => s.id === normalized.id);
    if (index >= 0) data.servers[index] = normalized;
    else data.servers.push(normalized);
    this.persist(data);
    return normalized;
  }

  setEnabled(id: string, enabled: boolean): void {
    const data = this.load();
    const server = data.servers.find(s => s.id === id);
    if (!server) throw new Error('MCP server not found');
    server.enabled = enabled;
    this.persist(data);
  }

  remove(id: string): void {
    const data = this.load();
    const next = data.servers.filter(s => s.id !== id);
    if (next.length === data.servers.length) throw new Error('MCP server not found');
    this.persist({ servers: next });
  }

  async inspect(id: string): Promise<{ config: MCPServerConfig; tools: MCPToolInfo[]; status: 'connected' | 'error'; error?: string }> {
    const config = this.requireConfig(id);
    try {
      const tools = await this.listTools(config);
      return { config, tools, status: 'connected' };
    } catch (error) {
      return { config, tools: [], status: 'error', error: (error as Error).message };
    }
  }

  async makeAgentTools(): Promise<AgentToolDefinition[]> {
    const result: AgentToolDefinition[] = [];
    this.toolRoutes.clear();
    for (const config of this.listConfigs().filter(s => s.enabled)) {
      try {
        const tools = await this.listTools(config);
        for (const tool of tools) {
          const schema = tool.inputSchema || { type: 'object', properties: {} };
          const properties = (schema.properties || {}) as Record<string, any>;
          const params: AgentToolDefinition['parameters'] = {};
          for (const [key, value] of Object.entries(properties)) {
            const type = ['string', 'integer', 'boolean'].includes(value?.type) ? value.type : 'string';
            params[key] = { type, description: value?.description || key, enumValues: value?.enum };
          }
          const agentName = this.agentToolName(config.id, tool.name);
          this.toolRoutes.set(agentName, { serverId: config.id, toolName: tool.name });
          result.push({
            name: agentName,
            description: `[MCP: ${config.name}] ${tool.description || tool.name}`,
            parameters: params,
            required: Array.isArray(schema.required) ? schema.required as string[] : [],
            inputSchema: schema,
          });
        }
      } catch { /* disconnected servers do not block chat */ }
    }
    return result;
  }

  isMCPTool(name: string): boolean { return name.startsWith('mcp__'); }

  async callAgentTool(agentName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    try {
      const route = this.toolRoutes.get(agentName);
      const parsed = route || this.parseAgentToolName(agentName);
      const config = this.requireConfig(parsed.serverId);
      if (!config.enabled) throw new Error('MCP server is disabled');
      const result = await this.callTool(config, parsed.toolName, args);
      const output = this.formatToolResult(result);
      return { output, success: !result?.isError };
    } catch (error) {
      return { output: `MCP tool error: ${(error as Error).message}`, success: false };
    }
  }

  private async listTools(config: MCPServerConfig): Promise<MCPToolInfo[]> {
    const result = await this.rpcSequence(config, [{ method: 'tools/list', params: {} }]);
    return result?.tools || [];
  }

  private async callTool(config: MCPServerConfig, name: string, args: Record<string, unknown>): Promise<any> {
    return await this.rpcSequence(config, [{ method: 'tools/call', params: { name, arguments: args } }]);
  }

  private async rpcSequence(config: MCPServerConfig, calls: Array<{ method: string; params: unknown }>): Promise<any> {
    return config.transport === 'http'
      ? await this.httpSequence(config, calls)
      : await this.stdioSequence(config, calls);
  }

  private async httpSequence(config: MCPServerConfig, calls: Array<{ method: string; params: unknown }>): Promise<any> {
    if (!config.url) throw new Error('MCP HTTP URL is required');
    let sessionId = '';
    const send = async (body: unknown): Promise<RPCResponse> => {
      const response = await fetch(config.url!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...(config.headers || {}),
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      sessionId = response.headers.get('mcp-session-id') || sessionId;
      const text = await response.text();
      return this.parseHTTPResponse(text);
    };
    const init = await send(this.request(1, 'initialize', this.initializeParams()));
    this.assertRPC(init);
    await send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }).catch(() => ({} as RPCResponse));
    let last: RPCResponse = init;
    let id = 2;
    for (const call of calls) {
      last = await send(this.request(id++, call.method, call.params));
      this.assertRPC(last);
    }
    return last.result;
  }

  private stdioSequence(config: MCPServerConfig, calls: Array<{ method: string; params: unknown }>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!config.command) { reject(new Error('MCP command is required')); return; }
      const child = spawn(config.command, config.args || [], {
        env: { ...process.env, ...(config.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
      let buffer = '';
      let stderr = '';
      let nextId = 1;
      const pending = new Map<number, { resolve: (value: RPCResponse) => void; reject: (error: Error) => void }>();
      const timeout = setTimeout(() => finish(new Error(`MCP stdio timeout${stderr ? `: ${stderr.slice(-500)}` : ''}`)), 20000);
      let settled = false;
      const finish = (error?: Error, value?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill();
        error ? reject(error) : resolve(value);
      };
      const sendRequest = (method: string, params: unknown): Promise<RPCResponse> => {
        const id = nextId++;
        const payload = this.request(id, method, params);
        child.stdin.write(JSON.stringify(payload) + '\n');
        return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
      };
      child.stderr.on('data', chunk => stderr += chunk.toString());
      child.on('error', error => finish(error));
      child.on('exit', code => { if (!settled && code !== 0) finish(new Error(`MCP process exited ${code}: ${stderr.slice(-500)}`)); });
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as RPCResponse;
            if (typeof msg.id === 'number' && pending.has(msg.id)) {
              const waiter = pending.get(msg.id)!;
              pending.delete(msg.id);
              msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg);
            }
          } catch { /* ignore non-JSON server logs */ }
        }
      });
      (async () => {
        try {
          await sendRequest('initialize', this.initializeParams());
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
          let last: RPCResponse | undefined;
          for (const call of calls) last = await sendRequest(call.method, call.params);
          finish(undefined, last?.result);
        } catch (error) { finish(error as Error); }
      })();
    });
  }

  private request(id: number, method: string, params: unknown): object {
    return { jsonrpc: '2.0', id, method, params };
  }

  private initializeParams(): object {
    return { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'openminis-pc', version: '1.0.0' } };
  }

  private assertRPC(response: RPCResponse): void {
    if (response.error) throw new Error(response.error.message);
  }

  private parseHTTPResponse(text: string): RPCResponse {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    const events = trimmed.split(/\r?\n\r?\n/).reverse();
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
      if (data) return JSON.parse(data);
    }
    return { jsonrpc: '2.0', result: {} };
  }

  private formatToolResult(result: any): string {
    if (!result) return '(no output)';
    if (Array.isArray(result.content)) {
      return result.content.map((item: any) => item?.text || (item?.type === 'resource' ? JSON.stringify(item.resource) : JSON.stringify(item))).join('\n');
    }
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  private agentToolName(serverId: string, toolName: string): string {
    return `mcp__${serverId}__${toolName}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  }

  private parseAgentToolName(name: string): { serverId: string; toolName: string } {
    const parts = name.split('__');
    if (parts.length < 3 || parts[0] !== 'mcp') throw new Error('Invalid MCP tool name');
    return { serverId: parts[1], toolName: parts.slice(2).join('__') };
  }

  private load(): MCPConfigFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
      return { servers: Array.isArray(parsed.servers) ? parsed.servers.map((s: MCPServerConfig) => this.normalizeConfig(s)) : [] };
    } catch { return { servers: [] }; }
  }

  private persist(data: MCPConfigFile): void {
    fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  private requireConfig(id: string): MCPServerConfig {
    const config = this.listConfigs().find(s => s.id === id);
    if (!config) throw new Error('MCP server not found');
    return config;
  }

  private normalizeConfig(config: MCPServerConfig): MCPServerConfig {
    const id = (config.id || this.slugify(config.name || 'mcp')).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error('Invalid MCP id');
    const transport: MCPTransport = config.transport === 'http' ? 'http' : 'stdio';
    return {
      id, name: (config.name || id).trim(), enabled: config.enabled !== false, transport,
      command: transport === 'stdio' ? (config.command || '').trim() : undefined,
      args: transport === 'stdio' && Array.isArray(config.args) ? config.args.map(String) : undefined,
      env: transport === 'stdio' && config.env && typeof config.env === 'object' ? config.env : undefined,
      url: transport === 'http' ? (config.url || '').trim() : undefined,
      headers: transport === 'http' && config.headers && typeof config.headers === 'object' ? config.headers : undefined,
    };
  }

  private slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `mcp-${Date.now()}`;
  }
}
