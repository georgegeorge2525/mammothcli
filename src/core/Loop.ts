// MammothLoop — lightweight query engine wrapping the Mammoth API client

import { ProviderClient, type StreamEvent } from '../../services/providerClient.js'
// Keep old client for backward compat
export { ProviderClient as MammothAPIClient } from '../../services/providerClient.js'
import type { DSMLMessage, DSMLToolCall, DSMLToolResult } from '../../services/deepseekProtocol.js'

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>

export interface LoopCallbacks {
  onText: (text: string) => void
  onThinking: (text: string) => void
  onToolCall: (name: string, args: Record<string, unknown>) => void
  onToolResult: (name: string, result: string) => void
  onError: (error: string) => void
}

// Load system prompt from file (with DSML tokens properly encoded)
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

let _cachedPrompt = ''

export function buildSystemPrompt(cwd: string): string {
  if (!_cachedPrompt) {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    _cachedPrompt = readFileSync(join(__dirname, '..', 'system-prompt.txt'), 'utf-8')
  }
  return 'Reasoning Effort: Be thorough. Decompose problems, consider alternatives, verify assumptions.\n\n' +
    _cachedPrompt.replace('${CWD}', cwd)
}

export class MammothLoop {
  private toolSchemas: any[] = []
  private systemPrompt = ''

  setToolSchemas(schemas: any[]): void { this.toolSchemas = schemas }
  private client: ProviderClient
  public maxTurns = 10

  constructor(apiKey?: string) {
    this.client = new ProviderClient({ apiKey })
  }

  setSystem(prompt?: string, _tier = 3): void {
    if (!prompt) prompt = buildSystemPrompt(process.cwd())
    this.systemPrompt = prompt
    this.client.setSystem(prompt)
  }

  getSystemPrompt(): string {
    return this.systemPrompt || this.client.getMessages().find(m => m.role === 'system')?.content || ''
  }

  appendToSystem(addition: string): void {
    const current = this.getSystemPrompt()
    this.client.setSystem(current + '\n\n' + addition)
    this.systemPrompt = current + '\n\n' + addition
  }

  clearHistory(): void { this.client.clearMessages() }

  getModel(): string { return this.client.config.model }

  setModel(model: string): void {
    this.client.config.model = model
    // Re-set system prompt so the client picks up the new model on next stream
    if (this.systemPrompt) this.client.setSystem(this.systemPrompt)
  }

    addToHistory(msg: DSMLMessage): void {
    this.client.getMessages().push(msg)
  }

  getClientMessages(): DSMLMessage[] {
    return this.client.getMessages()
  }
  getMessages(): DSMLMessage[] { return this.client.getMessages() }

  addUserMessage(content: string): void {
    this.client.addMessage({ role: 'user', content })
  }

  async runTurn(
    executeTool: ToolExecutor,
    callbacks: LoopCallbacks,
  ): Promise<{ text: string; toolCalls: DSMLToolCall[]; done: boolean }> {
    let fullText = ''
    const toolCalls: DSMLToolCall[] = []

    for await (const event of this.client.stream(this.toolSchemas)) {
      switch (event.type) {
        case 'text':
          if (event.content) { fullText += event.content; callbacks.onText(event.content) }
          break
        case 'thinking':
          if (event.content) callbacks.onThinking(event.content)
          break
        case 'tool_calls':
          // Native tool calls from API - extract from event
          if (event.toolCalls) {
            for (const tc of event.toolCalls) {
              toolCalls.push(tc)
            }
          }
          break
        case 'error':
          callbacks.onError(event.error || 'Unknown error')
          return { text: fullText, toolCalls, done: true }
      }
    }

    // Tool calls are emitted directly from the API via 'tool_calls' event
    return { text: fullText, toolCalls, done: toolCalls.length === 0 }
  }

  async runConversation(
    userInput: string,
    executeTool: ToolExecutor,
    callbacks: LoopCallbacks,
  ): Promise<string> {
    this.client.addMessage({ role: 'user', content: userInput })

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const result = await this.runTurn(executeTool, callbacks)
      if (result.toolCalls.length === 0) return result.text

      for (const tc of result.toolCalls) {
        callbacks.onToolCall(tc.name, tc.arguments)
        const toolResult = await executeTool(tc.name, tc.arguments)
        callbacks.onToolResult(tc.name, toolResult)
        this.client.addMessage({
          role: 'user', content: '',
          toolResults: [{ id: tc.id, name: tc.name, content: toolResult,
            isError: toolResult.startsWith('Error') || toolResult.startsWith('Exit') }],
        })
      }
    }
    return '[Max turns reached]'
  }
}
