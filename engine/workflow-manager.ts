import crypto from 'node:crypto';
import { Database } from 'bun:sqlite';
import { REINFORCEMENT_CAPS } from '../contexts/modes.js';
import type { WorkflowState, WorkflowStatus, WorkflowType, WorkflowError } from './types.js';

export const VALID_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['paused', 'completed', 'failed', 'stale'],
  paused: ['in_progress', 'completed', 'stale'],
  completed: [],
  failed: ['in_progress'],
  stale: ['in_progress'],
};

let _db: Database | null = null;

export function setDatabase(db: Database): void {
  _db = db;
}

function db(): Database {
  if (!_db) throw new Error('WorkflowManager: database not set. Call setDatabase() first.');
  return _db;
}

function ensureTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      task TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
    CREATE INDEX IF NOT EXISTS idx_workflows_type ON workflows(type);
  `);
}

export function createWorkflow(type: WorkflowType, task: string, options: Partial<WorkflowState> = {}): WorkflowState {
  ensureTable();
  const id = `${type}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const sessionId = options.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const projectDir = options.projectDir || process.cwd();

  const state: WorkflowState = {
    id,
    type,
    mode: type,
    status: 'in_progress',
    iteration: 1,
    maxIterations: options.maxIterations || REINFORCEMENT_CAPS[type] || 30,
    task: String(task || '').slice(0, 500),
    progress: 'starting',
    remaining: options.remaining || [],
    completed: [],
    errors: [],
    startedAt: new Date().toISOString(),
    lastIterationAt: new Date().toISOString(),
    pausedAt: null,
    completedAt: null,
    sessionId,
    projectDir,
    reinforcementCount: 0,
    verificationGate: ['ralph', 'ultrawork', 'pipeline'].includes(type),
    checkpointCount: 0,
    metadata: options.metadata || {},
  };

  db().prepare(`
    INSERT OR REPLACE INTO workflows (id, type, status, task, state_json, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(id, type, 'in_progress', state.task, JSON.stringify(state));

  return state;
}

export function saveWorkflow(state: WorkflowState): WorkflowState {
  ensureTable();
  db().prepare(`
    INSERT OR REPLACE INTO workflows (id, type, status, task, state_json, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(state.id, state.type, state.status, state.task, JSON.stringify(state));
  return state;
}

export function loadWorkflow(id: string): WorkflowState | null {
  ensureTable();
  const row = db().prepare('SELECT state_json FROM workflows WHERE id = ?').get(id) as { state_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.state_json) as WorkflowState;
  } catch (_e) {
    return null;
  }
}

export function transitionWorkflow(id: string, newStatus: WorkflowStatus): WorkflowState | { error: string } {
  const state = loadWorkflow(id);
  if (!state) return { error: `Workflow ${id} not found` };

  if (!VALID_TRANSITIONS[state.status]?.includes(newStatus)) {
    return { error: `Invalid transition: ${state.status} → ${newStatus}` };
  }

  state.status = newStatus;
  state.lastIterationAt = new Date().toISOString();

  switch (newStatus) {
    case 'paused':
      state.pausedAt = new Date().toISOString();
      state.reinforcementCount = 0;
      break;
    case 'completed':
      state.completedAt = new Date().toISOString();
      break;
    case 'in_progress':
      state.reinforcementCount = (state.reinforcementCount || 0) + 1;
      break;
  }

  saveWorkflow(state);
  return state;
}

export function checkpoint(id: string, progress: string, remaining?: string[]): WorkflowState | null {
  const state = loadWorkflow(id);
  if (!state) return null;

  state.progress = progress;
  state.remaining = remaining || state.remaining;
  state.lastIterationAt = new Date().toISOString();
  state.checkpointCount = (state.checkpointCount || 0) + 1;
  state.iteration = (state.iteration || 0) + 1;

  saveWorkflow(state);
  return state;
}

export function recordError(id: string, error: string): WorkflowState | null {
  const state = loadWorkflow(id);
  if (!state) return null;

  state.errors.push({
    timestamp: new Date().toISOString(),
    error: String(error).slice(0, 500),
    iteration: state.iteration,
  });
  state.lastIterationAt = new Date().toISOString();

  // Circuit breaker: 3 consecutive errors → escalate
  const recentErrors = state.errors.slice(-3);
  const allRecent = recentErrors.length === 3 && recentErrors.every(e =>
    e.iteration >= state.iteration - 2
  );

  if (allRecent) {
    state.status = 'failed';
  }

  saveWorkflow(state);
  return state;
}

export function recordCompletion(id: string, subtask: string): WorkflowState | null {
  const state = loadWorkflow(id);
  if (!state) return null;

  state.completed.push(subtask);
  state.remaining = (state.remaining || []).filter(s => s !== subtask);

  if (state.remaining.length === 0) {
    state.status = 'completed';
    state.completedAt = new Date().toISOString();
  }

  state.lastIterationAt = new Date().toISOString();
  saveWorkflow(state);
  return state;
}

export function listActive(): WorkflowState[] {
  ensureTable();
  const rows = db().prepare(
    `SELECT state_json FROM workflows WHERE status = 'in_progress'`
  ).all() as Array<{ state_json: string }>;
  return rows.map(r => JSON.parse(r.state_json) as WorkflowState);
}

export function listPaused(): WorkflowState[] {
  ensureTable();
  const rows = db().prepare(
    `SELECT state_json FROM workflows WHERE status = 'paused'`
  ).all() as Array<{ state_json: string }>;
  return rows.map(r => JSON.parse(r.state_json) as WorkflowState);
}

export function listAll(): WorkflowState[] {
  ensureTable();
  const rows = db().prepare(
    `SELECT state_json FROM workflows ORDER BY updated_at DESC`
  ).all() as Array<{ state_json: string }>;
  return rows
    .map(r => { try { return JSON.parse(r.state_json) as WorkflowState; } catch (_e) { return null; } })
    .filter(Boolean) as WorkflowState[];
}

export function cleanupStale(maxAgeMs: number = 2 * 60 * 60 * 1000): number {
  const workflows = listAll();
  let cleaned = 0;

  for (const wf of workflows) {
    if (wf.status === 'completed' || wf.status === 'stale') continue;

    const lastUpdate = new Date(wf.lastIterationAt || wf.startedAt).getTime();
    if (Date.now() - lastUpdate > maxAgeMs) {
      wf.status = 'stale';
      saveWorkflow(wf);
      cleaned++;
    }
  }

  return cleaned;
}