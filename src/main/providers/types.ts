// =============================================================================
// OpenMinis PC - Core Types
// Mirrors iOS AgentProvider.swift + LLMTypes.swift + ChatModels.swift
// =============================================================================

// MARK: - Agent Messages

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, AgentToolParam>;
  required: string[];
  propertyOrdering?: string[];
}

export interface AgentToolParam {
  type: 'string' | 'integer' | 'boolean';
  description: string;
  enumValues?: string[];
}

export type AgentContentPart =
  | { type: 'text'; text: string }
  | { type: 'toolUse'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'toolResult'; id: string; name: string; content: string; isError: boolean; imageData?: Buffer; imageMimeType?: string; pageURL?: string }
  | { type: 'imageData'; data: Buffer; mimeType: string };

export interface AgentMessage {
  role: 'user' | 'assistant';
  parts: AgentContentPart[];
  isInterrupted?: boolean;
  reasoningContent?: string;
}

export type AgentStopReason = 'endTurn' | 'toolUse' | 'maxTokens' | 'refusal';

// MARK: - Stream Events

export type AgentStreamEvent =
  | { type: 'contentBlockStart'; block: { type: 'text' } | { type: 'toolUse'; id: string; name: string } }
  | { type: 'textDelta'; text: string }
  | { type: 'toolInputDelta'; name: string; accumulated: string }
  | { type: 'toolCallComplete'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'thinkingDelta'; text: string }
  | { type: 'reasoningContent'; content: string }
  | { type: 'usage'; usage: LLMUsage }
  | { type: 'done'; stopReason: AgentStopReason };

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

// MARK: - Tool Execution

export interface ToolExecutionResult {
  output: string;
  exitCode?: number;
  success: boolean;
  toolTitle?: string;
  imageData?: Buffer;
  imageMimeType?: string;
  pageURL?: string;
  timedOut?: boolean;
}

// MARK: - Provider Configuration

export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'xai' | 'deepseek' | 'custom';

export interface ProviderConfig {
  type: ProviderType;
  name: string;
  apiKey: string;
  baseURL?: string;
  model: string;
  maxTokens?: number;
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
}

export interface ModelInfo {
  id: string;
  displayName: string;
  provider: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
}

// MARK: - Agent Loop Types

export interface StreamResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  stopReason: AgentStopReason;
  usage?: LLMUsage;
  reasoningContent?: string;
}

export interface AgentLoopCallbacks {
  onTextDelta: (text: string, fullText: string) => void;
  onThinkingDelta: (text: string) => void;
  onToolCallStart: (id: string, name: string) => void;
  onToolInputDelta: (name: string, accumulated: string) => void;
  onToolCallComplete: (id: string, name: string, args: Record<string, unknown>) => void;
  onToolResult: (id: string, result: ToolExecutionResult) => void;
  onUsage: (usage: LLMUsage) => void;
  onError: (error: string) => void;
  onDone: (stopReason: AgentStopReason) => void;
  onCancelled: () => void;
}
