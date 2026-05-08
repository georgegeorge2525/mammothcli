// Commands — slash command handlers for the Mammoth TUI
// Claude Code-compatible: /help, /clear, /model, /status, /sessions, /resume,
// /cost, /memory, /consolidate, /compact, /doctor, /config, /workflow, /hud

import type { SessionStore } from './SessionStore.js'
import type { MammothLoop } from './MammothLoop.js'
import type { MemoryManager } from './memory/MemoryManager.js'
import type { MammothEngine } from './engine/MammothEngine.js'

export interface CommandResult {
  type: 'info' | 'success' | 'error' | 'list'
  message: string
  items?: string[]
}

export function handleCommand(
  input: string,
  loop: MammothLoop,
  sessions: SessionStore,
  onClear: () => void,
  onResume: (id: string) => void,
  memory?: MemoryManager,
  engine?: MammothEngine,
): CommandResult | null {
  const parts = input.trim().split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const arg = parts.slice(1).join(' ')

  switch (cmd) {
    // ── Help ──
    case '/help':
      return {
        type: 'list',
        message: 'Available commands:',
        items: [
          '/help              Show this help',
          '/clear             Clear conversation history',
          '/model [name]      Show or change model (deepseek-v4-pro, deepseek-v4-flash)',
          '/status            Show session information',
          '/sessions          List saved sessions',
          '/resume <id>       Resume a saved session',
          '/cost              Show API usage estimate',
          '/memory            Show memory system stats',
          '/consolidate       Run memory consolidation',
          '/compact           Trim conversation to save context',
          '/doctor            Run system diagnostics',
          '/config            Show current configuration',
          '/workflow          Show active workflows',
          '/hud               Show HUD statusline',
          '/exit, /quit       Exit Mammoth',
        ],
      }

    // ── Clear ──
    case '/clear':
      loop.clearHistory()
      loop.setSystem()
      onClear()
      return { type: 'success', message: 'Conversation cleared.' }

    // ── Model ──
    case '/model': {
      const validModels = ['deepseek-v4-pro', 'deepseek-v4-flash']
      if (!arg) {
        return { type: 'info', message: `Current model: ${loop.getModel()}. Available: ${validModels.join(', ')}` }
      }
      const model = validModels.find(m => m.includes(arg.toLowerCase()))
      if (!model) return { type: 'error', message: `Unknown model: ${arg}. Valid: ${validModels.join(', ')}` }
      loop.setModel(model)
      return { type: 'success', message: `Switched to ${model}.` }
    }

    // ── Status ──
    case '/status': {
      const msgs = loop.getClientMessages()
      const userMsgs = msgs.filter(m => m.role === 'user' && !m.toolResults?.length).length
      const assistantMsgs = msgs.filter(m => m.role === 'assistant').length
      const toolTurns = msgs.filter(m => m.role === 'user' && m.toolResults?.length).length
      const saved = sessions.list()
      const items = [
        `Model: ${loop.getModel()}`,
        `Messages: ${userMsgs} user, ${assistantMsgs} assistant, ${toolTurns} tool turns`,
        `Max turns: ${loop.maxTurns}`,
        `Current session: ${sessions.currentId || 'none'}`,
        `Saved sessions: ${saved.length}`,
      ]
      if (memory) {
        const stats = memory.getMemoryStats()
        items.push(`Memory: ${stats.working} working, ${stats.semantic} semantic, ${stats.sessions} sessions`)
      }
      return { type: 'list', message: 'Mammoth Status:', items }
    }

    // ── Sessions ──
    case '/sessions': {
      const list = sessions.list()
      if (list.length === 0) return { type: 'info', message: 'No saved sessions.' }
      return {
        type: 'list',
        message: `Saved sessions (${list.length}):`,
        items: list.slice(0, 15).map(s =>
          `${s.id} — ${s.messageCount} msgs — ${new Date(s.updatedAt).toLocaleString()} — "${s.preview?.slice(0, 60) || ''}"`
        ),
      }
    }

    // ── Resume ──
    case '/resume': {
      if (!arg) return { type: 'error', message: 'Usage: /resume <session-id>' }
      const msgs = sessions.load(arg)
      if (!msgs) return { type: 'error', message: `Session not found: ${arg}. Use /sessions to list.` }
      onResume(arg)
      return { type: 'success', message: `Resumed session: ${arg} (${msgs.length} messages).` }
    }

    // ── Cost ──
    case '/cost': {
      const msgs = loop.getClientMessages()
      let inputTokens = 0
      let outputTokens = 0
      for (const m of msgs) {
        const content = m.content || ''
        const reasoning = (m as any).reasoning || ''
        // Rough estimate: ~1.3 chars per token for code-heavy text
        const chars = content.length + reasoning.length
        if (m.role === 'user' || m.role === 'system') {
          inputTokens += Math.ceil(chars / 3.5)
        } else {
          outputTokens += Math.ceil(chars / 3.5)
        }
      }
      // DeepSeek pricing (approx): pro ~$0.55/$2.19 per 1M input/output, flash cheaper
      const model = loop.getModel()
      const isPro = model.includes('pro')
      const inPrice = isPro ? 0.55 : 0.14
      const outPrice = isPro ? 2.19 : 0.55
      const cost = (inputTokens / 1_000_000) * inPrice + (outputTokens / 1_000_000) * outPrice
      return {
        type: 'list',
        message: `Cost Estimate (${model}):`,
        items: [
          `Input tokens:  ~${inputTokens.toLocaleString()} ($${(inputTokens / 1_000_000 * inPrice).toFixed(3)})`,
          `Output tokens: ~${outputTokens.toLocaleString()} ($${(outputTokens / 1_000_000 * outPrice).toFixed(3)})`,
          `Total estimate: $${cost.toFixed(4)}`,
          `Messages: ${msgs.length}`,
        ],
      }
    }

    // ── Memory ──
    case '/memory': {
      if (!memory) return { type: 'error', message: 'Memory system not available.' }
      const stats = memory.getMemoryStats()
      return {
        type: 'list', message: 'Memory Status:',
        items: [
          `Working memory: ${stats.working} observations`,
          `Episodic memory: ${stats.episodic} summaries`,
          `Semantic memory: ${stats.semantic} facts`,
          `Procedural memory: ${stats.procedural} patterns`,
          `Sessions tracked: ${stats.sessions}`,
        ],
      }
    }

    // ── Consolidate ──
    case '/consolidate': {
      if (!memory) return { type: 'error', message: 'Memory system not available.' }
      const sid = sessions.currentId
      if (!sid) return { type: 'error', message: 'No active session.' }
      const result = memory.consolidate(sid)
      return {
        type: 'info',
        message: `Consolidation complete: ${result.episodic ? 'episodic created, ' : ''}${result.semantic.length} semantic facts, ${result.procedural.length} procedures`,
      }
    }

    // ── Compact ──
    case '/compact': {
      const msgs = loop.getClientMessages()
      const systemMsg = msgs.find(m => m.role === 'system')
      const keep = Math.min(msgs.length, arg ? parseInt(arg, 10) || 10 : 10)
      // Keep system + last N messages
      const trimmed = msgs.slice(-keep)
      loop.clearHistory()
      if (systemMsg) {
        loop.getClientMessages().push(systemMsg)
      }
      for (const m of trimmed) {
        if (m.role !== 'system') loop.getClientMessages().push(m)
      }
      return {
        type: 'success',
        message: `Compacted: ${msgs.length} → ${loop.getClientMessages().length} messages. Kept system + last ${keep}.`,
      }
    }

    // ── Doctor ──
    case '/doctor': {
      const items: string[] = []
      const provider = process.env.MAMMOTH_PROVIDER || 'deepseek'
      items.push(`Provider: ${provider}`)
      // API key check
      const keyNames: Record<string, string> = {
        deepseek: 'DEEPSEEK_API_KEY',
        openai: 'OPENAI_API_KEY',
        groq: 'GROQ_API_KEY',
        ollama: 'OLLAMA (no key)',
        openrouter: 'OPENROUTER_API_KEY',
        claude: 'ANTHROPIC_API_KEY',
      }
      const keyEnv = keyNames[provider] || 'DEEPSEEK_API_KEY'
      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ||
        process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY ||
        process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY
      items.push(apiKey
        ? `Auth: ${keyEnv} = ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
        : `Auth: ❌ ${keyEnv} not set`)
      // Model
      items.push(`Model: ${loop.getModel()}`)
      // Node/Bun runtime
      items.push(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun ' + (Bun as any).version : 'Node ' + process.version}`)
      // Platform
      items.push(`Platform: ${process.platform} ${process.arch}`)
      // CWD
      items.push(`CWD: ${process.cwd()}`)
      // DB health
      if (memory) {
        try {
          const stats = memory.getMemoryStats()
          items.push(`Database: OK (${stats.sessions} sessions, ${stats.working} working obs)`)
        } catch {
          items.push('Database: ❌ ERROR')
        }
      }
      // Session count
      const saved = sessions.list()
      items.push(`Saved sessions: ${saved.length}`)
      // Max turns
      items.push(`Max turns: ${loop.maxTurns}`)
      return { type: 'list', message: 'System Diagnostics:', items }
    }

    // ── Config ──
    case '/config': {
      const provider = process.env.MAMMOTH_PROVIDER || 'deepseek'
      const items: string[] = [
        `Provider: ${provider} (set MAMMOTH_PROVIDER to change)`,
        `Model: ${loop.getModel()}`,
        `Max turns: ${loop.maxTurns}`,
        `DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? '●●● set' : 'not set'}`,
        `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY ? '●●● set' : 'not set'}`,
        `OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '●●● set' : 'not set'}`,
        `GROQ_API_KEY: ${process.env.GROQ_API_KEY ? '●●● set' : 'not set'}`,
        `OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? '●●● set' : 'not set'}`,
        `Session ID: ${sessions.currentId || 'none'}`,
      ]
      return { type: 'list', message: 'Configuration:', items }
    }

    // ── Workflow ──
    case '/workflow': {
      if (!engine) return { type: 'error', message: 'Engine not available.' }
      const status = engine.getStatus()
      const wf = status.workflow
      return {
        type: 'list',
        message: `Workflows: ${wf.total} total — ${wf.active} active, ${wf.paused} paused, ${wf.completed} completed, ${wf.failed} failed`,
        items: (wf.activeDetails || []).map(w => `[active] ${w.type}: ${w.progress} (iter ${w.iteration}, ${w.remaining} remaining)`),
      }
    }

    // ── HUD ──
    case '/hud': {
      if (!engine) return { type: 'error', message: 'Engine not available.' }
      const ctx = engine.getHudContext()
      return { type: 'info', message: ctx }
    }

    // ── Exit ──
    case '/exit':
    case '/quit':
      process.exit(0)

    default:
      return null
  }
}
