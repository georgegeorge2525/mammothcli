#!/usr/bin/env bun
/** Mammoth Native TUI -- clean-room open-source CLI */
import React from 'react'
import { render } from 'ink'
import { MammothApp } from './ui/App.js'
import type { MammothMessage } from './ui/App.js'
import { MammothLoop, buildSystemPrompt } from './core/Loop.js'
import { ToolRegistry } from './tools/ToolRegistry.js'
import { AgentRunner } from './core/AgentRunner.js'
import { SessionStore } from './core/SessionStore.js'
import { handleCommand } from './core/Commands.js'
import { permissions } from './tools/PermissionManager.js'
import { MCPManager } from './mcp/MCPManager.js'
import { MemoryManager } from '../memory/MemoryManager.js'
import { MammothEngine } from '../engine/MammothEngine.js'
import { execSync, exec } from 'node:child_process'
import { homedir } from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

// --- Load .env files (cwd .env, then ~/.mammoth/.env for global installs) ---
function loadEnvFile(p: string): void {
  if (!fs.existsSync(p)) return
  const lines = fs.readFileSync(p, 'utf-8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile(path.join(process.cwd(), '.env'))
loadEnvFile(path.join(homedir(), '.mammoth', '.env'))
loadEnvFile(path.join(homedir(), '.mammoth', 'env'))

// --- API Key ---
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || ''
if (!apiKey) { console.error('DEEPSEEK_API_KEY not set in .env, ~/.mammoth/.env, or environment'); process.exit(1) }

// --- Tool Registry ---
const tools = new ToolRegistry()

// --- Memory & Engine ---
const memory = new MemoryManager()
const engine = new MammothEngine({ memoryManager: memory, db: (memory as any).db })

tools.register({ name: 'Bash', description: 'Execute a shell command. Uses PowerShell on Windows.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'The shell command to execute' }, description: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] }, execute: async (args) => {
  const cwd = process.cwd()
  const cmd = String(args.command || ''); const to = Number(args.timeout || 30000)
  return new Promise(resolve => {
    exec('powershell -NoProfile -NonInteractive -Command "& { ' + cmd + '}"', { cwd, timeout: to, maxBuffer: 1024 * 1024 }, (e, out, err) => {
      const o = [out, err ? '\n[stderr]\n' + err : ''].filter(Boolean).join('')
      resolve(e && !o ? 'Exit ' + e.code + ': ' + e.message : (o || '(no output)'))
    })
  })
}})

tools.register({ name: 'Read', description: 'Read a file from the local filesystem.', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'Absolute path to the file' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['file_path'] }, execute: async (args) => {
  const fp = path.resolve(String(args.file_path || ''))
  if (!fs.existsSync(fp)) return 'File not found: ' + fp
  if (fs.statSync(fp).isDirectory()) return 'Path is a directory, not a file: ' + fp
  const lines = fs.readFileSync(fp, 'utf-8').split('\n')
  const off = Number(args.offset || 0); const lim = Number(args.limit || 200)
  return lines.slice(off, off + lim).map((l, i) => (off + i + 1) + '\t' + l).join('\n')
}})

tools.register({ name: 'Write', description: 'Write content to a file. Creates parent directories if needed.', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] }, execute: async (args) => {
  const fp = path.resolve(String(args.file_path || '')); const c = String(args.content || '')
  const d = path.dirname(fp); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(fp, c, 'utf-8'); return 'Written: ' + fp + ' (' + c.length + ' bytes)'
}})

tools.register({ name: 'Edit', description: 'Replace old_string with new_string in a file using exact string match.', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['file_path', 'old_string', 'new_string'] }, execute: async (args) => {
  const fp = path.resolve(String(args.file_path || ''))
  if (!fs.existsSync(fp)) return 'File not found: ' + fp
  let c = fs.readFileSync(fp, 'utf-8')
  const o = String(args.old_string || ''); const n = String(args.new_string || '')
  if (args.replace_all) { c = c.split(o).join(n) } else { if (!c.includes(o)) return 'String not found in file'; c = c.replace(o, n) }
  fs.writeFileSync(fp, c, 'utf-8'); return 'Edited: ' + fp
}})

