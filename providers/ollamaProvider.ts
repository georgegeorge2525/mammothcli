// src/providers/ollamaProvider.ts
// Ollama provider — singleton factory. No auth (local server).

import { OpenAICompatibleProvider } from "./openAICompatibleProvider.js";

const MODEL_MAP: Record<string, string> = {
  opus: "llama3.1",
  sonnet: "llama3.1",
  haiku: "llama3.1",
};

let instance: OpenAICompatibleProvider | null = null;

export function getOllamaProvider(apiKey?: string): OpenAICompatibleProvider {
  if (!instance) {
    instance = new OpenAICompatibleProvider({
      provider: "ollama",
      baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      apiKey: "",
      defaultModel: process.env.OLLAMA_MODEL || "llama3.1",
      modelMapping: MODEL_MAP,
      noAuth: true,
    });
  }
  return instance;
}

export function resetOllamaProvider(): void {
  instance = null;
}
