// =============================================================================
// OpenMinis PC - Agent Loop
// Mirrors iOS AIChatViewModel.runAgentLoop()
// =============================================================================

import {
  AgentMessage,
  AgentContentPart,
  AgentStreamEvent,
  AgentStopReason,
  AgentToolDefinition,
  AgentLoopCallbacks,
  ToolExecutionResult,
  LLMUsage,
} from '../providers/types';
import { LLMProvider } from '../providers/ProviderFactory';
import { ShellExecutor, FileTools, MemoryTools, BrowserFetch } from '../tools/ToolExecutors';
import { buildSystemPrompt } from './SystemPrompt';

const MAX_AGENT_TURNS = 200;
const MAX_TOOL_RESULT_CHARS = 15000;

export interface AgentLoopConfig {
  provider: LLMProvider;
  workspaceDir: string;
  memoryDir: string;
  memoryEnabled: boolean;
  maxTokens?: number;
}

export class AgentLoop {
  private config: AgentLoopConfig;
  private shell: ShellExecutor;
  private files: FileTools;
  private memory: MemoryTools;
  private browser: BrowserFetch;
  private agentHistory: AgentMessage[] = [];
  private isCancelled = false;
  private callbacks: AgentLoopCallbacks | null = null;

  constructor(config: AgentLoopConfig) {
    this.config = config;
    this.shell = new ShellExecutor(config.workspaceDir);
    this.files = new FileTools();
    this.memory = new MemoryTools(config.memoryDir);
    this.browser = new BrowserFetch();
  }

  async initialize(): Promise<void> {
    await this.memory.initialize();
  }

  cancel(): void {
    this.isCancelled = true;
  }

  reset(): void {
    this.agentHistory = [];
    this.isCancelled = false;
  }

  async run(
    userMessage: string,
    tools: AgentToolDefinition[],
    callbacks: AgentLoopCallbacks,
  ): Promise<void> {
    this.callbacks = callbacks;
    this.isCancelled = false;

    // Add user message to history
    const userMsg: AgentMessage = {
      role: 'user',
      parts: [{ type: 'text', text: userMessage }],
    };
    this.agentHistory.push(userMsg);

    const systemPrompt = buildSystemPrompt(this.config.memoryEnabled);
    let turnCount = 0;

    while (turnCount < MAX_AGENT_TURNS && !this.isCancelled) {
      turnCount++;

      // Build messages for this turn
      const messages = [...this.agentHistory];

      try {
        // Stream from provider
        let assistantText = '';
        const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
        let stopReason: AgentStopReason = 'endTurn';
        let usage: LLMUsage | undefined;

        const stream = this.config.provider.streamMessage(
          messages,
          systemPrompt,
          tools,
          this.config.maxTokens || 64000,
        );

        for await (const event of stream) {
          if (this.isCancelled) {
            callbacks.onCancelled();
            return;
          }

          switch (event.type) {
            case 'contentBlockStart':
              if (event.block.type === 'toolUse') {
                callbacks.onToolCallStart(event.block.id, event.block.name);
              }
              break;

            case 'textDelta':
              assistantText += event.text;
              callbacks.onTextDelta(event.text, assistantText);
              break;

            case 'thinkingDelta':
              callbacks.onThinkingDelta(event.text);
              break;

            case 'toolInputDelta':
              callbacks.onToolInputDelta(event.name, event.accumulated);
              break;

            case 'toolCallComplete':
              toolCalls.push({
                id: event.id,
                name: event.name,
                args: event.args,
              });
              callbacks.onToolCallComplete(event.id, event.name, event.args);
              break;

            case 'usage':
              usage = event.usage;
              callbacks.onUsage(event.usage);
              break;

            case 'done':
              stopReason = event.stopReason;
              break;
          }
        }

        // Build assistant message
        const assistantParts: AgentContentPart[] = [];
        if (assistantText) {
          assistantParts.push({ type: 'text', text: assistantText });
        }
        for (const tc of toolCalls) {
          assistantParts.push({
            type: 'toolUse',
            id: tc.id,
            name: tc.name,
            input: tc.args,
          });
        }

        const assistantMsg: AgentMessage = {
          role: 'assistant',
          parts: assistantParts,
        };
        this.agentHistory.push(assistantMsg);

        // If no tool calls, we're done
        if (toolCalls.length === 0 || stopReason === 'endTurn') {
          callbacks.onDone(stopReason);
          return;
        }

        // Execute tools
        const toolResults: AgentContentPart[] = [];
        for (const tc of toolCalls) {
          if (this.isCancelled) {
            callbacks.onCancelled();
            return;
          }

          const result = await this.executeTool(tc.name, tc.args);
          callbacks.onToolResult(tc.id, result);

          toolResults.push({
            type: 'toolResult',
            id: tc.id,
            name: tc.name,
            content: result.output.substring(0, MAX_TOOL_RESULT_CHARS),
            isError: !result.success,
            imageData: result.imageData,
            imageMimeType: result.imageMimeType,
          });
        }

        // Add tool results as a user message to history
        this.agentHistory.push({
          role: 'user',
          parts: toolResults,
        });

        // If stop reason is not toolUse, break
        if (stopReason !== 'toolUse') {
          callbacks.onDone(stopReason);
          return;
        }

        // Otherwise continue loop for next model response
      } catch (error: unknown) {
        const err = error as Error;
        callbacks.onError(err.message || 'Unknown error in agent loop');
        return;
      }
    }

    // Max turns reached
    if (turnCount >= MAX_AGENT_TURNS) {
      callbacks.onError(`Reached maximum agent turns (${MAX_AGENT_TURNS}). The task may be too complex.`);
    }
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    switch (name) {
      case 'shell_execute': {
        const command = String(args.command || '');
        const timeout = Number(args.timeout) || 900;
        return await this.shell.execute(command, timeout);
      }

      case 'file_read': {
        const filePath = String(args.path || '');
        return await this.files.readFile(filePath, this.config.workspaceDir, {
          offset: args.offset ? Number(args.offset) : undefined,
          lines: args.lines ? Number(args.lines) : undefined,
          maxLength: args.max_length ? Number(args.max_length) : undefined,
          direction: (args.direction as 'head' | 'tail') || undefined,
        });
      }

      case 'file_write': {
        const filePath = String(args.path || '');
        const content = String(args.content || '');
        return await this.files.writeFile(filePath, content, this.config.workspaceDir, {
          append: args.append === true,
          createDirs: args.create_dirs === true,
        });
      }

      case 'file_edit': {
        const filePath = String(args.path || '');
        const oldString = String(args.old_string || '');
        const newString = String(args.new_string || '');
        const replaceAll = args.replace_all === true;
        return await this.files.editFile(filePath, oldString, newString, this.config.workspaceDir, replaceAll);
      }

      case 'browser_fetch': {
        const url = String(args.url || '');
        const maxLength = Number(args.max_length) || 25000;
        return await this.browser.fetch(url, maxLength);
      }

      case 'memory_write': {
        const content = String(args.content || '');
        return await this.memory.writeMemory(content);
      }

      case 'memory_get': {
        const keywords = String(args.keywords || '');
        const limit = Number(args.limit) || 20;
        return await this.memory.getMemory(keywords, limit);
      }

      default:
        return {
          output: `Unknown tool: ${name}`,
          success: false,
        };
    }
  }
}
