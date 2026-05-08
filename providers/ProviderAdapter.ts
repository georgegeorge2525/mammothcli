// src/providers/ProviderAdapter.ts
// Every provider must implement this interface so the query engine
// can treat them uniformly (the engine casts them `as unknown as Anthropic`).

import type {
  BetaMessage,
  BetaMessageCreateParams,
  BetaStreamEvent,
  RequestOptions,
  ProviderName,
} from "./types.js";

export interface ProviderAdapter {
  readonly provider: ProviderName;

  readonly beta: {
    messages: {
      create(
        params: BetaMessageCreateParams,
        options?: RequestOptions,
      ): Promise<BetaMessage>;
      stream(
        params: BetaMessageCreateParams,
        options?: RequestOptions,
      ): AsyncIterable<BetaStreamEvent>;
    };
  };

  readonly messages: {
    create(
      params: BetaMessageCreateParams,
      options?: RequestOptions,
    ): Promise<BetaMessage>;
  };

  /** Map a canonical model name (opus/sonnet/haiku) to the provider-specific model ID. */
  mapModel(canonical: string): string;

  /** Whether this provider supports reasoning/thinking (extended thinking). */
  supportsReasoning(): boolean;

  /** Whether this provider supports streaming responses. */
  supportsStreaming(): boolean;

  /** Whether this provider supports tool use / function calling. */
  supportsTools(): boolean;
}
