// src/providers/openrouterProvider.ts
// OpenRouter provider — singleton factory. Auth header is "Bearer $KEY".

import { OpenAICompatibleProvider } from "./openAICompatibleProvider.js";

const MODEL_MAP: Record<string, string> = {
  opus: "openai/gpt-4o",
  sonnet: "openai/gpt-4o-mini",
  haiku: "openai/gpt-4o-mini",
};

let instance: OpenAICompatibleProvider | null = null;

export function getOpenRouterProvider(apiKey?: string): OpenAICompatibleProvider {
  if (!instance) {
    instance = new OpenAICompatibleProvider({
      provider: "openrouter",
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: apiKey || process.env.OPENROUTER_API_KEY || "",
      defaultModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o",
      modelMapping: MODEL_MAP,
      authPrefix: "Bearer",
    });
  }
  return instance;
}

export function resetOpenRouterProvider(): void {
  instance = null;
}