tools.register({ name: 'Grep', description: 'Search for a regex pattern in files using ripgrep.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Regex pattern to search for' }, path: { type: 'string', description: 'Directory or file to search (default: cwd)' } }, required: ['pattern'] }, execute: async (args) => {
  const pat = String(args.pattern || ''); const sp = String(args.path || process.cwd())
  try { const r = execSync('rg -n "' + pat.replace(/"/g, '\\"') + '" "' + sp + '" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.py" --include="*.json"', { cwd: process.cwd(), timeout: 10000, encoding: 'utf-8' }); return r || 'No matches' } catch (e: any) { return e.status === 1 ? 'No matches' : 'Error: ' + e.message }
}})

tools.register({ name: 'Glob', description: 'Find files matching a glob pattern.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob like **/*.ts' }, path: { type: 'string', description: 'Directory to search (default: cwd)' } }, required: ['pattern'] }, execute: async (args) => {
  const pat = String(args.pattern || '**/*'); const sp = String(args.path || process.cwd())
  try { const r = execSync('find "' + sp + '" -path "' + pat + '" -type f 2>/dev/null | head -50', { cwd: process.cwd(), timeout: 5000, encoding: 'utf-8' }); return r || 'No files' } catch (e: any) { return 'Error: ' + e.message }
}})

// --- Agent Runner ---
const agents = new AgentRunner(tools, apiKey)

tools.register({ name: 'Agent', description: 'Spawn a specialized sub-agent to autonomously handle complex tasks. Types: explore (code search), executor (implementation), code-reviewer, architect, debugger, designer, writer, security-reviewer, test-engineer.', parameters: { type: 'object', properties: { subagent_type: { type: 'string', description: 'Agent type: explore, executor, code-reviewer, architect, debugger, designer, writer, security-reviewer, test-engineer' }, description: { type: 'string', description: 'Short task description (3-5 words)' }, prompt: { type: 'string', description: 'Detailed task for the agent. Be specific.' } }, required: ['description', 'prompt'] }, execute: async (args) => {
  const agentType = String(args.subagent_type || 'explore')
  const description = String(args.description || '')
  const task = String(args.prompt || '')

  const toolSets: Record<string, string[]> = {
    explore: ['Read', 'Grep', 'Glob'],
    executor: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    'code-reviewer': ['Read', 'Grep', 'Glob'],
    architect: ['Read', 'Write', 'Grep', 'Glob'],
    debugger: ['Read', 'Grep', 'Glob', 'Bash'],
    designer: ['Read', 'Write', 'Edit'],
    writer: ['Read', 'Write', 'Edit', 'Grep'],
    'security-reviewer': ['Read', 'Grep', 'Glob'],
    'test-engineer': ['Read', 'Write', 'Bash'],
  }
  const agentTools = toolSets[agentType] || ['Read', 'Grep', 'Glob']
  const model = ['explore', 'writer'].includes(agentType) ? 'deepseek-v4-flash' : 'deepseek-v4-pro'

  return new Promise(async (resolve) => {
    const result = await agents.run({
      name: agentType, task: task || description,
      tools: agentTools, model,
      maxTurns: ['explore', 'executor'].includes(agentType) ? 5 : 8,
    }, (_status) => {})
    resolve('## Agent: ' + result.agentName + '\nTask: ' + result.task + '\nTurns: ' + result.toolCalls + '\n' + (result.error ? 'Error: ' + result.error + '\n' : '') + '\n' + result.result)
  })
}})

// --- Engine ---
const loop = new MammothLoop(apiKey)
loop.setSystem(buildSystemPrompt(process.cwd()))
loop.maxTurns = 10
loop.setToolSchemas(tools.getOpenAISchemas())


// --- MCP Integration ---
const mcp = new MCPManager()
const mcpServers = mcp.loadConfig()
if (mcpServers.length > 0) {
  process.stderr.write('[Mammoth] Loaded ' + mcpServers.length + ' MCP server config(s)' + '\n')
  // Register MCP tools (they appear as mcp__servername__toolname)
  const mcpToolDefs = mcp.getToolDefs()
  for (const td of mcpToolDefs) {
    tools.register(td)
  }
  process.stderr.write('[Mammoth] Registered ' + mcpToolDefs.length + ' MCP tools' + '\n')
}

