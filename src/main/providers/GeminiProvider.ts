// =============================================================================
// OpenMinis PC - Gemini Provider
// Mirrors iOS GeminiProvider.swift + GeminiAgentProvider.swift
// Uses Google Gemini API with SSE streaming
// =============================================================================

import { AgentMessage, AgentToolDefinition, AgentStreamEvent, AgentStopReason, ProviderConfig } from './types';

export class GeminiProvider {
  readonly name: string = 'gemini';
  readonly model: string;
  private apiKey: string;
  readonly defaultMaxTokens: number = 64000;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
  }

  async *streamMessage(
    messages: AgentMessage[],
    systemPrompt: string,
    tools: AgentToolDefinition[],
    maxTokens: number = 64000,
  ): AsyncGenerator<AgentStreamEvent> {
    const contents = this.convertMessages(messages);
    const geminiTools = this.convertTools(tools);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
      },
    };

    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    if (geminiTools.length > 0) {
      body.tools = [{ functionDeclarations: geminiTools }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let startedText = false;
    let currentToolName = '';
    let currentToolArgs = '';
    let inputTokens = 0;
    let outputTokens = 0;

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
            yield { type: 'done', stopReason: 'endTurn' as AgentStopReason };
            return;
          }

          try {
            const event = JSON.parse(data);
            if (!event.candidates?.[0]) continue;

            const candidate = event.candidates[0];
            const content = candidate.content;

            if (content?.parts) {
              for (const part of content.parts) {
                if (part.text) {
                  if (!startedText) {
                    startedText = true;
                    yield { type: 'contentBlockStart', block: { type: 'text' } };
                  }
                  yield { type: 'textDelta', text: part.text };
                } else if (part.functionCall) {
                  currentToolName = part.functionCall.name;
                  currentToolArgs = JSON.stringify(part.functionCall.args || {});
                  yield { type: 'toolInputDelta', name: currentToolName, accumulated: currentToolArgs };

                  // Emit complete immediately for Gemini (no streaming tool args)
                  yield {
                    type: 'toolCallComplete',
                    id: `call_${Date.now()}`,
                    name: currentToolName,
                    args: part.functionCall.args || {},
                  };
                }
              }
            }

            // Finish reason
            if (candidate.finishReason) {
              let agentStopReason: AgentStopReason = 'endTurn';
              if (candidate.finishReason === 'STOP') agentStopReason = 'endTurn';
              else if (candidate.finishReason === 'MAX_TOKENS') agentStopReason = 'maxTokens';

              // Token usage
              if (event.usageMetadata) {
                inputTokens = event.usageMetadata.promptTokenCount || 0;
                outputTokens = event.usageMetadata.candidatesTokenCount || 0;
                yield { type: 'usage', usage: { inputTokens, outputTokens } };
              }

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

  private convertMessages(messages: AgentMessage[]): Record<string, unknown>[] {
    const contents: Record<string, unknown>[] = [];

    for (const msg of messages) {
      const parts: Record<string, unknown>[] = [];

      for (const part of msg.parts) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'toolUse') {
          parts.push({
            functionCall: {
              name: part.name,
              args: part.input,
            },
          });
        } else if (part.type === 'toolResult') {
          parts.push({
            functionResponse: {
              name: part.name,
              response: { result: part.content },
            },
          });
        } else if (part.type === 'imageData') {
          parts.push({
            inlineData: {
              mimeType: part.mimeType,
              data: part.data.toString('base64'),
            },
          });
        }
      }

      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: parts.length > 0 ? parts : [{ text: '' }],
      });
    }

    return contents;
  }

  private convertTools(tools: AgentToolDefinition[]): Record<string, unknown>[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, param]) => [
            key,
            {
              type: param.type.toUpperCase(),
              description: param.description,
              ...(param.enumValues ? { enum: param.enumValues } : {}),
            },
          ])
        ),
        required: tool.required,
      },
    }));
  }
}
