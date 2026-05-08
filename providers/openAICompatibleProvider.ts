// src/providers/openAICompatibleProvider.ts
// Base class for all OpenAI-compatible providers (OpenAI, Groq, Ollama, OpenRouter).
// Handles standard /v1/chat/completions format with real SSE streaming.
//
// Key differences from the DeepSeek provider:
// - Encoding: OpenAI format with native JSON tools arrays (NOT DSML)
// - Streaming: Real SSE streaming (NOT synthetic events from non-streaming call)
// - Response parsing: Parse choices[0].message.tool_calls as JSON (NOT DSML)

import { randomUUID } from "crypto";
import type { ProviderAdapter } from "./ProviderAdapter.js";
import type {
  BetaMessage,
  BetaMessageCreateParams,
  BetaStreamEvent,
  ContentBlock,
  MessageParam,
  ProviderName,
  RequestOptions,
  TextBlockParam,
  ToolSchema,
} from "./types.js";

// ── Internal types for OpenAI wire format ──

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

// ── Config interface ──

export interface OpenAICompatibleConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  defaultModel: string;
  modelMapping: Record<string, string>;
  maxRetries?: number;
  /** If true, do not send Authorization header (e.g., Ollama local) */
  noAuth?: boolean;
  /** Custom auth header value prefix. Default: "Bearer" */
  authPrefix?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// Base Class
// ════════════════════════════════════════════════════════════════════════════

export class OpenAICompatibleProvider implements ProviderAdapter {
  readonly provider: ProviderName;
  readonly baseURL: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly modelMapping: Record<string, string>;
  readonly maxRetries: number;
  readonly noAuth: boolean;
  readonly authPrefix: string;

  readonly beta: {
    messages: {
      create: (
        params: BetaMessageCreateParams,
        options?: RequestOptions,
      ) => Promise<BetaMessage>;
      stream: (
        params: BetaMessageCreateParams,
        options?: RequestOptions,
      ) => AsyncIterable<BetaStreamEvent>;
    };
  };

  readonly messages: {
    create: (
      params: BetaMessageCreateParams,
      options?: RequestOptions,
    ) => Promise<BetaMessage>;
  };

  constructor(config: OpenAICompatibleConfig) {
    this.provider = config.provider as ProviderName;
    this.baseURL = config.baseURL.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel;
    this.modelMapping = config.modelMapping;
    this.maxRetries = config.maxRetries ?? 3;
    this.noAuth = config.noAuth ?? false;
    this.authPrefix = config.authPrefix ?? "Bearer";

    const self = this;
    this.beta = {
      messages: {
        create: (params, options) => self.create(params, options),
        stream: (params, options) => self.stream(params, options),
      },
    };
    this.messages = {
      create: (params, options) => self.beta.messages.create(params, options),
    };
  }

  // ── ProviderAdapter methods ──

  mapModel(canonical: string): string {
    return this.modelMapping[canonical] ?? canonical;
  }

  supportsReasoning(): boolean {
    return false;
  }

  supportsStreaming(): boolean {
    return true;
  }

