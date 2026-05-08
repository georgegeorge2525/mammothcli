// ToolRegistry — bridges the real Claude Code tools with the Mammoth TUI.
// Loads tool schemas (name, description, parameters) from the real tool files,
// but uses lightweight executors that don't require the full AppState context.

import type { DSMLToolCall } from '../../services/deepseekProtocol.js'

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<string>
}

export class ToolRegistry {
  private tools: Map<string, ToolDef> = new Map()

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  getOpenAISchemas(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return Array.from(this.tools.values()).map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  getAll(): ToolDef[] {
    return Array.from(this.tools.values())
  }

  async execute(call: DSMLToolCall): Promise<string> {
    const tool = this.tools.get(call.name)
    if (!tool) return `Unknown tool: ${call.name}`
    return tool.execute(call.arguments)
  }
}
