// =============================================================================
// OpenMinis PC - OpenAI Provider
// Mirrors iOS OpenAIProvider.swift + OpenAIAgentProvider.swift
// Uses OpenAI Chat Completions API with SSE streaming + tool calls
// =============================================================================

import { AgentMessage, AgentToolDefinition, AgentStreamEvent, AgentStopReason, ProviderConfig } from './types';

export class OpenAIProvider {
  readonly name: string;
  readonly model: string;
  private apiKey: string;
  private baseURL: string;
  readonly defaultMaxTokens: number = 64000;

  constructor(config: ProviderConfig) {
    this.name = config.name || 'openai';
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://api.openai.com';
  }

  async *streamMessage(
    messages: AgentMessage[],
    systemPrompt: string,
    tools: AgentToolDefinition[],
    maxTokens: number = 64000,
  ): AsyncGenerator<AgentStreamEvent> {
    const openaiMessages = this.convertMessages(messages, systemPrompt);
    const openaiTools = this.convertTools(tools);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
      body.tool_choice = 'auto';
    }

    // Normalize base URL
    let apiURL = this.baseURL;
    if (!apiURL.endsWith('/v1')) {
      apiURL = apiURL.replace(/\/+$/, '') + '/v1';
    }

    const response = await fetch(`${apiURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let startedText = false;

    // Track tool calls by index
    const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

    // Build toolCallComplete events for every collected tool call. Called on
    // finish_reason AND on [DONE] so a stream that ends without an explicit
    // finish_reason still finalizes its tool calls.
    function collectToolCalls(): AgentStreamEvent[] {
      const events: AgentStreamEvent[] = [];
      for (const [, entry] of toolCalls) {
        if (entry.id && entry.name) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(entry.args); } catch { /* partial JSON */ }
          events.push({ type: 'toolCallComplete', id: entry.id, name: entry.name, args });
        }
      }
      return events;
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            // Finalize any pending tool calls before ending the stream.
            for (const e of collectToolCalls()) yield e;
            yield { type: 'done', stopReason: 'endTurn' as AgentStopReason };
            return;
          }

          try {
            const event = JSON.parse(data);
            const choice = event.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};

            // Handle tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' });
                }
                const entry = toolCalls.get(idx)!;
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.name = tc.function.name;
                if (tc.function?.arguments) {
                  entry.args += tc.function.arguments;
                  yield { type: 'toolInputDelta', name: entry.name, accumulated: entry.args };
                }
              }
            }

            // Handle text content
            if (delta.content) {
              if (!startedText) {
                startedText = true;
                yield { type: 'contentBlockStart', block: { type: 'text' } };
              }
              yield { type: 'textDelta', text: delta.content };
            }

            // Handle finish
            if (choice.finish_reason) {
              if (choice.finish_reason === 'tool_calls') {
                // Emit toolCallComplete for each completed tool call
                for (const e of collectToolCalls()) yield e;
              }

              // Check usage
              if (event.usage) {
                inputTokens = event.usage.prompt_tokens || 0;
                outputTokens = event.usage.completion_tokens || 0;
                yield { type: 'usage', usage: { inputTokens, outputTokens } };
              }

              let agentStopReason: AgentStopReason = 'endTurn';
              if (choice.finish_reason === 'tool_calls') agentStopReason = 'toolUse';
              else if (choice.finish_reason === 'length') agentStopReason = 'maxTokens';

              yield { type: 'done', stopReason: agentStopReason };
              return;
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private convertMessages(
    messages: AgentMessage[],
    systemPrompt: string,
  ): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];

    // System message
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        const contentParts: Record<string, unknown>[] = [];
        const toolResults: Array<{ tool_call_id: string; role: 'tool'; content: string }> = [];

        for (const part of msg.parts) {
          if (part.type === 'text') {
            contentParts.push({ type: 'text', text: part.text });
          } else if (part.type === 'toolResult') {
            toolResults.push({
              role: 'tool',
              tool_call_id: part.id,
              content: part.content,
            });
          } else if (part.type === 'imageData') {
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${part.mimeType};base64,${part.data.toString('base64')}`,
              },
            });
          }
        }

        if (contentParts.length > 0) {
          result.push({ role: 'user', content: contentParts });
        }

        for (const tr of toolResults) {
          result.push(tr);
        }
      } else if (msg.role === 'assistant') {
        // Build assistant message with potential tool_calls
        const contentParts: string[] = [];
        const toolCalls: Record<string, unknown>[] = [];

        for (const part of msg.parts) {
          if (part.type === 'text') {
            contentParts.push(part.text);
          } else if (part.type === 'toolUse') {
            toolCalls.push({
              id: part.id,
              type: 'function',
              function: {
                name: part.name,
                arguments: JSON.stringify(part.input),
              },
            });
          }
        }

        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: contentParts.join('') || null,
        };

        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }

        result.push(assistantMsg);
      }
    }

    return result;
  }

  private convertTools(tools: AgentToolDefinition[]): Record<string, unknown>[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(tool.parameters).map(([key, param]) => [
              key,
              {
                type: param.type,
                description: param.description,
                ...(param.enumValues ? { enum: param.enumValues } : {}),
              },
            ])
          ),
          required: tool.required,
        },
      },
    }));
  }
}
