import type { WorkflowState, WorkflowStatus, WorkflowType } from './types.js';

export const REQUIRED_FIELDS = ['id', 'type', 'status'] as const;

export const VALID_STATUSES: WorkflowStatus[] = [
  'pending', 'in_progress', 'paused', 'completed', 'failed', 'stale'
];

export const VALID_TYPES: WorkflowType[] = [
  'autopilot', 'ralph', 'ultrawork', 'team', 'pipeline',
  'swarm', 'ultraqa', 'research', 'review', 'self-improve', 'deep-interview'
];

export function validateWorkflow(data: unknown, _filePath?: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Not a valid object'] };
  }

  const obj = data as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) errors.push(`Missing required field: ${field}`);
  }
  if (obj.status && !VALID_STATUSES.includes(obj.status as WorkflowStatus)) {
    errors.push(`Invalid status: ${obj.status}`);
  }
  if (obj.type && !VALID_TYPES.includes(obj.type as WorkflowType)) {
    errors.push(`Invalid type: ${obj.type}`);
  }
  return { valid: errors.length === 0, errors };
}

export function repairWorkflow(data: Record<string, unknown>): Record<string, unknown> {
  if (!data.reinforcementCount && data.reinforcementCount !== 0) data.reinforcementCount = 0;
  if (!data.lastIterationAt) data.lastIterationAt = data.startedAt || new Date().toISOString();
  if (!data.sessionId) data.sessionId = 'unknown';
  if (!data.projectDir) data.projectDir = process.cwd();
  return data;
}