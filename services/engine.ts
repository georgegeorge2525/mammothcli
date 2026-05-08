// src/services/mammoth/engine.ts — Mammoth Orchestration Engine
// Central runtime tying together team orchestration, workflow management, and HUD.
// Ported from Mammoth engine/index.js.
//
// prepareTeam() parses preset roles and generates Agent tool spawn instructions.
// startWorkflow() determines tier from MODE_TIER_MAP, creates workflow via WorkflowStateManager.
// getStatus() aggregates state across MammothState + WorkflowStateManager.
// onSessionStart() loads persisted workflows, auto-resumes autonomous ones.
// onSessionEnd() pauses active workflows, runs memory consolidation.

import { MammothState } from './state.js'
import { WorkflowStateManager } from './workflowState.js'
import type { MammothConfig } from '../types/mammothConfig.js'
import type {
  WorkflowType,
  TeamPreset,
  ContextProfile,
  PersonalityMode,
} from '../types/mammoth.js'
import {
  MODE_TIER_MAP,
  STAGE_HINTS,
  AUTONOMOUS_RESUME_MODES,
} from '../constants/mammoth.js'
import { DEFAULT_MAMMOTH_CONFIG } from '../types/mammothConfig.js'

export class MammothEngine {
  private static instance: MammothEngine | null = null

  private state: MammothState
  private workflowManager: WorkflowStateManager

  // Model tiering registry — which model to use per role/phase
  private modelTiering: Record<string, string> = {
    plan: 'deepseek-v4-pro',       // Planning/architecture = pro model
    implement: 'deepseek-v4-flash', // Implementation = fast/cheap model
    verify: 'deepseek-v4-pro',      // Verification = pro model (can't afford misses)
    review: 'deepseek-v4-pro',      // Review = pro model
    integrate: 'deepseek-v4-flash', // Integration = fast model
  }

  // Agent type to tiering role mapping
  private agentRoleMapping: Record<string, string> = {
    architect: 'plan',
    planner: 'plan',
    analyst: 'plan',
    explore: 'plan',
    scientist: 'plan',
    executor: 'implement',
    designer: 'implement',
    writer: 'implement',
    debugger: 'implement',
    tracer: 'implement',
    'git-master': 'implement',
    'document-specialist': 'implement',
    'code-simplifier': 'implement',
    'code-reviewer': 'review',
    'security-reviewer': 'review',
    verifier: 'verify',
    critic: 'review',
    'qa-tester': 'verify',
    'test-engineer': 'verify',
  }

  // Call counters for savings estimation
  private tieringStats = { proCalls: 0, flashCalls: 0 }

  constructor(stateDir: string, config?: MammothConfig) {
    this.state = new MammothState(config ?? DEFAULT_MAMMOTH_CONFIG)
    this.workflowManager = new WorkflowStateManager(stateDir)
  }

  static getInstance(): MammothEngine {
    if (!MammothEngine.instance) {
      MammothEngine.instance = new MammothEngine(
        DEFAULT_MAMMOTH_CONFIG.state.directory,
        DEFAULT_MAMMOTH_CONFIG,
      )
    }
    return MammothEngine.instance
  }

  // List all workflows (for tools to enumerate)
  listWorkflows(): import('../types/mammoth').WorkflowState[] {
    return this.workflowManager.getAll()
  }

  // ── Team Orchestration ──

