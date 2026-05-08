// Mammoth Engine — Type definitions for workflow, team, and HUD systems

export type WorkflowStatus = 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'stale';

export type WorkflowType =
  | 'autopilot' | 'ralph' | 'ultrawork' | 'team' | 'pipeline'
  | 'swarm' | 'ultraqa' | 'research' | 'review' | 'self-improve'
  | 'deep-interview' | 'manual';

export type ParallelismMode = 'sequential' | 'parallel' | 'hybrid' | 'full';

export interface WorkflowError {
  timestamp: string;
  error: string;
  iteration: number;
}

export interface WorkflowState {
  id: string;
  type: WorkflowType;
  mode: WorkflowType;
  status: WorkflowStatus;
  iteration: number;
  maxIterations: number;
  task: string;
  progress: string;
  remaining: string[];
  completed: string[];
  errors: WorkflowError[];
  startedAt: string;
  lastIterationAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  sessionId: string;
  projectDir: string;
  reinforcementCount: number;
  verificationGate: boolean;
  checkpointCount: number;
  metadata: Record<string, unknown>;
}

export interface WorkflowTransitionMap {
  pending: ['in_progress'];
  in_progress: ['paused', 'completed', 'failed', 'stale'];
  paused: ['in_progress', 'completed', 'stale'];
  completed: [];
  failed: ['in_progress'];
  stale: ['in_progress'];
}

export interface AgentSpec {
  role: string;
  type: string;
  description: string;
  parallelism?: string;
  instanceIndex?: number;
  model?: string;
  hypothesis?: string;
}

export interface TeamPreset {
  name: string;
  agents: AgentSpec[];
  strategy: string;
  verification: string;
  parallelism: ParallelismMode;
}

export interface AgentSpawnInstruction {
  description: string;
  prompt: string;
  subagentType: string;
  model: string;
  runInBackground: boolean;
}

export interface TeamResult {
  total: number;
  succeeded: number;
  failed: number;
  findings: string[];
  gaps: string[];
  integrationNeeded: string[];
}

export interface TeamOrchestration {
  preset: TeamPreset;
  context: string;
  workflowId: string;
  agents: AgentSpec[];
  parallelism: ParallelismMode;
}

export interface MammothStatus {
  version: string;
  profile: string;
  uptime: number;
}

export interface PersonalityStatus {
  mode: string;
  updatedAt?: string;
}

export interface WorkflowStatusSummary {
  active: number;
  paused: number;
  completed: number;
  failed: number;
  total: number;
  activeDetails?: Array<{
    id: string;
    type: string;
    progress: string;
    iteration: number;
    remaining: number;
  }>;
}

export interface MemoryStatusData {
  available: boolean;
  working?: number;
  episodic?: number;
  semantic?: number;
  procedural?: number;
  sessions?: number;
  error?: string;
}

export interface QualityStatusData {
  available: boolean;
  total?: number;
  platinum?: number;
  gold?: number;
  average?: number;
}

export interface SessionStatus {
  sessionId: string;
  projectDir: string;
  projectName: string;
}

export interface EngineStatus {
  mammoth: MammothStatus;
  personality: PersonalityStatus;
  workflow: WorkflowStatusSummary;
  memory: MemoryStatusData;
  quality: QualityStatusData;
  session: SessionStatus;
  timestamp: string;
}
