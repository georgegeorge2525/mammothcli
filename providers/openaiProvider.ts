// src/providers/openaiProvider.ts
// OpenAI provider — singleton factory.

import { OpenAICompatibleProvider } from "./openAICompatibleProvider.js";

const MODEL_MAP: Record<string, string> = {
  opus: "gpt-4o",
  sonnet: "gpt-4o-mini",
  haiku: "gpt-4o-mini",
};

let instance: OpenAICompatibleProvider | null = null;

export function getOpenAIProvider(apiKey?: string): OpenAICompatibleProvider {
  if (!instance) {
    instance = new OpenAICompatibleProvider({
      provider: "openai",
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com",
      apiKey: apiKey || process.env.OPENAI_API_KEY || "",
      defaultModel: process.env.OPENAI_MODEL || "gpt-4o",
      modelMapping: MODEL_MAP,
    });
  }
  return instance;
}

export function resetOpenAIProvider(): void {
  instance = null;
}