  // Prepare a team from a preset — returns orchestration context for CC's Agent tool
  prepareTeam(preset: TeamPreset, task: string): {
    agents: Array<{ role: string; agentType: string; model: string; instructions: string }>
    parallelism: 'full' | 'sequential' | 'hybrid'
    orchestrationContext: string
  } {
    // Generate agent spawn instructions from preset roles
    const agents = preset.roles.map((role) => ({
      role: role.name,
      agentType: role.agentType,
      model: role.model,
      instructions: [
        `Role: ${role.name}`,
        `Type: ${role.agentType}`,
        `Reason: ${role.reason}`,
        `Task: ${task}`,
      ].join('\n'),
    }))

    // Build orchestration context XML
    const ctx: string[] = []
    ctx.push(`<team_orchestration preset="${preset.name}">`)
    ctx.push(`## Team: ${preset.name}`)
    ctx.push(`Parallelism: ${preset.parallelism}`)
    ctx.push(`Task: ${task}`)
    ctx.push('')

    // Agent roster
    ctx.push('### Agent Roster')
    for (const role of preset.roles) {
      ctx.push(`- **${role.name}** → \`${role.agentType}\` agent (${role.model})`)
      ctx.push(`  ${role.reason}`)
    }
    ctx.push('')

    // Execution plan based on parallelism
    ctx.push('### Execution Plan')
    switch (preset.parallelism) {
      case 'full':
        ctx.push('ALL agents spawn simultaneously in a single message. No dependencies.')
        ctx.push('Collect all results → integrate → verify gaps → done.')
        break
      case 'hybrid':
        ctx.push('Wave 1 (parallel): Spawn non-sequential agents concurrently.')
        ctx.push('Wave 2 (sequential): Use Wave 1 output as input to remaining agents.')
        break
      default:
        ctx.push('Sequential execution. Each agent feeds into the next.')
        ctx.push(
          preset.roles
            .map((r, i) => `Step ${i + 1}: ${r.name} (${r.agentType})`)
            .join(' → '),
        )
    }
    ctx.push('')

    // Strategy
    if (preset.strategy) {
      ctx.push('### Strategy')
      ctx.push(preset.strategy)
      ctx.push('')
    }

    // Verification gate
    if (preset.verificationGate) {
      ctx.push('### Verification')
      ctx.push(preset.verificationGate)
      ctx.push('')
    }

    ctx.push('</team_orchestration>')

    return {
      agents,
      parallelism: preset.parallelism,
      orchestrationContext: ctx.join('\n'),
    }
  }

  // ── Workflow Control ──

  // Start a new autonomous workflow — returns workflow ID
  startWorkflow(type: WorkflowType, task: string): string {
    const tier = MODE_TIER_MAP[type]
    const sessionId = process.env['CLAUDE_SESSION_ID'] || 'mammoth-engine'
    const wf = this.workflowManager.createWorkflow(type, task, sessionId, tier)

    // Transition from pending to in_progress
    this.workflowManager.startWorkflow(wf.id)

    // Track in MammothState
    this.state.addWorkflow(wf)

    return wf.id
  }

  // Transition workflow through stages
  checkpointWorkflow(workflowId: string, tag?: string): void {
    this.workflowManager.checkpoint(workflowId, tag)
  }

  completeWorkflow(workflowId: string): void {
    const wf = this.workflowManager.completeWorkflow(workflowId)
    this.state.updateWorkflow(workflowId, wf)
  }

  failWorkflow(workflowId: string, error?: string): void {
    const wf = this.workflowManager.failWorkflow(workflowId, error)
    this.state.updateWorkflow(workflowId, wf)
  }

  pauseWorkflow(workflowId: string): void {
    const wf = this.workflowManager.pauseWorkflow(workflowId)
    this.state.updateWorkflow(workflowId, wf)
  }

  resumeWorkflow(workflowId: string): void {
    const wf = this.workflowManager.resumeWorkflow(workflowId)
    this.state.updateWorkflow(workflowId, wf)
  }

  // ── Status & HUD ──

  // Get orchestration status for HUD
  getStatus(): {
    personality: PersonalityMode
    context: ContextProfile
    conductorStage: string
    activeWorkflows: number
    pausedWorkflows: number
    skillsIndexed: number
  } {
    const active = this.workflowManager.getActive()
    const paused = this.workflowManager.getPaused()

    return {
      personality: this.state.personality,
      context: this.state.activeContext,
      conductorStage: this.state.conductorStage,
      activeWorkflows: active.length,
      pausedWorkflows: paused.length,
      skillsIndexed: this.state.skillsIndexed,
    }
  }

