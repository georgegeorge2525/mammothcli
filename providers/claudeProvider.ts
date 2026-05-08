// providers/claudeProvider.ts — Anthropic Claude provider
// Uses the Anthropic Messages API directly (no intermediate format).

import type { ProviderAdapter } from './ProviderAdapter.js'
import type { ProviderName } from './types.js'

const MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  pro: 'claude-sonnet-4-6',
  flash: 'claude-haiku-4-5-20251001',
}

interface ClaudeConfig {
  apiKey?: string
  baseURL?: string
}

class ClaudeProvider implements ProviderAdapter {
  readonly provider: ProviderName = 'claude'
  private apiKey: string
  private baseURL: string

  constructor(config?: ClaudeConfig) {
    this.apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || ''
    this.baseURL = config?.baseURL || process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com'
  }

  readonly beta = {
    messages: {
      create: async (params: any, options?: any) => this.create(params, options),
      stream: (params: any, options?: any) => this.stream(params, options),
    },
  }

  readonly messages = {
    create: async (params: any, options?: any) => this.create(params, options),
  }

  private async create(params: any, _options?: any): Promise<any> {
    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'tools-2024-04-04',
      },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const err = await response.text().catch(() => 'Unknown error')
      throw new Error(`Claude API ${response.status}: ${err.slice(0, 300)}`)
    }
    return response.json()
  }

  private async *stream(params: any, _options?: any): AsyncGenerator<any> {
    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'tools-2024-04-04',
      },
      body: JSON.stringify({ ...params, stream: true }),
    })

    if (!response.ok) {
      const err = await response.text().catch(() => 'Unknown')
      throw new Error(`Claude API ${response.status}: ${err.slice(0, 300)}`)
    }
    if (!response.body) throw new Error('No response body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (!data) continue
          try {
            const parsed = JSON.parse(data)
            yield parsed
          } catch { /* skip malformed SSE */ }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  mapModel(canonical: string): string {
    return MODEL_MAP[canonical] || canonical
  }

  supportsReasoning(): boolean { return true }
  supportsStreaming(): boolean { return true }
  supportsTools(): boolean { return true }
}

let instance: ClaudeProvider | null = null

export function getClaudeProvider(apiKey?: string): ClaudeProvider {
  if (!instance) {
    instance = new ClaudeProvider({ apiKey })
  }
  return instance
}

export function resetClaudeProvider(): void {
  instance = null
}
