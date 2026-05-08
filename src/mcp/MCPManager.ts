// MCPManager — Model Context Protocol integration for the Mammoth TUI.
// Loads MCP server configs, connects via stdio, exposes tools to the registry.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { ToolDef } from '../tools/ToolRegistry.js'

export interface MCPServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}

interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export class MCPManager {
  private servers: Map<string, { config: MCPServerConfig; process?: ChildProcess; tools: MCPTool[] }> = new Map()

  /** Load MCP config from .mammoth/mcp.json */
  loadConfig(configPath?: string): MCPServerConfig[] {
    const cfgFile = configPath || path.join(process.cwd(), '.mammoth', 'mcp.json')
    try {
      if (fs.existsSync(cfgFile)) {
        const data = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'))
        const servers: MCPServerConfig[] = data.mcpServers || data.servers || []
        for (const s of servers) {
          if (s.enabled !== false) {
            this.servers.set(s.name, { config: s, tools: [] })
          }
        }
        return servers
      }
    } catch (e) {
      // Config doesn't exist or is invalid — that's OK
    }
    return []
  }

  /** Start an MCP server and discover its tools */
  async startServer(name: string): Promise<MCPTool[]> {
    const server = this.servers.get(name)
    if (!server) throw new Error(`MCP server not found: ${name}`)

    if (server.process) return server.tools // Already running

    // Spawn the server process
    const proc = spawn(server.config.command, server.config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...server.config.env },
    })

    // Simple JSON-RPC over stdio
    const tools: MCPTool[] = []
    let buffer = ''
    let requestId = 0

    const sendRequest = (method: string, params?: unknown): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const id = ++requestId
        const req = JSON.stringify({ jsonrpc: '2.0', id, method, params })
        proc.stdin!.write(req + '\n')

        const onData = (data: Buffer) => {
          buffer += data.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            try {
              const msg = JSON.parse(line)
              if (msg.id === id) {
                proc.stdout!.removeListener('data', onData)
                if (msg.error) reject(new Error(msg.error.message))
                else resolve(msg.result)
              }
            } catch { /* partial JSON, wait for more */ }
          }
        }
        proc.stdout!.on('data', onData)

        setTimeout(() => {
          proc.stdout!.removeListener('data', onData)
          reject(new Error('MCP request timeout'))
        }, 10000)
      })
    }

    try {
      // Initialize
      await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mammoth', version: '3.0.0' },
      })

      // List tools
      const result = await sendRequest('tools/list') as { tools: MCPTool[] }
      if (result.tools) {
        for (const t of result.tools) tools.push(t)
      }
    } catch (e) {
      // Server might not support initialization — that's OK
      proc.kill()
      throw e
    }

    server.process = proc
    server.tools = tools
    return tools
  }

  /** Convert MCP tools to ToolDef format for the ToolRegistry */
  getToolDefs(): ToolDef[] {
    const defs: ToolDef[] = []
    for (const [, server] of this.servers) {
      for (const tool of server.tools) {
        defs.push({
          name: `mcp__${server.config.name}__${tool.name}`,
          description: `[MCP:${server.config.name}] ${tool.description}`,
          parameters: {
            type: 'object',
            properties: tool.inputSchema.properties || {},
            required: tool.inputSchema.required || [],
          },
          execute: async (args) => {
            const proc = server.process
            if (!proc) return 'MCP server not running'
            // Call tool via MCP
            return new Promise((resolve, reject) => {
              const id = Date.now()
              const req = JSON.stringify({
                jsonrpc: '2.0', id, method: 'tools/call',
                params: { name: tool.name, arguments: args },
              })
              proc.stdin!.write(req + '\n')

              let buf = ''
              const onData = (data: Buffer) => {
                buf += data.toString()
                const lines = buf.split('\n')
                buf = lines.pop() || ''
                for (const line of lines) {
                  try {
                    const msg = JSON.parse(line)
                    if (msg.id === id) {
                      proc.stdout!.removeListener('data', onData)
                      if (msg.error) reject(new Error(msg.error.message))
                      else resolve(JSON.stringify(msg.result))
                    }
                  } catch { /* wait */ }
                }
              }
              proc.stdout!.on('data', onData)
              setTimeout(() => {
                proc.stdout!.removeListener('data', onData)
                resolve('MCP tool timeout')
              }, 30000)
            })
          },
        })
      }
    }
    return defs
  }

  /** Shut down all servers */
  shutdown(): void {
    for (const [, server] of this.servers) {
      if (server.process) {
        server.process.kill()
      }
    }
  }
}
