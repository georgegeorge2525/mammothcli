// src/providers/deepseekProvider.ts
// DeepSeek-native API client presenting Anthropic SDK-compatible interface.
//
// The critical choke point is getAnthropicClient() in src/services/api/client.ts.
// This adapter matches the @anthropic-ai/sdk interface so the query engine
// works unchanged when pointed at DeepSeek.
//
// The conversion pipeline:
//   Anthropic params  ->  DSML messages  ->  DSML-encoded prompt string
//   -> POST to DeepSeek /v1/chat/completions  ->  parse response
//   ->  Anthropic BetaMessage

import { randomUUID } from "crypto";
import {
  encodeMessages,
  parseAssistantResponse,
  EFFORT_MAX_PREFIX,
} from "../services/deepseekProtocol.js";
import type { DSMLMessage, DSMLToolCall, DSMLToolResult } from "../services/deepseekProtocol.js";
import type {
  BetaMessage,
  BetaStreamEvent,
  BetaMessageCreateParams,
  TextBlockParam,
  ContentBlock,
  RequestOptions,
  ProviderName,
} from "./types.js";
import type { ProviderAdapter } from "./ProviderAdapter.js";

// ════════════════════════════════════════════════════════════════════════════
// Anthropic params to DSML messages conversion
// ════════════════════════════════════════════════════════════════════════════

export function anthropicMessagesToDSML(
  params: BetaMessageCreateParams,
): { messages: DSMLMessage[]; thinkingMode: "chat" | "thinking" } {
  const dsmlMessages: DSMLMessage[] = [];
  const thinkingEnabled =
    params.thinking !== undefined &&
    params.thinking !== null &&
    (params.thinking.type === "enabled" || params.thinking.type === "adaptive");
  const thinkingMode: "chat" | "thinking" = thinkingEnabled
    ? "thinking"
    : "chat";

  // System prompt — extract from string or array of text blocks
  let systemContent = "";
  if (params.system) {
    if (typeof params.system === "string") {
      systemContent = params.system;
    } else if (Array.isArray(params.system)) {
      systemContent = params.system
        .filter((b): b is TextBlockParam => b.type === "text")
        .map(b => b.text)
        .join("\n");
    }
  }

  // Prepend effort prefix when thinking is enabled
  if (thinkingEnabled && systemContent) {
    systemContent = EFFORT_MAX_PREFIX + "\n\n" + systemContent;
  } else if (thinkingEnabled) {
    systemContent = EFFORT_MAX_PREFIX;
  }

  if (systemContent) {
    dsmlMessages.push({ role: "system", content: systemContent });
  }

  // Convert conversation messages
  for (const msg of params.messages) {
    if (msg.role === "user") {
      const textParts: string[] = [];
      const toolResults: DSMLToolResult[] = [];

      if (typeof msg.content === "string") {
        textParts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
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
                    .map(b => b.text)
                    .join("\n");
            toolResults.push({
              id: block.tool_use_id,
              name: "",
              content: resultContent,
              isError: block.is_error,
            });
          }
          // Image blocks are not currently supported — silently skipped
        }
      }

      dsmlMessages.push({
        role: "user",
        content: textParts.join("\n"),
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      });
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: DSMLToolCall[] = [];

      if (typeof msg.content === "string") {
        textParts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              name: block.name,
              arguments: block.input,
            });
          }
        }
      }

      dsmlMessages.push({
        role: "assistant",
        content: textParts.join("\n"),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    }
  }

  return { messages: dsmlMessages, thinkingMode };
}

// ════════════════════════════════════════════════════════════════════════════
// DeepSeek response to Anthropic BetaMessage conversion
// ════════════════════════════════════════════════════════════════════════════