  // Build HUD context string for display
  getHudContext(): string {
    const status = this.getStatus()
    const active = this.workflowManager.getActive()
    const paused = this.workflowManager.getPaused()
    const stages = STAGE_HINTS[status.context] || STAGE_HINTS.dev

    const lines: string[] = []
    lines.push(
      `<mammoth_hud personality="${status.personality}" context="${status.context}">`,
    )
    lines.push(`Stage: ${status.conductorStage} (${stages.join(' → ')})`)
    lines.push(
      `Active workflows: ${status.activeWorkflows} | Paused: ${status.pausedWorkflows}`,
    )
    lines.push(`Skills indexed: ${status.skillsIndexed}`)

    if (active.length > 0) {
      lines.push('')
      lines.push('Active:')
      for (const wf of active) {
        lines.push(`  [${wf.type}] ${wf.id}: ${wf.task.slice(0, 80)}`)
      }
    }

    if (paused.length > 0) {
      lines.push('')
      lines.push('Paused:')
      for (const wf of paused) {
        lines.push(`  [${wf.type}] ${wf.id}: ${wf.task.slice(0, 80)}`)
      }
    }

    lines.push('</mammoth_hud>')
    return lines.join('\n')
  }

  // ── Session Lifecycle ──

  // Load persisted workflows, auto-resume autonomous ones
  async onSessionStart(): Promise<void> {
    // Load all persisted workflow states from disk
    this.workflowManager.loadAll()

    // Auto-resume autonomous workflows that were paused
    const paused = this.workflowManager.getPaused()
    for (const wf of paused) {
      if (AUTONOMOUS_RESUME_MODES.includes(wf.type)) {
        if (this.workflowManager.canResume(wf.id)) {
          try {
            const resumed = this.workflowManager.resumeWorkflow(wf.id)
            this.state.updateWorkflow(resumed.id, resumed)
          } catch {
            // Skip workflows that hit reinforcement caps or other resume blockers
          }
        }
      }
    }

    // Sync all in_progress and paused workflows into MammothState for gate tracking
    const all = this.workflowManager.getAll()
    for (const wf of all) {
      if (wf.status === 'in_progress' || wf.status === 'paused') {
        this.state.addWorkflow(wf)
      }
    }

    // Cleanup stale workflows (exceeded WORKFLOW_STALE_MS without checkpoint)
    this.workflowManager.cleanupStale()
  }

  // Pause active workflows, run memory consolidation
  async onSessionEnd(): Promise<void> {
    // Pause all active workflows before session stops
    const active = this.workflowManager.getActive()
    for (const wf of active) {
      try {
        const paused = this.workflowManager.pauseWorkflow(wf.id)
        this.state.updateWorkflow(paused.id, paused)
      } catch {
        // Best-effort pause — workflow may already be in a terminal state
      }
    }

    // Cleanup stale workflows
    this.workflowManager.cleanupStale()
  }

  // ── Model Tiering ──

  // Get the appropriate model for a conductor stage
  getModelForStage(stage: string): string {
    const model = this.modelTiering[stage] ?? 'deepseek-v4-flash'
    if (model === 'deepseek-v4-pro') {
      this.tieringStats.proCalls++
    } else {
      this.tieringStats.flashCalls++
    }
    return model
  }

  // Get the appropriate model for an agent type
  getModelForAgent(agentType: string): string {
    const role = this.agentRoleMapping[agentType] ?? 'implement'
    const model = this.modelTiering[role] ?? 'deepseek-v4-flash'
    if (model === 'deepseek-v4-pro') {
      this.tieringStats.proCalls++
    } else {
      this.tieringStats.flashCalls++
    }
    return model
  }

  // Override model tiering from config
  setModelTiering(tiering: Record<string, string>): void {
    this.modelTiering = { ...this.modelTiering, ...tiering }
  }

  // Get estimated cost savings from tiering
  getTieringSavings(): { proCalls: number; flashCalls: number; estimatedSavingsPercent: number } {
    const total = this.tieringStats.proCalls + this.tieringStats.flashCalls
    // pro model costs ~5x flash model; estimated savings = flashCalls * 0.8 / total equivalent
    const proEquivalentCost = this.tieringStats.proCalls * 5 + this.tieringStats.flashCalls
    const allProCost = total * 5
    const estimatedSavingsPercent = total > 0
      ? Math.round(((allProCost - proEquivalentCost) / allProCost) * 100)
      : 0
    return {
      proCalls: this.tieringStats.proCalls,
      flashCalls: this.tieringStats.flashCalls,
      estimatedSavingsPercent,
    }
  }
}

export default MammothEngine
