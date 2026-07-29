// =============================================================================
// OpenMinis PC - Provider Factory
// Mirrors iOS ProviderFactory.swift + LLMProviderFactory
// =============================================================================

import { ProviderConfig, AgentMessage, AgentToolDefinition, AgentStreamEvent } from './types';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly defaultMaxTokens: number;
  streamMessage(
    messages: AgentMessage[],
    systemPrompt: string,
    tools: AgentToolDefinition[],
    maxTokens?: number,
  ): AsyncGenerator<AgentStreamEvent>;
}

export class ProviderFactory {
  static create(config: ProviderConfig): LLMProvider {
    switch (config.type) {
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'openrouter':
        return new OpenAIProvider({
          ...config,
          baseURL: 'https://openrouter.ai/api/v1',
          name: 'openrouter',
        });
      case 'xai':
        return new OpenAIProvider({
          ...config,
          baseURL: 'https://api.x.ai/v1',
          name: 'xai',
        });
      case 'deepseek':
        return new OpenAIProvider({
          ...config,
          baseURL: 'https://api.deepseek.com/v1',
          name: 'deepseek',
        });
      case 'custom':
        // User provides baseURL — fall back to a sensible default if missing
        return new OpenAIProvider({
          ...config,
          baseURL: config.baseURL || 'https://api.openai.com/v1',
          name: 'custom',
        });
      case 'gemini':
        return new GeminiProvider(config);
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }
}
