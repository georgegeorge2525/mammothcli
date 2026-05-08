// src/providers/sdkTypes.ts
// Drop-in replacement for ALL @anthropic-ai/sdk imports.
// Every type that was imported from @anthropic-ai/sdk/resources/*
// is available here. Import paths use .js extensions for ESM.

export type {
  BetaMessage,
  BetaStopReason,
  BetaStreamEvent,
  ContentBlock,
  ContentBlockParam,
  TextBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
  ImageBlockParam,
  MessageParam,
  ToolSchema,
  ThinkingConfig,
  BetaMessageCreateParams,
  RequestOptions,
  ProviderName,
  BetaContentBlock,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTool,
  BetaToolUnion,
  BetaToolUseBlock,
  BetaUsage,
  Base64ImageSource,
  ThinkingBlock,
  ThinkingBlockParam,
  ToolUseBlock,
  APIError,
} from './types.js'
