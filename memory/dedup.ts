import crypto from 'node:crypto';
import { Database } from 'bun:sqlite';

export const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function hash(observation: string, toolName: string, toolInput: unknown): string {
  const payload = [
    String(observation || '').trim().slice(0, 2000),
    String(toolName || ''),
    JSON.stringify(toolInput || {})
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function isDuplicate(db: Database, hashValue: string): boolean {
  const row = db.prepare(
    `SELECT id FROM working_memory
     WHERE hash = ?
       AND created_at > datetime('now', '-' || ? || ' seconds')
     LIMIT 1`
  ).get(hashValue, Math.ceil(DEDUP_WINDOW_MS / 1000));
  return !!row;
}

export function shouldDedup(source: string): boolean {
  return source === 'tool_use' || source === 'agent_output';
}
