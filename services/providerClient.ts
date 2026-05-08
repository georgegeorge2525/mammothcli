// services/providerClient.ts — Multi-provider API client
// Routes through the provider factory. Supports DeepSeek, OpenAI, Groq,
// Ollama, OpenRouter, and Anthropic Claude. Presents same interface as
// the old MammothAPIClient so MammothLoop works unchanged.

import type { ProviderAdapter } from '../providers/ProviderAdapter.js'
import type { ProviderName } from '../providers/types.js'
import { getProvider, getProviderSync } from '../providers/providerFactory.js'
import type { DSMLMessage, DSMLToolCall } from './deepseekProtocol.js'

export interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_calls' | 'done' | 'error'
  content?: string
  toolCalls?: DSMLToolCall[]
  error?: string
}

export interface ProviderClientConfig {
  apiKey?: string
  model?: string
  provider?: ProviderName
}

export class ProviderClient {
  config: { model: string; provider: ProviderName }
  private messages: DSMLMessage[] = []
  private adapter: ProviderAdapter | null = null
  private adapterPromise: Promise<ProviderAdapter> | null = null

  constructor(config?: ProviderClientConfig) {
    const provider = config?.provider ||
      (process.env.MAMMOTH_PROVIDER as ProviderName) || 'deepseek'
    this.config = {
      provider,
      model: config?.model || process.env.MAMMOTH_MODEL || this.defaultModel(provider),
    }
    // Pre-init sync adapter for deepseek (always available)
    if (provider === 'deepseek') {
      this.adapter = getProviderSync()
    }
  }

  private defaultModel(provider: ProviderName): string {
    const defaults: Record<string, string> = {
      deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
      openai: process.env.OPENAI_MODEL || 'gpt-4o',
      groq: process.env.GROQ_MODEL || 'llama-4-maverick-128k',
      ollama: process.env.OLLAMA_MODEL || 'llama3.1',
      openrouter: process.env.OPENROUTER_MODEL || 'openai/gpt-4o',
      claude: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    }
    return defaults[provider] || 'deepseek-v4-pro'
  }

  private async getAdapter(): Promise<ProviderAdapter> {
    if (this.adapter) return this.adapter
    if (!this.adapterPromise) {
      this.adapterPromise = getProvider(this.config.provider)
    }
    this.adapter = await this.adapterPromise
    return this.adapter
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
    // Convert DSML messages to Anthropic-compatible params
    const systemMsg = this.messages.find(m => m.role === 'system')
    const userMessages = this.messages.filter(m => m.role !== 'system')

    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string | any[] }> = []
    for (const m of userMessages) {
      if (m.role === 'user') {
        const blocks: any[] = []
        if (m.toolResults?.length) {
          for (const tr of m.toolResults) {
            blocks.push({
              type: 'tool_result',
              tool_use_id: tr.id,
              content: tr.content,
              is_error: tr.isError,
            })
          }
        }
        if (m.content) {
          if (blocks.length > 0) {
            blocks.unshift({ type: 'text', text: m.content })
          } else {
            blocks.push({ type: 'text', text: m.content })
          }
        }
        anthropicMessages.push({ role: 'user', content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks })
      } else if (m.role === 'assistant') {
        const blocks: any[] = []
        if (m.content) blocks.push({ type: 'text', text: m.content })
        if (m.toolCalls?.length) {
          for (const tc of m.toolCalls) {
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
          }
        }
        anthropicMessages.push({ role: 'assistant', content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks })
      }
    }

    const adapter = await this.getAdapter()

    // Map canonical model to provider-specific model
    const mappedModel = adapter.mapModel(this.config.model)

    // Convert tools to Anthropic format
    const anthropicTools = tools?.map((t: any) => ({
      name: t.function?.name || t.name,
      description: t.function?.description || t.description,
      input_schema: t.function?.parameters || t.input_schema || t.parameters || {},
    }))

    const params: any = {
      model: mappedModel,
      messages: anthropicMessages,
      max_tokens: 32000,
      temperature: 0.7,
      stream: true,
    }
    if (systemMsg) params.system = systemMsg.content
    if (anthropicTools?.length) {
      params.tools = anthropicTools
      params.tool_choice = { type: 'auto' }
    }
    if (adapter.supportsReasoning()) {
      params.thinking = { type: 'enabled', budget_tokens: 8000 }
    }

    let fullContent = ''
    let fullReasoning = ''
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

    try {
      for await (const event of adapter.beta.messages.stream(params)) {
        switch (event.type) {
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              fullContent += event.delta.text
              yield { type: 'text', content: event.delta.text }
            }
            break
          case 'content_block_start':
            if (event.content_block?.type === 'tool_use') {
              toolUseBlocks.push({
                id: event.content_block.id || '',
                name: event.content_block.name || '',
                input: event.content_block.input || {},
              })
            }
            if (event.content_block?.type === 'text') {
              // Anthropic thinking blocks sometimes come as text blocks
            }
            break
          case 'content_block_stop':
            break
          case 'message_delta':
            break
          case 'message_stop':
            break
          case 'message_start':
            break
        }
      }
    } catch (err: any) {
      yield { type: 'error', error: err.message || 'API error' }
      return
    }

    // Build tool calls for consistency with old DSML format
    const toolCalls: DSMLToolCall[] = toolUseBlocks.map((b, i) => ({
      id: b.id || `call_${i.toString(16).padStart(4, '0')}`,
      name: b.name,
      arguments: b.input,
    }))

    if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls }

    this.messages.push({
      role: 'assistant',
      content: fullContent,
      reasoning: fullReasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    })
  }
}
