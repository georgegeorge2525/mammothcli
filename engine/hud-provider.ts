import type { EngineStatus, MammothStatus, PersonalityStatus, WorkflowStatusSummary, MemoryStatusData, QualityStatusData, SessionStatus } from './types.js';
import { listActive, listPaused, listAll } from './workflow-manager.js';

export function getWorkflowStatus(): WorkflowStatusSummary {
  const active = listActive();
  const paused = listPaused();
  const all = listAll();
  const completed = all.filter(w => w.status === 'completed');
  const failed = all.filter(w => w.status === 'failed');

  return {
    active: active.length,
    paused: paused.length,
    completed: completed.length,
    failed: failed.length,
    total: all.length,
    activeDetails: active.map(w => ({
      id: w.id,
      type: w.type,
      progress: w.progress,
      iteration: w.iteration,
      remaining: w.remaining.length,
    })),
  };
}

export function getMammothStatus(): MammothStatus {
  return {
    version: '3.0.0',
    profile: process.env.MAMMOTH_HOOK_PROFILE || 'standard',
    uptime: process.uptime(),
  };
}

export function getPersonalityStatus(): PersonalityStatus {
  return {
    mode: 'full',
  };
}

export function getMemoryStatus(memoryStats?: { working: number; episodic: number; semantic: number; procedural: number; sessions: number }): MemoryStatusData {
  if (!memoryStats) return { available: false };
  return {
    available: true,
    working: memoryStats.working,
    episodic: memoryStats.episodic,
    semantic: memoryStats.semantic,
    procedural: memoryStats.procedural,
    sessions: memoryStats.sessions,
  };
}

export function getQualityStatus(): QualityStatusData {
  return { available: false };
}

export function getSessionStatus(sessionId?: string, projectDir?: string): SessionStatus {
  return {
    sessionId: sessionId || process.env.CLAUDE_SESSION_ID || 'unknown',
    projectDir: projectDir || process.cwd(),
    projectName: (projectDir || process.cwd()).split(/[/\\]/).pop() || 'unknown',
  };
}

export function formatStatusline(status: EngineStatus): string {
  const parts = ['[MAMMOTH]'];

  if (status.workflow.active > 0) {
    parts.push(`${status.workflow.active}w`);
  }
  if (status.memory.available && status.memory.semantic) {
    parts.push(`${status.memory.semantic}f`);
  }
  if (status.quality.available && status.quality.platinum) {
    parts.push(`${status.quality.platinum}P`);
  }

  return parts.join(' ');
}

export function generateHudContext(memoryStats?: { working: number; episodic: number; semantic: number; procedural: number; sessions: number }): string {
  const wfStatus = getWorkflowStatus();
  const memStatus = getMemoryStatus(memoryStats);
  const session = getSessionStatus();

  const lines = ['<mammoth_hud>'];

  if (wfStatus.active > 0) {
    lines.push('# Active Workflows');
    for (const w of wfStatus.activeDetails || []) {
      lines.push(`- ${w.type}: ${w.progress} (iter ${w.iteration}, ${w.remaining} remaining)`);
    }
  }

  if (wfStatus.paused > 0) {
    lines.push(`# Paused: ${wfStatus.paused} workflows`);
  }

  if (memStatus.available) {
    lines.push(`# Memory: ${memStatus.semantic || 0} facts, ${memStatus.working || 0} observations`);
  }

  lines.push(`# Session: ${session.sessionId}`);
  lines.push('</mammoth_hud>');

  return lines.join('\n');
}