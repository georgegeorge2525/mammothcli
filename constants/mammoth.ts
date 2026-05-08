// mammoth/src/constants/mammoth.ts — Core Mammoth orchestration constants
// Ported from Mammoth hooks/lib/modes.js, profile.js, and engine/workflow-manager.js
// Phase 1: constants only. All runtime logic lives in the Mammoth engine.

import type { ModeTier, PersonalityMode, WorkflowType, ContextProfile, HookProfile } from '../types/mammoth'

// All persistent autonomous workflow types (survive session stop/restart)
export const PERSISTENT_MODES: readonly WorkflowType[] = [
  'autopilot', 'ralph', 'ultrawork', 'team', 'pipeline',
  'swarm', 'ultrapilot', 'ultraqa', 'research', 'review',
  'deep-interview', 'self-improve'
]

// Workflows that auto-resume on session start
export const AUTONOMOUS_RESUME_MODES: readonly WorkflowType[] = [
  'autopilot', 'ralph', 'ultrawork', 'ultrapilot', 'ultraqa', 'self-improve'
]

// Maximum times a workflow can be resumed (prevents infinite loops)
export const REINFORCEMENT_CAPS: Record<WorkflowType, number> = {
  autopilot: 50,
  ralph: 100,
  ultrawork: 50,
  team: 30,
  pipeline: 20,
  swarm: 30,
  ultrapilot: 80,
  ultraqa: 100,
  research: 10,
  review: 10,
  'deep-interview': 10,
  'self-improve': 50,
}

// Mode tier mapping
export const MODE_TIER_MAP: Record<WorkflowType, ModeTier> = {
  // Tier 1 — DELEGATED
  review: 1,
  research: 1,
  'deep-interview': 1,
  // Tier 2 — AUTOPILOT
  autopilot: 2,
  team: 2,
  pipeline: 2,
  // Tier 3 — RALPH
  ralph: 3,
  ultraqa: 3,
  'self-improve': 3,
  // Tier 4 — ULTRAWORK
  ultrawork: 4,
  swarm: 4,
  ultrapilot: 4,
}

// Human-readable tier descriptions
export const TIER_DESCRIPTIONS: Record<ModeTier, string> = {
  0: 'DIRECT — Single file, obvious fix, known pattern. Do it yourself.',
  1: 'DELEGATED — 2-5 files, clear boundaries, predictable. Spawn executor.',
  2: 'AUTOPILOT — Multi-step, some unknowns, safe to proceed. Loop until done.',
  3: 'RALPH — Quality-critical. Must pass verification gate. Circuit breaker at 3 failures.',
  4: 'ULTRAWORK — 3+ independent sub-tasks, high parallelism. Spawn all, integrate.',
}

// Conductor stage hints per context
export const STAGE_HINTS: Record<ContextProfile, string[]> = {
  dev: ['plan', 'implement', 'verify', 'integrate', 'complete'],
  review: ['plan', 'review', 'verify', 'complete'],
  debug: ['investigate', 'hypothesize', 'verify', 'complete'],
  security: ['audit', 'analyze', 'remediate', 'verify', 'complete'],
  research: ['explore', 'analyze', 'synthesize', 'complete'],
  deploy: ['validate', 'stage', 'deploy', 'verify', 'complete'],
}

// Quality grade thresholds
export const QUALITY_THRESHOLDS: Record<string, number> = {
  Platinum: 90,
  Gold: 80,
  Silver: 65,
  Bronze: 50,
}

// Quality layer weights (must sum to 1.0)
export const QUALITY_WEIGHTS = {
  lint: 0.30,
  judge: 0.40,
  monteCarlo: 0.30,
} as const

// Elo ranking constants
export const ELO_DEFAULTS = {
  K_FACTOR: 32,
  BASELINE: 1500,
  BOOTSTRAP_SAMPLES: 500,
} as const

// Memory tier descriptions and TTLs
export const MEMORY_TIERS = {
  working: { description: 'Current session observations', ttlHours: 24 },
  episodic: { description: 'Task-specific experiences', ttlHours: 168 },
  semantic: { description: 'Generalized knowledge', ttlHours: 720 },
  procedural: { description: 'Workflow patterns and rules', ttlHours: Infinity },
} as const

// Default memory parameters
export const MEMORY_DEFAULTS = {
  TOKEN_BUDGET: 2000,
  HALF_LIFE_HOURS: 168,
  DEDUP_WINDOW_MS: 300000,
} as const

// Hook profile categories (which hooks run under which profile)
export const HOOK_PROFILE_CATEGORIES: Record<HookProfile, string[]> = {
  minimal: ['session-start', 'prompt-submit', 'stop'],
  standard: ['session-start', 'prompt-submit', 'pre-tool-use', 'post-tool-use',
             'subagent-lifecycle', 'stop', 'pre-compact', 'config-protection'],
  strict: ['session-start', 'prompt-submit', 'pre-tool-use', 'post-tool-use',
           'subagent-lifecycle', 'stop', 'pre-compact', 'config-protection',
           'gateguard', 'governance-capture', 'instructions-loaded'],
}

// Allowed paths for direct edits (bypass delegation enforcement)
export const DIRECT_EDIT_PATHS = [
  '.claude/**',
  '.mammoth/state/**',
  'MAMMOTH.md',
  'AGENTS.md',
  '.mammoth/**',
]

// Protected config file patterns (config-protection hook)
export const PROTECTED_CONFIG_PATTERNS = [
  '.eslintrc*',
  'tsconfig*.json',
  '.prettierrc*',
  '.editorconfig',
  'biome.json',
  '.golangci*',
]

// Source file extensions gated by delegation enforcement
export const SOURCE_FILE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.kt', '.swift', '.c', '.cpp', '.h', '.rb', '.php', '.cs',
  '.sql', '.sh', '.bash', '.ps1', '.yaml', '.yml', '.tf',
]

// Workflow stale threshold (2 hours in ms)
export const WORKFLOW_STALE_MS = 2 * 60 * 60 * 1000

// Circuit breaker: max consecutive errors before auto-failure
export const CIRCUIT_BREAKER_MAX_ERRORS = 3

// Review pipeline phases
export const REVIEW_PIPELINE_PHASES = [
  { phase: 1, name: 'Code Quality & Architecture', agents: ['code-reviewer', 'architect'] },
  { phase: 2, name: 'Security & Performance', agents: ['security-reviewer', 'test-engineer'] },
  { phase: 3, name: 'Testing & Documentation', agents: ['qa-tester', 'writer'] },
  { phase: 4, name: 'Best Practices & CI/CD', agents: ['code-reviewer', 'critic'] },
  { phase: 5, name: 'Consolidated Report', agents: ['architect', 'verifier'] },
] as const
