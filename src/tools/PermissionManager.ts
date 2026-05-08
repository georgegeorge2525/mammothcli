// PermissionManager — tool safety classification and approval gates

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

export interface ToolPermission {
  allowed: boolean
  reason?: string
  requiresApproval: boolean
  isDestructive: boolean
}

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf/i, /rm\s+-r\s+\//i, /del\s+\/f/i,
  /format\s/i, /diskpart/i, /fdisk/i,
  /sudo\s/i, /su\s+-/i,
  />\s*\/dev\//i, /mkfs/i, /dd\s+if=/i,
  /git\s+push\s+--force/i, /git\s+reset\s+--hard/i,
  /DROP\s+TABLE/i, /DELETE\s+FROM/i,
  /shutdown/i, /reboot/i, /restart-computer/i,
  /Set-ExecutionPolicy/i, /Remove-Item.*-Recurse.*-Force/i,
]

export class PermissionManager {
  mode: PermissionMode = 'default'

  setMode(mode: PermissionMode): void {
    this.mode = mode
  }

  /** Check if a tool call can proceed */
  check(toolName: string, args: Record<string, unknown>): ToolPermission {
    // Plan mode: all write tools require approval
    if (this.mode === 'plan') {
      const isRead = ['Read', 'Grep', 'Glob'].includes(toolName)
      return { allowed: isRead, reason: isRead ? undefined : 'Plan mode — write tools blocked.', requiresApproval: false, isDestructive: !isRead }
    }

    // Bypass: everything allowed
    if (this.mode === 'bypassPermissions') {
      return { allowed: true, requiresApproval: false, isDestructive: false }
    }

    // Read-only tools: always allowed, no prompt
    if (['Read', 'Grep', 'Glob'].includes(toolName)) {
      return { allowed: true, requiresApproval: false, isDestructive: false }
    }

    // Agent tool: always allowed
    if (toolName === 'Agent') {
      return { allowed: true, requiresApproval: false, isDestructive: false }
    }

    // Write tool: check if destructive
    if (['Write', 'Edit'].includes(toolName)) {
      // acceptEdits mode: auto-approve edits
      if (this.mode === 'acceptEdits') {
        return { allowed: true, requiresApproval: false, isDestructive: false }
      }
      return { allowed: true, requiresApproval: true, isDestructive: false,
        reason: `Allow write to ${String(args.file_path || 'file')}?` }
    }

    // Bash: check for dangerous patterns
    if (toolName === 'Bash') {
      const cmd = String(args.command || '')
      for (const pattern of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(cmd)) {
          return { allowed: false, requiresApproval: false, isDestructive: true,
            reason: `BLOCKED: dangerous command pattern detected in: ${cmd.slice(0, 80)}` }
        }
      }
      return { allowed: true, requiresApproval: true, isDestructive: false,
        reason: `Allow: ${cmd.slice(0, 80)}` }
    }

    return { allowed: true, requiresApproval: false, isDestructive: false }
  }
}

export const permissions = new PermissionManager()
