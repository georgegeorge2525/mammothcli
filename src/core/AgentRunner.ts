// AgentRunner — in-process sub-agent execution for the Mammoth TUI.
// Spawns lightweight sub-agents that run in the same process using MammothLoop.

import { MammothLoop } from './Loop.js'
import { ProviderClient } from '../../services/providerClient.js'
import { ToolRegistry } from '../tools/ToolRegistry.js'


export interface AgentConfig {
  name: string        // 'explore', 'executor', 'code-reviewer', etc.
  task: string        // What the agent should do
  tools: string[]     // Tool names the agent can use (['Read', 'Grep', 'Glob'] for explore)
  model?: string      // 'deepseek-v4-pro' or 'deepseek-v4-flash' (default: flash for speed)
  maxTurns?: number   // Max tool-calling turns (default: 5)
}

export interface AgentResult {
  agentName: string
  task: string
  result: string
  toolCalls: number
  error?: string
}

export class AgentRunner {
  private tools: ToolRegistry
  private apiKey: string

  constructor(tools: ToolRegistry, apiKey: string) {
    this.tools = tools
    this.apiKey = apiKey
  }

  async run(agent: AgentConfig, onStatus: (status: string) => void): Promise<AgentResult> {
    const startTime = Date.now()
    let toolCalls = 0

    // Create a fresh client for this agent (different model, isolated history)
    const agentClient = new ProviderClient({
      apiKey: this.apiKey,
      model: agent.model || 'deepseek-v4-flash',
    })
    agentClient.clearMessages()

    // Build focused system prompt
    agentClient.setSystem(`You are Mammoth ${agent.name}, a specialized sub-agent.
Your task: ${agent.task}

## Available Tools
${agent.tools.map(t => {
  const def = this.tools.get(t)
  return def ? `- ${def.name}: ${def.description}` : ''
}).join('\n')}

## Rules
- You have ${agent.maxTurns || 5} turns to complete your task.
- Use tools to gather information. Be thorough.
- Return a clear, structured result.
- Do NOT ask the user for help — you are a sub-agent working autonomously.
- When done, summarize your findings concisely.`)

    let fullResult = ''
    const allowedSchemas = this.tools.getOpenAISchemas()
      .filter(s => agent.tools.includes(s.function.name))

    try {
      for (let turn = 0; turn < (agent.maxTurns || 5); turn++) {
        onStatus(`${agent.name}: turn ${turn + 1}/${agent.maxTurns || 5}`)

        // Stream agent's response
        for await (const event of agentClient.stream(allowedSchemas)) {
          if ((event.type === 'text' || event.type === 'thinking') && event.content) {
            fullResult += event.content
          }
          if (event.type === 'error') {
            throw new Error(event.error)
          }
        }

        // Check for tool calls
        const msgs = agentClient.getMessages()
        const last = msgs[msgs.length - 1]

        if (last?.role === 'assistant' && last.toolCalls?.length) {
          for (const tc of last.toolCalls) {
            onStatus(`${agent.name}: ${tc.name}`)
            const result = await this.tools.execute(tc)
            toolCalls++
            agentClient.addMessage({
              role: 'user',
              content: '',
              toolResults: [{
                id: tc.id,
                name: tc.name,
                content: result,
                isError: result.startsWith('Error'),
              }],
            })
          }
          continue
        }

        // No tool calls — agent is done
        break
      }
    } catch (err: any) {
      return {
        agentName: agent.name,
        task: agent.task,
        result: fullResult || 'No result',
        toolCalls,
        error: err.message,
      }
    } finally {
      // Clean up — reset client for next agent
      agentClient.clearMessages()
    }

    return {
      agentName: agent.name,
      task: agent.task,
      result: fullResult || 'Agent completed without output',
      toolCalls,
    }
  }
}
