// SessionStore — conversation persistence for the Mammoth TUI.
// Saves/loads message history to .mammoth/sessions/ as JSON.

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DSMLMessage } from './services/deepseekProtocol.js'

export interface SessionMeta {
  id: string
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string  // First user message as preview
}

export class SessionStore {
  private dir: string
  currentId: string | null = null

  constructor(baseDir?: string) {
    this.dir = baseDir || path.join(process.cwd(), '.mammoth', 'sessions')
    fs.mkdirSync(this.dir, { recursive: true })
  }

  /** Start a new session, returns session ID */
  newSession(firstMessage?: string): string {
    this.currentId = `session-${Date.now().toString(36)}`
    const meta: SessionMeta = {
      id: this.currentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      preview: firstMessage?.slice(0, 100) || '',
    }
    this.saveMeta(meta)
    return this.currentId
  }

  /** Save current session messages */
  save(messages: DSMLMessage[]): void {
    if (!this.currentId) return
    const file = path.join(this.dir, `${this.currentId}.json`)
    fs.writeFileSync(file, JSON.stringify({
      id: this.currentId,
      savedAt: new Date().toISOString(),
      messages,
    }, null, 2))

    // Update meta
    const meta = this.loadMeta(this.currentId)
    if (meta) {
      meta.updatedAt = new Date().toISOString()
      meta.messageCount = messages.length
      this.saveMeta(meta)
    }
  }

  /** Load a session by ID */
  load(sessionId: string): DSMLMessage[] | null {
    const file = path.join(this.dir, `${sessionId}.json`)
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
        this.currentId = sessionId
        return data.messages || []
      }
    } catch { /* corrupt file, ignore */ }
    return null
  }

  /** List all saved sessions */
  list(): SessionMeta[] {
    const sessions: SessionMeta[] = []
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (f.endsWith('.meta.json')) {
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8'))
            sessions.push(meta)
          } catch { /* skip corrupt */ }
        }
      }
    } catch { /* dir might not exist */ }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** Get the last session */
  getLastSession(): string | null {
    const sessions = this.list()
    return sessions.length > 0 ? sessions[0].id : null
  }

  private saveMeta(meta: SessionMeta): void {
    const file = path.join(this.dir, `${meta.id}.meta.json`)
    fs.writeFileSync(file, JSON.stringify(meta, null, 2))
  }

  private loadMeta(id: string): SessionMeta | null {
    try {
      const file = path.join(this.dir, `${id}.meta.json`)
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf-8'))
      }
    } catch { /* ignore */ }
    return null
  }
}