// --- Session Persistence ---
const sessions = new SessionStore()
const lastSession = sessions.getLastSession()

if (lastSession) {
  const msgs = sessions.load(lastSession)
  if (msgs && msgs.length > 0) {
    // Restore messages to client
    for (const m of msgs) {
      loop.addToHistory(m)
    }
    process.stderr.write('[Mammoth] Restored session: ' + lastSession + ' (' + msgs.length + ' msgs)' + '\n')
  }
}

// Start new session
sessions.newSession()

// Inject memory context into system prompt
try {
  const memContext = memory.getContext({ sessionId: sessions.currentId || 'unknown', projectDir: process.cwd() })
  if (memContext) {
    loop.appendToSystem(memContext)
  }
} catch (_e) { /* best-effort */ }

// Auto-save function
function autoSave() {
  const msgs = loop.getClientMessages()
  if (msgs.length > 0) sessions.save(msgs)
}

// Safe tool executor with permission checks and memory observation
async function executeToolSafe(name: string, args: Record<string, unknown>): Promise<string> {
  // Permission check
  const perm = permissions.check(name, args)
  if (!perm.allowed) {
    const msg = 'Blocked: ' + (perm.reason || 'Permission denied')
    addMemoryObs(name, args, msg)
    return msg
  }

  // Execute
  const result = await tools.execute({ id: '', name, arguments: args })

  // Observe in memory
  addMemoryObs(name, args, result)

  return result
}

function addMemoryObs(toolName: string, args: Record<string, unknown>, result: string) {
  try {
    memory.observe({
      sessionId: sessions.currentId || 'unknown',
      observation: toolName + ': ' + result.slice(0, 200),
      source: 'tool_use',
      toolName,
      toolInput: args,
      toolOutput: result,
    })
  } catch (_e) { /* memory observation is best-effort */ }
}

// --- Render ---
let thinkingBuffer = ''

const { waitUntilExit } = render(
  <MammothApp
    onSend={async (userPrompt, addMsg, setTools) => {
      thinkingBuffer = ''
      let currentText = ''

      // Observe user prompt
      try {
        memory.observe({
          sessionId: sessions.currentId || 'unknown',
          observation: userPrompt,
          source: 'user_prompt',
        })
      } catch (_e) { /* best-effort */ }

      // Check for slash commands
      const cmdResult = handleCommand(userPrompt, loop, sessions, () => {
        addMsg({ role: 'system', content: 'Conversation cleared.' })
      }, (id) => {
        const msgs = sessions.load(id)
        if (msgs) {
          for (const m of msgs) loop.addToHistory(m)
        }
      }, memory, engine)

      if (cmdResult) {
        addMsg({ role: 'system', content: cmdResult.message + (cmdResult.items ? '\n' + cmdResult.items.join('\n') : '') })
        return
      }

      const callbacks = {
        onText: (text: string) => { currentText += text },
        onThinking: (text: string) => { thinkingBuffer += text },
        onToolCall: (name: string, _args: Record<string, unknown>) => {
          autoSave();
      if (currentText) {
            addMsg({ role: 'assistant', content: currentText, thinking: thinkingBuffer || undefined })
            currentText = ''; thinkingBuffer = ''
          }
          addMsg({ role: 'tool', content: 'Running ' + name + '...' })
          setTools([name])
        },
        onToolResult: (name: string, result: string) => {
          addMsg({ role: 'tool', content: name + ': ' + result.split('\n').slice(0, 5).join('\n').slice(0, 500) })
          setTools([])
        },
        onError: (error: string) => { addMsg({ role: 'system', content: 'Error: ' + error }) },
      }

      await loop.runConversation(userPrompt, (name, args) => executeToolSafe(name, args), callbacks)

      autoSave();
      if (currentText) {
        addMsg({ role: 'assistant', content: currentText, thinking: thinkingBuffer || undefined })
      }
    }}
    onExit={() => {
      try {
        const sid = sessions.currentId
        if (sid) {
          memory.consolidate(sid)
          memory.endSession(sid)
        }
      } catch (_e) { /* best-effort */ }
      process.exit(0)
    }}
  />
)

waitUntilExit()