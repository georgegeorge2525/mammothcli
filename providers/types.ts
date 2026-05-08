// src/providers/types.ts
// Shared type definitions mirroring @anthropic-ai/sdk shapes.
// Used by all provider adapters so they present a uniform interface
// to the query engine.

// Content block in an Anthropic response message
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ToolUseBlock;

// The standard Anthropic BetaMessage response shape
export interface BetaMessage {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Stream event types consumed by the streaming path
export interface BetaMessageStartEvent {
  type: "message_start";
  message: BetaMessage;
}

export interface BetaContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: ContentBlock;
}

export interface BetaContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: { type: "text_delta"; text: string };
}

export interface BetaContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface BetaMessageDeltaEvent {
  type: "message_delta";
  delta: { stop_reason?: string; stop_sequence?: string };
  usage?: { output_tokens: number };
}

export interface BetaMessageStopEvent {
  type: "message_stop";
}

export type BetaStreamEvent =
  | BetaMessageStartEvent
  | BetaContentBlockStartEvent
  | BetaContentBlockDeltaEvent
  | BetaContentBlockStopEvent
  | BetaMessageDeltaEvent
  | BetaMessageStopEvent;

// Content block param types (input side)

export interface TextBlockParam {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; scope?: string; ttl?: string };
}

export interface ToolUseBlockParam {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlockParam[];
  is_error?: boolean;
}

export interface ImageBlockParam {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

export type ContentBlockParam =
  | TextBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ImageBlockParam;

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
}

export interface ToolSchema {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type ThinkingConfig =
  | { type: "enabled"; budget_tokens: number }
  | { type: "adaptive" }
  | { type: "disabled" };

// Full parameter shape for Anthropic messages.create / messages.stream
export interface BetaMessageCreateParams {
  model: string;
  messages: MessageParam[];
  system?: string | TextBlockParam[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: Record<string, string>;
  tools?: ToolSchema[];
  tool_choice?:
    | { type: "auto" }
    | { type: "any" }
    | { type: "tool"; name: string };
  thinking?: ThinkingConfig;
  betas?: string[];
  speed?: string;
  [key: string]: unknown;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  headers?: Record<string, string>;
}

// Known provider identifiers
export type ProviderName = "deepseek" | "openai" | "groq" | "ollama" | "openrouter" | "claude";

// ── From @anthropic-ai/sdk/resources/beta/messages/messages.mjs ──

export interface BetaContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image'
  // TextBlock
  text?: string
  // ToolUseBlock
  id?: string
  name?: string
  input?: Record<string, unknown>
  // ToolResultBlock
  tool_use_id?: string
  content?: string | ContentBlockParam[]
  is_error?: boolean
  // ThinkingBlock
  thinking?: string
  signature?: string
  // ImageBlock
  source?: { type: 'base64'; media_type: string; data: string }
}

export interface BetaMessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}

export interface BetaMessageStreamParams {
  model: string
  messages: BetaMessageParam[]
  system?: string | TextBlockParam[]
  max_tokens: number
  temperature?: number
  top_p?: number
  top_k?: number
  stop_sequences?: string[]
  stream?: boolean
  metadata?: Record<string, string>
  tools?: ToolSchema[]
  tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string }
  thinking?: ThinkingConfig
  betas?: string[]
  speed?: string
}

export interface BetaTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
  cache_control?: { type: 'ephemeral' } | null
}

export type BetaToolUnion = BetaTool

export interface BetaToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface BetaUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

// ── From @anthropic-ai/sdk/resources/messages.mjs ──

export interface Base64ImageSource {
  type: 'base64'
  media_type: string
  data: string
}

// ── From @anthropic-ai/sdk/resources/index.mjs ──

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
  signature: string
}

export interface ThinkingBlockParam {
  type: 'thinking'
  thinking: string
  signature: string
}


// Stop reason types

export type BetaStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal'

// From @anthropic-ai/sdk (main)

export interface APIError extends Error {
  status: number
  headers?: Record<string, string>
  error?: {
    type: string
    message: string
  }
}
