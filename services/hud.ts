// src/services/mammoth/hud.ts — Heads-Up Display Provider
// Supplies real-time orchestration status for Claude Code statusline integration.
// Phase 9: Native Mammoth HUD integration.
// Ported from Mammoth engine/hud-provider.js.

import { MammothState } from './state.js'
import { WorkflowStateManager } from './workflowState.js'
import type { PersonalityMode, ContextProfile, WorkflowState } from '../types/mammoth.js'

// ── HUD Result Shape ──

interface HUDResult {
  personality: string
  context: string
  workflows: string
  quality: string
  full: string
}

// ── Internal helpers ──

function formatWorkflowLine(wf: WorkflowState): string {
  const task = wf.task.slice(0, 60)
  const iteration = wf.reinforcementCount > 0 ? ` (iter ${wf.reinforcementCount})` : ''
  return `  [${wf.type}] ${wf.id.slice(0, 12)}: ${task}${iteration}`
}

// ── Build HUD context string for display ──

function buildHUD(
  state?: MammothState,
  workflowManager?: WorkflowStateManager,
): HUDResult {
  // Resolve defaults from the singletons when available
  let personality: PersonalityMode = 'off'
  let activeContext: ContextProfile = 'dev'
  let activeCount = 0
  let pausedCount = 0
  let skillsIndexed = 0
  let qualityTotal = 0
  let qualityPlatinum = 0

  // Gather from MammothState if available
  let mState: MammothState | null = null
  try {
    mState = state ?? MammothState.getInstance()
  } catch {
    // MammothState not initialized — use defaults
  }

  if (mState) {
    personality = mState.personality
    activeContext = mState.activeContext
    skillsIndexed = mState.skillsIndexed
    qualityTotal = mState.qualitySummary.total
    qualityPlatinum = mState.qualitySummary.platinum
  }

  // Gather from WorkflowStateManager if available
  let wfManager: WorkflowStateManager | null = null
  try {
    if (workflowManager) {
      wfManager = workflowManager
    }
  } catch {
    // No workflow manager available
  }

  const activeWorkflows: WorkflowState[] = wfManager ? wfManager.getActive() : []
  const pausedWorkflows: WorkflowState[] = wfManager ? wfManager.getPaused() : []
  activeCount = activeWorkflows.length
  pausedCount = pausedWorkflows.length

  // Build sections line by line
  const personalityLines = personality !== 'off'
    ? `Personality: ${personality} | Context: ${activeContext}`
    : `Mammoth: idle (context: ${activeContext})`

  const workflowLines: string[] = []
  workflowLines.push(`Active: ${activeCount} | Paused: ${pausedCount}`)
  for (const wf of activeWorkflows) {
    workflowLines.push(formatWorkflowLine(wf))
  }
  for (const wf of pausedWorkflows) {
    workflowLines.push(`  [paused] ${wf.type}: ${wf.task.slice(0, 60)}`)
  }

  const qualityLines = qualityTotal > 0
    ? `Skills: ${qualityTotal} total | ${qualityPlatinum} Platinum | ${skillsIndexed} indexed`
    : `Skills indexed: ${skillsIndexed}`

  // Full context string (XML format, compatible with hook injection)
  const fullLines: string[] = []
  fullLines.push(`<mammoth_hud personality="${personality}" context="${activeContext}">`)
  fullLines.push(`Workflows: ${activeCount} active, ${pausedCount} paused`)
  if (activeWorkflows.length > 0) {
    for (const wf of activeWorkflows) {
      fullLines.push(`  Active: [${wf.type}] ${wf.id.slice(0, 12)}: ${wf.task.slice(0, 60)}`)
    }
  }
  if (pausedWorkflows.length > 0) {
    for (const wf of pausedWorkflows) {
      fullLines.push(`  Paused: [${wf.type}] ${wf.task.slice(0, 60)}`)
    }
  }
  fullLines.push(`Skills: ${skillsIndexed} indexed | Quality: ${qualityTotal} total, ${qualityPlatinum} Platinum`)
  fullLines.push('</mammoth_hud>')

  return {
    personality: personalityLines,
    context: `Context: ${activeContext}`,
    workflows: workflowLines.join('\n'),
    quality: qualityLines,
    full: fullLines.join('\n'),
  }
}

export { buildHUD }
export type { HUDResult }
