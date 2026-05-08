// src/providers/providerFactory.ts
// Multi-provider factory. Returns the right ProviderAdapter based on
// MAMMOTH_PROVIDER env var or explicit caller choice.

import type { ProviderAdapter } from "./ProviderAdapter.js";
import type { ProviderName } from "./types.js";
import { getDeepSeekProvider } from "./deepseekProvider.js";

// Lazy-load other providers to avoid importing all SDKs at startup.

async function getOpenAIProvider(): Promise<ProviderAdapter> {
  const mod = await import("./openaiProvider.js");
  return mod.getOpenAIProvider();
}

async function getGroqProvider(): Promise<ProviderAdapter> {
  const mod = await import("./groqProvider.js");
  return mod.getGroqProvider();
}

async function getOllamaProvider(): Promise<ProviderAdapter> {
  const mod = await import("./ollamaProvider.js");
  return mod.getOllamaProvider();
}

async function getOpenRouterProvider(): Promise<ProviderAdapter> {
  const mod = await import("./openrouterProvider.js");
  return mod.getOpenRouterProvider();
}

async function getClaudeProvider(): Promise<ProviderAdapter> {
  const mod = await import("./claudeProvider.js");
  return mod.getClaudeProvider();
}

const PROVIDER_FACTORY: Record<ProviderName, () => ProviderAdapter | Promise<ProviderAdapter>> = {
  deepseek: () => getDeepSeekProvider(),
  openai: () => getOpenAIProvider(),
  groq: () => getGroqProvider(),
  ollama: () => getOllamaProvider(),
  openrouter: () => getOpenRouterProvider(),
  claude: () => getClaudeProvider(),
};

export async function getProvider(providerName?: ProviderName): Promise<ProviderAdapter> {
  const name = providerName || (process.env.MAMMOTH_PROVIDER as ProviderName) || "deepseek";
  const factory = PROVIDER_FACTORY[name];
  if (!factory) {
    console.warn(`Unknown provider: ${name}, falling back to deepseek`);
    return getDeepSeekProvider();
  }
  return factory();
}

export function getProviderSync(): ProviderAdapter {
  // Synchronous access for DeepSeek (always available without dynamic import)
  const name = (process.env.MAMMOTH_PROVIDER as ProviderName) || "deepseek";
  if (name === "deepseek") return getDeepSeekProvider();
  // For other providers, return DeepSeek as fallback and let the first API call trigger the right provider
  console.warn(`Provider ${name} requires async init; using DeepSeek for sync access. First API call will switch.`);
  return getDeepSeekProvider();
}
