// mammoth/src/types/mammoth.ts — Core TypeScript types for the Mammoth orchestration system
// Phase 1: type definitions only. No runtime logic, no schemas, no imports.

// ── Mode Tiering ──

// Mode tier enum (0=DIRECT, 1=DELEGATED, 2=AUTOPILOT, 3=RALPH, 4=ULTRAWORK)
export enum ModeTier {
  DIRECT = 0,
  DELEGATED = 1,
  AUTOPILOT = 2,
  RALPH = 3,
  ULTRAWORK = 4,
}

// ── Personality ──

// Personality modes from caveman config
export type PersonalityMode = 'off' | 'lite' | 'full' | 'ultra'

// ── Workflow Types ──

// All autonomous workflow types (modes.js PERSISTENT_MODES + extras)
export type WorkflowType =
  | 'autopilot'
  | 'ralph'
  | 'ultrawork'
  | 'team'
  | 'pipeline'
  | 'swarm'
  | 'ultrapilot'
  | 'ultraqa'
  | 'research'
  | 'review'
  | 'deep-interview'
  | 'self-improve'

// Workflow lifecycle status (matches VALID_STATES in workflow-manager.js)
export type WorkflowStatus =
  | 'pending'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stale'

// ── Context Profiles ──

// Context profiles for adjusting agent behavior
export type ContextProfile =
  | 'dev'
  | 'review'
  | 'debug'
  | 'security'
  | 'research'
  | 'deploy'

// ── Quality ──

// Quality grades from settings.json gradeThresholds
export type QualityGrade = 'Platinum' | 'Gold' | 'Silver' | 'Bronze' | 'Unrated'

// Anti-patterns detected during quality linting (lint.js + settings.json)
export type AntiPattern =
  | 'OVER_CONSTRAINED'
  | 'EMPTY_DESCRIPTION'
  | 'MISSING_TRIGGER'
  | 'BLOATED_SKILL'
  | 'MISSING_EXAMPLES'
  | 'CIRCULAR_REFERENCE'
  | 'ORPHAN_REFERENCE'
  | 'DEAD_CROSS_REF'

// Review finding severity levels
export type ReviewSeverity = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW'

// ── Conductor Stages ──

// Conductor phases for orchestrating work
export type ConductorStage =
  | 'plan'
  | 'implement'
  | 'verify'
  | 'integrate'
  | 'review'
  | 'complete'

// ── Hook Profiles ──

// Hook profile presets
export type HookProfile = 'minimal' | 'standard' | 'strict'

// ── Agent Types ──

// Canonical agent roles from preset parsing
export type CanonicalAgentType =
  | 'architect'
  | 'executor'
  | 'code-reviewer'
  | 'designer'
  | 'debugger'
  | 'explore'
  | 'planner'
  | 'qa-tester'
  | 'scientist'
  | 'security-reviewer'
  | 'test-engineer'
  | 'tracer'
  | 'writer'
  | 'verifier'
  | 'analyst'
  | 'critic'
  | 'git-master'
  | 'document-specialist'
  | 'code-simplifier'

// ── Team Presets ──

export interface TeamPreset {
  name: string
  description: string
  context: ContextProfile
  parallelism: 'full' | 'sequential' | 'hybrid'
  members: number
  roles: TeamRole[]
  strategy: string
  verificationGate: string
}

export interface TeamRole {
  id: string
  name: string
  agentType: CanonicalAgentType
  model: 'sonnet' | 'opus' | 'haiku'
  reason: string
}

// ── Workflow State ──

export interface WorkflowState {
  id: string
  type: WorkflowType
  status: WorkflowStatus
  tier: ModeTier
  task: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  errorCount: number
  maxErrors: number // circuit breaker at 3
  reinforcementCount: number
  maxReinforcement: number
  sessionId: string
  checkpointTag?: string
  metadata?: Record<string, string>
}

// ── Gate State ──

// Gate state for gateguard hook tracking
export interface GateState {
  sessionFiles: Map<string, { factsPresented: boolean; editCount: number }>
  firstBashDone: boolean
  taskSummaryPresented: boolean
}

// ── Memory ──

// Memory tier classification
export type MemoryTier = 'working' | 'episodic' | 'semantic' | 'procedural'

export interface MemoryEntry {
  id: string
  tier: MemoryTier
  content: string
  tags: string[]
  createdAt: string
  lastReinforcedAt: string
  decayFactor: number
  source: string
  priority: 'normal' | 'priority'
}

// ── Quality Evaluation ──

export interface QualityEvaluation {
  skillName: string
  lintScore: number // 0-100, weight 30%
  judgeScore: number // 0-100, weight 40%
  monteCarloScore: number // 0-100, weight 30%
  combinedScore: number // weighted sum
  grade: QualityGrade
  antiPatterns: AntiPattern[]
  evaluatedAt: string
}

// ── Review ──

export interface ReviewFinding {
  id: string
  severity: ReviewSeverity
  phase: number // 1-5
  file: string
  line?: number
  description: string
  recommendation: string
}

// ── Orchestration Context ──

// Orchestration context injected into subagents
export interface OrchestrationContext {
  personality: PersonalityMode
  context: ContextProfile
  tier: ModeTier
  conductorStage: ConductorStage
  activeWorkflows: string[]
  teamConfig?: TeamPreset
}

// ── Event Payloads ──

export interface MammothSessionStartEvent {
  personality: PersonalityMode
  context: ContextProfile
  skillsIndexed: number
  workflowsResumed: string[]
  memoryEntriesLoaded: number
}

export interface MammothTeamSpawnEvent {
  preset: string
  agentCount: number
  workflowId: string
}
