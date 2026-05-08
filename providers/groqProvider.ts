// src/providers/groqProvider.ts
// Groq provider — singleton factory.

import { OpenAICompatibleProvider } from "./openAICompatibleProvider.js";

const MODEL_MAP: Record<string, string> = {
  opus: "llama-4-maverick-128k",
  sonnet: "llama-4-maverick-128k",
  haiku: "llama-4-maverick-128k",
};

let instance: OpenAICompatibleProvider | null = null;

export function getGroqProvider(apiKey?: string): OpenAICompatibleProvider {
  if (!instance) {
    instance = new OpenAICompatibleProvider({
      provider: "groq",
      baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai",
      apiKey: apiKey || process.env.GROQ_API_KEY || "",
      defaultModel: process.env.GROQ_MODEL || "llama-4-maverick-128k",
      modelMapping: MODEL_MAP,
    });
  }
  return instance;
}

export function resetGroqProvider(): void {
  instance = null;
}