  supportsTools(): boolean {
    return true;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Conversion: Anthropic params → OpenAI request body
  // ════════════════════════════════════════════════════════════════════════════

  protected anthropicMessagesToOpenAI(params: BetaMessageCreateParams): {
    messages: OpenAIMessage[];
    tools?: OpenAIToolDef[];
    tool_choice?: unknown;
    stream: boolean;
    model: string;
    max_tokens: number;
    temperature?: number;
    top_p?: number;
    stop?: string[];
    reasoning_effort?: string;
  } {
    const messages: OpenAIMessage[] = [];

    // System prompt — extract from string or array of text blocks
    if (params.system) {
      let systemContent: string;
      if (typeof params.system === "string") {
        systemContent = params.system;
      } else {
        systemContent = params.system
          .filter((b): b is TextBlockParam => b.type === "text")
          .map((b) => b.text)
          .join("\n");
      }
      messages.push({ role: "system", content: systemContent });
    }

    // Conversation messages
    for (const msg of params.messages) {
      const converted = this.convertMessage(msg);
      messages.push(...converted);
    }

    // Tools: convert input_schema → parameters
    let tools: OpenAIToolDef[] | undefined;
    if (params.tools && params.tools.length > 0) {
      tools = params.tools.map((t: ToolSchema) => ({
        type: "function" as const,
        function: {
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          parameters: t.input_schema,
        },
      }));
    }

    // Tool choice conversion:
    //   auto → "auto"
    //   any  → "required"
    //   { type: "tool", name } → { type: "function", function: { name } }
    let tool_choice: unknown;
    if (params.tool_choice) {
      if (params.tool_choice.type === "auto") {
        tool_choice = "auto";
      } else if (params.tool_choice.type === "any") {
        tool_choice = "required";
      } else if (params.tool_choice.type === "tool") {
        tool_choice = {
          type: "function",
          function: { name: params.tool_choice.name },
        };
      }
    }

    // Thinking → reasoning_effort (if the provider supports it)
    let reasoning_effort: string | undefined;
    if (params.thinking) {
      if (params.thinking.type === "enabled") {
        reasoning_effort = "high";
      } else if (params.thinking.type === "adaptive") {
        reasoning_effort = "medium";
      }
    }

    return {
      messages,
      tools,
      tool_choice,
      stream: false, // overridden by caller
      model: params.model || this.defaultModel,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      top_p: params.top_p,
      stop: params.stop_sequences,
      reasoning_effort,
    };
  }

  /**
   * Convert a single Anthropic MessageParam to one or more OpenAI messages.
   *
   * Key difference from Anthropic: tool results are NOT inline content blocks
   * within a user message. OpenAI requires separate `role: "tool"` messages.
   */
  private convertMessage(msg: MessageParam): OpenAIMessage[] {
    // ── Assistant message ──
    if (msg.role === "assistant") {
      let content: string | undefined;
      const toolCalls: OpenAIToolCall[] = [];

      if (typeof msg.content === "string") {
        content = msg.content;
      } else {
        const textParts: string[] = [];
        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }
        content = textParts.length > 0 ? textParts.join("\n") : undefined;
      }

      return [
        {
          role: "assistant",
          ...(content ? { content } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      ];
    }

    // ── User message ──
    // May contain text blocks + tool_result blocks.
    // Tool results become separate `role: "tool"` messages in OpenAI format.
    if (msg.role === "user") {
      const results: OpenAIMessage[] = [];

      if (typeof msg.content === "string") {
        results.push({ role: "user", content: msg.content });
      } else {
        const textParts: string[] = [];
        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_result") {
            const resultContent =
              typeof block.content === "string"
                ? block.content
                : block.content
                    .filter(
                      (b): b is TextBlockParam => b.type === "text",
                    )
                    .map((b) => b.text)
                    .join("\n");
            results.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: resultContent,
            });
          }
          // Image blocks are silently skipped
        }
        if (textParts.length > 0) {
          results.push({ role: "user", content: textParts.join("\n") });
        }
      }