export function deepseekToAnthropicResponse(
  text: string,
  model: string,
  thinkingMode: "chat" | "thinking",
): BetaMessage {
  const parsed = parseAssistantResponse(text, thinkingMode);
  const content: ContentBlock[] = [];

  // Text content block
  if (parsed.content) {
    content.push({ type: "text", text: parsed.content });
  }

  // Tool use content blocks
  for (const tc of parsed.toolCalls) {
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: tc.arguments,
    });
  }

  return {
    id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason:
      parsed.toolCalls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Stream event builder
// ════════════════════════════════════════════════════════════════════════════

function* buildStreamEvents(
  message: BetaMessage,
): Generator<BetaStreamEvent> {
  // message_start
  yield { type: "message_start", message };

  // Individual content block events
  for (let i = 0; i < message.content.length; i++) {
    const block = message.content[i]!;
    yield { type: "content_block_start", index: i, content_block: block };
    if (block.type === "text") {
      yield {
        type: "content_block_delta",
        index: i,
        delta: { type: "text_delta", text: block.text },
      };
    }
    yield { type: "content_block_stop", index: i };
  }

  // message_delta with stop_reason
  yield {
    type: "message_delta",
    delta: {
      stop_reason: message.stop_reason ?? undefined,
      stop_sequence: message.stop_sequence ?? undefined,
    },
    usage: { output_tokens: message.usage.output_tokens },
  };

  // message_stop
  yield { type: "message_stop" };
}

// ════════════════════════════════════════════════════════════════════════════
// Error class
// ════════════════════════════════════════════════════════════════════════════

export class DeepSeekAPIError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DeepSeekAPIError";
    this.status = status;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DeepSeekProvider — implements ProviderAdapter, matches Anthropic SDK shape
// ════════════════════════════════════════════════════════════════════════════

export class DeepSeekProvider implements ProviderAdapter {
  readonly provider: ProviderName = "deepseek";
  readonly apiKey: string;
  readonly baseURL: string;
  readonly maxRetries: number;

  private modelMapping: Record<string, string> = {
    opus: "deepseek-v4-pro",
    sonnet: "deepseek-v4-flash",
    haiku: "deepseek-v4-flash",
  };

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

  constructor(config?: {
    apiKey?: string;
    baseURL?: string;
    maxRetries?: number;
  }) {
    this.apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "";
    this.baseURL =
      config?.baseURL ||
      process.env.DEEPSEEK_BASE_URL ||
      "https://api.deepseek.com";
    this.maxRetries = config?.maxRetries ?? 3;

    // Bind methods so the nested object properties close over `this`
    const self = this;

    this.beta = {
      messages: {
        create: (params, options) => self.createInternal(params, options),
        stream: (params, options) => self.streamInternal(params, options),
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
    return true;
  }

  supportsStreaming(): boolean {
    return true;
  }

  supportsTools(): boolean {
    return true;
  }

  // ── Internal implementation ──

  private async createInternal(
    params: BetaMessageCreateParams,
    options?: RequestOptions,
  ): Promise<BetaMessage> {
    const { messages: dsmlMessages, thinkingMode } =
      anthropicMessagesToDSML(params);

    // Encode the full conversation into a single DSML prompt string
    const encodedPrompt = encodeMessages(dsmlMessages, thinkingMode);

    // Build the OpenAI-compatible request body
    const body: Record<string, unknown> = {
      model: params.model,
      messages: [{ role: "user", content: encodedPrompt }],
      max_tokens: params.max_tokens,
      temperature: params.temperature ?? 1,
      stream: false,
    };

    if (params.top_p !== undefined) body.top_p = params.top_p;
    if (params.stop_sequences !== undefined) body.stop = params.stop_sequences;

    const url = `${this.baseURL.replace(/\/$/, "")}/v1/chat/completions`;

    // HTTP POST
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...options?.headers,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DeepSeekAPIError(`Connection failed: ${msg}`, 0);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown");
      throw new DeepSeekAPIError(
        `API ${response.status}: ${text}`,
        response.status,
      );
    }

    // Parse the DeepSeek response
    const json = (await response.json()) as {
      choices: Array<{
        message: { content: string };
        finish_reason: string;
      }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = json.choices?.[0];
    if (!choice) {
      throw new DeepSeekAPIError("No choices in response", 0);
    }

    const responseText = choice.message?.content || "";
    const betaMessage = deepseekToAnthropicResponse(
      responseText,
      json.model || params.model,
      thinkingMode,
    );

    // Populate usage from API response
    if (json.usage) {
      betaMessage.usage.input_tokens = json.usage.prompt_tokens;
      betaMessage.usage.output_tokens = json.usage.completion_tokens;
    }

    // Map DeepSeek finish_reason to Anthropic stop_reason
    if (choice.finish_reason === "stop") {
      // If we parsed tool calls from DSML, prefer "tool_use"
      betaMessage.stop_reason =
        betaMessage.content.some(b => b.type === "tool_use")
          ? "tool_use"
          : "end_turn";
    } else if (choice.finish_reason === "length") {
      betaMessage.stop_reason = "max_tokens";
    } else if (choice.finish_reason === "tool_calls") {
      betaMessage.stop_reason = "tool_use";
    }

    return betaMessage;
  }

  private async *streamInternal(
    params: BetaMessageCreateParams,
    options?: RequestOptions,
  ): AsyncGenerator<BetaStreamEvent> {
    // Simplified streaming: make the non-streaming call, then yield
    // the complete result as stream events. Full SSE streaming can
    // be added later by replacing this call.
    const message = await this.createInternal(params, options);
    yield* buildStreamEvents(message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Singleton lifecycle
// ════════════════════════════════════════════════════════════════════════════

let providerInstance: DeepSeekProvider | null = null;

export function getDeepSeekProvider(config?: {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
}): DeepSeekProvider {
  if (!providerInstance) {
    providerInstance = new DeepSeekProvider(config);
  }
  return providerInstance;
}

export function resetDeepSeekProvider(): void {
  providerInstance = null;
}
