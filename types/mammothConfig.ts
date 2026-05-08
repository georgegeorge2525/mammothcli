// src/types/mammothConfig.ts — Mammoth configuration type definitions
// Phase 1: type definitions and default config. No runtime logic, no schemas.

import type {
  ContextProfile,
  HookProfile,
  PersonalityMode,
  QualityGrade,
  WorkflowType,
} from './mammoth.js'

// ── Top-level Mammoth configuration ──

export interface MammothConfig {
  version: string
  personality: PersonalityConfig
  quality: QualityConfig
  progressiveDisclosure: ProgressiveDisclosureConfig
  review: ReviewPipelineConfig
  hooks: HooksConfig
  state: StateConfig
  memory: MemoryConfig
  rules: RulesConfig
  teams: TeamsConfig
  engine: EngineConfig
}

// ── Personality ──

export interface PersonalityConfig {
  defaultMode: PersonalityMode
  allowedModes: PersonalityMode[]
}

// ── Quality ──

export interface QualityConfig {
  antiPatterns: string[]
  gradeThresholds: GradeThresholds
}

export interface GradeThresholds {
  platinum: number // default 90
  gold: number // default 80
  silver: number // default 65
  bronze: number // default 50
}

// ── Progressive Disclosure ──

export interface ProgressiveDisclosureConfig {
  metadataMaxLines: number // default 50
  instructionsMaxLines: number // default 500
}

// ── Review Pipeline ──

export interface ReviewPipelineConfig {
  enabled: boolean
  phases: ReviewPhaseConfig[]
  severityLevels: SeverityLevelConfig[]
}

export interface ReviewPhaseConfig {
  phase: number
  name: string
  agents: string[]
  required: boolean
}

export interface SeverityLevelConfig {
  id: string
  label: string
  priority: number
}

// ── Hooks ──

export interface HooksConfig {
  profile: HookProfile
  events: Record<string, HookEventConfig>
}

export interface HookEventConfig {
  enabled: boolean
  priority?: number
  timeout?: number
}

// ── State ──

export interface StateConfig {
  directory: string // e.g., ".mammoth/state"
  sessionsDirectory: string // e.g., ".mammoth/state/sessions"
  maxWorkflows: number // default 50
  maxSessionLogs: number // default 100
}

// ── Memory ──

export interface MemoryConfig {
  enabled: boolean
  tokenBudget: number // default 2000
  halfLifeHours: number // default 168
  dedupWindowMs: number // default 300000
  maxEntries: number // default 10000
  tiers: MemoryTierConfig[]
}

export interface MemoryTierConfig {
  name: string
  ttlHours: number
  maxEntries: number
}

// ── Rules ──

export interface RulesConfig {
  autoDetectLanguage: boolean
  sharedRules: string[]
  languageRules: Record<string, string[]>
}

// ── Teams ──

export interface TeamsConfig {
  availablePresets: string[] // preset names
  defaultContextPresets: Record<ContextProfile, string[]>
  maxParallelAgents: number // default 8
  defaultModel: string
}

// ── Engine ──

export interface EngineConfig {
  reinforcementCaps: Partial<Record<WorkflowType, number>>
  staleThresholdMinutes: number // default 120
  circuitBreakerErrors: number // default 3
  autoResumeOnStart: boolean // default true
  checkpointOnToolUse: boolean // default true
}

// ── Default configuration (used when no user config exists) ──

export const DEFAULT_MAMMOTH_CONFIG: MammothConfig = {
  version: '1.0.0',
  personality: {
    defaultMode: 'full',
    allowedModes: ['off', 'lite', 'full', 'ultra'],
  },
  quality: {
    antiPatterns: [],
    gradeThresholds: { platinum: 90, gold: 80, silver: 65, bronze: 50 },
  },
  progressiveDisclosure: {
    metadataMaxLines: 50,
    instructionsMaxLines: 500,
  },
  review: {
    enabled: true,
    phases: [
      {
        phase: 1,
        name: 'Code Quality & Architecture',
        agents: ['code-reviewer', 'architect'],
        required: true,
      },
      {
        phase: 2,
        name: 'Security & Performance',
        agents: ['security-reviewer', 'test-engineer'],
        required: true,
      },
      {
        phase: 3,
        name: 'Testing & Documentation',
        agents: ['qa-tester', 'writer'],
        required: true,
      },
      {
        phase: 4,
        name: 'Best Practices & CI/CD',
        agents: ['code-reviewer', 'critic'],
        required: true,
      },
      {
        phase: 5,
        name: 'Consolidated Report',
        agents: ['architect', 'verifier'],
        required: true,
      },
    ],
    severityLevels: [
      { id: 'P0_CRITICAL', label: 'Critical', priority: 0 },
      { id: 'P1_HIGH', label: 'High', priority: 1 },
      { id: 'P2_MEDIUM', label: 'Medium', priority: 2 },
      { id: 'P3_LOW', label: 'Low', priority: 3 },
    ],
  },
  hooks: {
    profile: 'standard',
    events: {},
  },
  state: {
    directory: '.mammoth/state',
    sessionsDirectory: '.mammoth/state/sessions',
    maxWorkflows: 50,
    maxSessionLogs: 100,
  },
  memory: {
    enabled: true,
    tokenBudget: 2000,
    halfLifeHours: 168,
    dedupWindowMs: 300000,
    maxEntries: 10000,
    tiers: [
      { name: 'working', ttlHours: 24, maxEntries: 1000 },
      { name: 'episodic', ttlHours: 168, maxEntries: 5000 },
      { name: 'semantic', ttlHours: 720, maxEntries: 3000 },
      { name: 'procedural', ttlHours: Infinity, maxEntries: 1000 },
    ],
  },
  rules: {
    autoDetectLanguage: true,
    sharedRules: [],
    languageRules: {},
  },
  teams: {
    availablePresets: [
      'review',
      'debug',
      'feature',
      'fullstack',
      'research',
      'security',
      'santa-method',
    ],
    defaultContextPresets: {
      dev: ['feature', 'fullstack'],
      review: ['review', 'santa-method'],
      debug: ['debug'],
      security: ['security'],
      research: ['research'],
      deploy: [],
    },
    maxParallelAgents: 8,
    defaultModel: 'sonnet',
  },
  engine: {
    reinforcementCaps: {},
    staleThresholdMinutes: 120,
    circuitBreakerErrors: 3,
    autoResumeOnStart: true,
    checkpointOnToolUse: true,
  },
}

// Wire MammothConfig into the global app config
export interface MammothConfigOverride {
  enabled: boolean
  config: Partial<MammothConfig>
}