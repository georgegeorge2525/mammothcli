// src/services/mammoth/apiClient.ts (v3 A1 native DeepSeek tools API)
// Uses the standard /v1/chat/completions endpoint with the `tools` parameter.
// DeepSeek handles tool execution format internally A1 no DSML prompt encoding needed.

import type { DSMLMessage, DSMLToolCall } from './deepseekProtocol.js'

export interface MammothAPIConfig {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens?: number
  temperature?: number
  thinking?: boolean
}

const DEFAULT_CONFIG: MammothAPIConfig = {
  baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  maxTokens: 32000,
  temperature: 0.7,
}

export interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_calls' | 'done' | 'error'
  content?: string
  toolCalls?: DSMLToolCall[]
  error?: string
}

// Tool definitions in OpenAI-compatible JSON Schema format
export const MAMMOTH_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'Bash',
      description: 'Execute a shell command. Use PowerShell syntax on Windows.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          description: { type: 'string', description: 'Brief description' },
          timeout: { type: 'number', description: 'Timeout in ms (max 600000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'Read', description: 'Read a file from disk.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file' },
          offset: { type: 'number' }, limit: { type: 'number' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'Write', description: 'Write content to a file. Creates parent dirs.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' }, content: { type: 'string' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'Edit', description: 'Replace old_string with new_string in a file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' }, old_string: { type: 'string' },
          new_string: { type: 'string' }, replace_all: { type: 'boolean' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'Grep', description: 'Search for regex pattern in files (ripgrep).',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          path: { type: 'string', description: 'Directory to search (default: cwd)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'Glob', description: 'Find files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob like **/*.ts' },
          path: { type: 'string', description: 'Directory (default: cwd)' },
        },
        required: ['pattern'],
      },
    },
  },
]

export class MammothAPIClient {
  config: MammothAPIConfig
  private messages: DSMLMessage[] = []

  constructor(config?: Partial<MammothAPIConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  addMessage(message: DSMLMessage): void { this.messages.push(message) }
  getMessages(): DSMLMessage[] { return this.messages }
  clearMessages(): void { this.messages = [] }

  setSystem(content: string): void {
    this.messages = [
      { role: 'system', content },
      ...this.messages.filter(m => m.role !== 'system'),
    ]
  }

  async *stream(tools?: any[]): AsyncGenerator<StreamEvent> {
    const apiMessages: Array<Record<string, unknown>> = []

    for (const m of this.messages) {
      if (m.role === 'system') {
        apiMessages.push({ role: 'system', content: m.content })
      } else if (m.role === 'user') {
        // Add tool results as separate tool role messages
        if (m.toolResults && m.toolResults.length > 0) {
          for (const tr of m.toolResults) {
            apiMessages.push({ role: 'tool', tool_call_id: tr.id, content: tr.content })
          }
        }
        if (m.content) {
          apiMessages.push({ role: 'user', content: m.content })
        }
      } else if (m.role === 'assistant') {
        const entry: Record<string, unknown> = { role: 'assistant' }
        if (m.reasoning) entry.reasoning_content = m.reasoning
        if (m.toolCalls && m.toolCalls.length > 0) {
          entry.tool_calls = m.toolCalls.map(tc => ({
            id: tc.id, type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }))
          entry.content = m.content || ''
        } else if (m.content) {
          entry.content = m.content
        }
        apiMessages.push(entry)
      }
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: apiMessages,
      stream: true,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      tools: tools || MAMMOTH_TOOLS,
      tool_choice: 'auto',
      ...(this.config.thinking !== false ? { thinking: { type: 'enabled' as const }, reasoning_effort: 'high' } : {}),
    }

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey}` },
        body: JSON.stringify(body),
      })
    } catch (err: any) {
      yield { type: 'error', error: 'Connection failed: ' + err.message }
      return
    }

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown')
      yield { type: 'error', error: 'API ' + response.status + ': ' + text.slice(0, 300) }
      return
    }

    if (!response.body) { yield { type: 'error', error: 'No response body' }; return }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    let fullReasoning = ''
    const tcAccum: Map<number, { id: string; name: string; arguments: string }> = new Map()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') { yield { type: 'done' }; continue }

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            if (!delta) continue

            if (delta.reasoning_content) {
              fullReasoning += delta.reasoning_content
              yield { type: 'thinking', content: delta.reasoning_content }
            }
            if (delta.content) {
              fullContent += delta.content
              yield { type: 'text', content: delta.content }
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index || 0
                if (!tcAccum.has(idx)) tcAccum.set(idx, { id: tc.id || '', name: '', arguments: '' })
                const a = tcAccum.get(idx)!
                if (tc.id) a.id = tc.id
                if (tc.function?.name) a.name += tc.function.name
                if (tc.function?.arguments) a.arguments += tc.function.arguments
              }
            }
            if (parsed.choices?.[0]?.finish_reason) yield { type: 'done' }
          } catch { /* skip malformed SSE */ }
        }
      }
    } finally { reader.releaseLock() }

    // Build tool calls from accumulated deltas
    const toolCalls: DSMLToolCall[] = []
    for (const [, a] of tcAccum) {
      if (a.name) {
        try {
          toolCalls.push({ id: a.id || ('call_' + toolCalls.length.toString(16).padStart(4, '0')), name: a.name, arguments: JSON.parse(a.arguments || '{}') })
        } catch {
          toolCalls.push({ id: a.id || ('call_' + toolCalls.length.toString(16).padStart(4, '0')), name: a.name, arguments: {} })
        }
      }
    }
    if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls }

    this.messages.push({
      role: 'assistant', content: fullContent,
      reasoning: fullReasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    })
  }

  async call(tools?: any[]): Promise<{ text: string; thinking: string; toolCalls: DSMLToolCall[] }> {
    let ft = ''; let ftk = ''; let tcs: DSMLToolCall[] = []
    for await (const e of this.stream()) {
      if (e.type === 'text') ft += e.content || ''
      if (e.type === 'thinking') ftk += e.content || ''
      if (e.type === 'tool_calls') tcs = e.toolCalls || []
      if (e.type === 'error') throw new Error(e.error || 'API error')
    }
    return { text: ft, thinking: ftk, toolCalls: tcs }
  }
}

let clientInstance: MammothAPIClient | null = null
export function getClient(config?: Partial<MammothAPIConfig>): MammothAPIClient {
  if (!clientInstance) clientInstance = new MammothAPIClient(config)
  return clientInstance
}
export function resetClient(): void { clientInstance = null }