      return results;
    }

    return [];
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Conversion: OpenAI response → Anthropic BetaMessage
  // ════════════════════════════════════════════════════════════════════════════

  protected openAIResponseToBetaMessage(
    data: {
      choices: Array<{
        message: {
          role: string;
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string | null;
      }>;
      model?: string;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    },
    model: string,
  ): BetaMessage {
    const choice = data.choices?.[0];
    const message = choice?.message;
    const content: ContentBlock[] = [];

    // Text content block
    if (message?.content) {
      content.push({ type: "text", text: message.content });
    }

    // Tool use content blocks — arguments arrive as a JSON string
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          // Invalid JSON — use empty object
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    // Map finish_reason to Anthropic stop_reason
    let stop_reason: string | null = null;
    const finishReason = choice?.finish_reason;
    if (finishReason === "stop") {
      stop_reason = content.some((b) => b.type === "tool_use")
        ? "tool_use"
        : "end_turn";
    } else if (finishReason === "tool_calls") {
      stop_reason = "tool_use";
    } else if (finishReason === "length") {
      stop_reason = "max_tokens";
    }

    return {
      id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      type: "message",
      role: "assistant",
      content,
      model: data.model || model,
      stop_reason,
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Core API — Non-streaming
  // ════════════════════════════════════════════════════════════════════════════

  async create(
    params: BetaMessageCreateParams,
    options?: RequestOptions,
  ): Promise<BetaMessage> {
    const body = this.anthropicMessagesToOpenAI(params);
    const url = `${this.baseURL}/v1/chat/completions`;

    const headers = this.buildHeaders(options?.headers);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, stream: false }),
          signal: options?.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "Unknown");
          throw new Error(`API ${response.status}: ${text}`);
        }

        const json = await response.json();
        return this.openAIResponseToBetaMessage(json, params.model);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (options?.signal?.aborted) throw lastError;
        if (attempt < this.maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error("Unknown error");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Core API — Real SSE Streaming
  // ════════════════════════════════════════════════════════════════════════════

  async *stream(
    params: BetaMessageCreateParams,
    options?: RequestOptions,
  ): AsyncGenerator<BetaStreamEvent> {
    const body = this.anthropicMessagesToOpenAI(params);
    const url = `${this.baseURL}/v1/chat/completions`;

    const headers = this.buildHeaders(options?.headers);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown");
      throw new Error(`API ${response.status}: ${text}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // ── Streaming state ──
    let emittedMessageStart = false;
    let textBlockIndex: number | null = null;
    let nextBlockIndex = 0;
    const accumulatedToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    const emittedToolCallStarts = new Set<number>();
    const toolCallBlockIndices = new Map<number, number>();
    let finalModel = params.model;
    let finishReason: string | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          let parsed: {
            model?: string;
            choices?: Array<{
              index?: number;
              delta?: {
                role?: string;
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  type?: "function";
                  function?: {
                    name?: string;
                    arguments?: string;
                  };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
            };
          };
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          if (parsed.model) finalModel = parsed.model;

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) {
            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }
            continue;
          }

          // Emit message_start on first content
          if (!emittedMessageStart) {
            emittedMessageStart = true;
            yield {
              type: "message_start",
              message: {
                id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
                type: "message",
                role: "assistant",
                content: [],
                model: finalModel,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            };
          }

          // ── Text content delta ──
          if (delta.content) {
            if (textBlockIndex === null) {
              textBlockIndex = nextBlockIndex++;
              yield {
                type: "content_block_start",
                index: textBlockIndex,
                content_block: { type: "text", text: "" },
              };
            }
            yield {
              type: "content_block_delta",
              index: textBlockIndex,
              delta: { type: "text_delta", text: delta.content },
            };
          }

          // ── Tool call deltas (accumulate by index) ──
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              let acc = accumulatedToolCalls.get(tc.index);
              if (!acc) {
                acc = { id: "", name: "", arguments: "" };
                accumulatedToolCalls.set(tc.index, acc);
              }
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;

              // Emit content_block_start once we have id + name
              if (!emittedToolCallStarts.has(tc.index) && acc.id && acc.name) {
                // Close open text block first
                if (textBlockIndex !== null) {
                  yield {
                    type: "content_block_stop",
                    index: textBlockIndex,
                  };
                  textBlockIndex = null;
                }

                emittedToolCallStarts.add(tc.index);
                const blockIndex = nextBlockIndex++;
                toolCallBlockIndices.set(tc.index, blockIndex);

                yield {
                  type: "content_block_start",
                  index: blockIndex,
                  content_block: {
                    type: "tool_use",
                    id: acc.id,
                    name: acc.name,
                    input: {},
                  },
                };
              }
            }
          }

          // ── Finish ──
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;

            // Close any open text block
            if (textBlockIndex !== null) {
              yield {
                type: "content_block_stop",
                index: textBlockIndex,
              };
              textBlockIndex = null;
            }

            // Close all emitted tool call blocks
            for (const blockIndex of toolCallBlockIndices.values()) {
              yield {
                type: "content_block_stop",
                index: blockIndex,
              };
            }

            // Map finish_reason to stop_reason
            let stop_reason: string | undefined;
            if (finishReason === "stop") {
              stop_reason =
                toolCallBlockIndices.size > 0 ? "tool_use" : "end_turn";
            } else if (finishReason === "tool_calls") {
              stop_reason = "tool_use";
            } else if (finishReason === "length") {
              stop_reason = "max_tokens";
            }

            yield {
              type: "message_delta",
              delta: { stop_reason },
              usage: { output_tokens: 0 },
            };

            yield { type: "message_stop" };
          }
        }
      }

      // Stream ended without finish_reason — close any open blocks
      if (finishReason === null) {
        if (textBlockIndex !== null) {
          yield {
            type: "content_block_stop",
            index: textBlockIndex,
          };
        }
        for (const blockIndex of toolCallBlockIndices.values()) {
          yield {
            type: "content_block_stop",
            index: blockIndex,
          };
        }
        yield {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
        };
        yield { type: "message_stop" };
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Helpers ──

  private buildHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (!this.noAuth && this.apiKey) {
      headers["Authorization"] = `${this.authPrefix} ${this.apiKey}`;
    }
    return headers;
  }
}
