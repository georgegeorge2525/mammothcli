// mammoth/src/services/mammoth/workflowState.ts — Workflow State Machine
// Ported from Mammoth engine/workflow-manager.js.
// State transitions: pending -> in_progress -> {completed, failed, paused, stale}
// paused -> in_progress (resume); failed -> in_progress (retry, if under circuit breaker)

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"

import type { WorkflowState, WorkflowType, WorkflowStatus, ModeTier } from "../types/mammoth.js"
import { PERSISTENT_MODES, AUTONOMOUS_RESUME_MODES, REINFORCEMENT_CAPS,
         MODE_TIER_MAP, CIRCUIT_BREAKER_MAX_ERRORS, WORKFLOW_STALE_MS } from "../constants/mammoth.js"

const VALID_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  pending: ["in_progress"],
  in_progress: ["paused", "completed", "failed", "stale"],
  paused: ["in_progress", "completed", "stale"],
  completed: [],
  failed: ["in_progress"], // retry, if under circuit breaker
  stale: ["in_progress"],  // can resume
}

export class WorkflowStateManager {
  private workflows: Map<string, WorkflowState>
  private stateDir: string

  constructor(stateDir: string) {
    this.workflows = new Map()
    this.stateDir = stateDir
  }

  // Create a new workflow in "pending" state
  createWorkflow(type: WorkflowType, task: string, sessionId: string, tier?: ModeTier): WorkflowState {
    const id = `${type}-${Date.now()}-${randomUUID().slice(0, 8)}`
    const resolvedTier = tier ?? MODE_TIER_MAP[type]

    const state: WorkflowState = {
      id,
      type,
      status: "pending",
      tier: resolvedTier,
      task: String(task || "").slice(0, 500),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      errorCount: 0,
      maxErrors: CIRCUIT_BREAKER_MAX_ERRORS,
      reinforcementCount: 0,
      maxReinforcement: REINFORCEMENT_CAPS[type],
      sessionId,
    }

    this.workflows.set(id, state)
    this.persist(id)
    return state
  }

  // Transition to in_progress (from pending, paused, or failed)
  startWorkflow(id: string): WorkflowState {
    const state = this.getOrThrow(id)
    const previousStatus = state.status
    this.validateTransition(state, "in_progress")

    state.status = "in_progress"
    state.updatedAt = new Date().toISOString()

    // Only increment reinforcementCount on resume/retry, not initial activation
    if (previousStatus === "paused" || previousStatus === "failed") {
      state.reinforcementCount += 1
    }

    this.persist(id)
    return state
  }

  // Checkpoint — bumps updatedAt, optional tag
  checkpoint(id: string, tag?: string): void {
    const state = this.getOrThrow(id)
    state.updatedAt = new Date().toISOString()
    if (tag !== undefined) {
      state.checkpointTag = tag
    }
    this.persist(id)
  }

  // Mark completed — terminal state, clears errorCount
  completeWorkflow(id: string): WorkflowState {
    const state = this.getOrThrow(id)
    this.validateTransition(state, "completed")

    state.status = "completed"
    state.updatedAt = new Date().toISOString()
    state.completedAt = new Date().toISOString()
    state.errorCount = 0

    this.persist(id)
    return state
  }

  // Mark failed — increments errorCount, checks circuit breaker
  failWorkflow(id: string, error?: string): WorkflowState {
    const state = this.getOrThrow(id)
    this.validateTransition(state, "failed")

    state.errorCount += 1
    state.status = "failed"
    state.updatedAt = new Date().toISOString()

    if (error) {
      state.metadata = { ...(state.metadata || {}), lastError: error.slice(0, 500) }
    }

    this.persist(id)
    return state
  }

  // Pause (for session stop)
  pauseWorkflow(id: string): WorkflowState {
    const state = this.getOrThrow(id)
    this.validateTransition(state, "paused")

    state.status = "paused"
    state.updatedAt = new Date().toISOString()

    this.persist(id)
    return state
  }

  // Resume (from paused) — checks reinforcement cap before transitioning
  resumeWorkflow(id: string): WorkflowState {
    const state = this.workflows.get(id)
    if (!state) throw new Error(`Workflow ${id} not found`)
    if (state.status !== "paused") {
      throw new Error(`Cannot resume workflow ${id}: status is ${state.status}`)
    }
    if (state.reinforcementCount >= state.maxReinforcement) {
      throw new Error(`Reinforcement cap reached for workflow ${id}`)
    }
    return this.startWorkflow(id)
  }

  // Mark stale (exceeded WORKFLOW_STALE_MS without checkpoint)
  markStale(id: string): WorkflowState {
    const state = this.getOrThrow(id)
    this.validateTransition(state, "stale")

    state.status = "stale"
    state.updatedAt = new Date().toISOString()

    this.persist(id)
    return state
  }

  // Check if workflow can be resumed (under reinforcement cap, under circuit breaker)
  canResume(id: string): boolean {
    const state = this.workflows.get(id)
    if (!state) return false
    // Only paused or failed workflows can be resumed
    if (state.status !== "paused" && state.status !== "failed") return false
    // Circuit breaker: blocked if too many errors
    if (state.errorCount >= state.maxErrors) return false
    // Reinforcement cap: blocked if resumed too many times
    if (state.reinforcementCount >= state.maxReinforcement) return false
    return true
  }

  // Check if workflow is persistent (survives session stop)
  isPersistent(id: string): boolean {
    const state = this.workflows.get(id)
    if (!state) return false
    return PERSISTENT_MODES.includes(state.type)
  }

  // Check if workflow auto-resumes on session start
  shouldAutoResume(id: string): boolean {
    const state = this.workflows.get(id)
    if (!state) return false
    return AUTONOMOUS_RESUME_MODES.includes(state.type)
  }

  // List active workflows (in_progress), sorted by updatedAt desc
  getActive(): WorkflowState[] {
    return this.filterByStatus("in_progress")
  }

  // List paused workflows, sorted by updatedAt desc
  getPaused(): WorkflowState[] {
    return this.filterByStatus("paused")
  }

  // List all workflows, sorted by updatedAt desc
  getAll(): WorkflowState[] {
    return Array.from(this.workflows.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  // List by status, sorted by updatedAt desc
  getByStatus(status: WorkflowStatus): WorkflowState[] {
    return this.filterByStatus(status)
  }

  // Cleanup stale workflows — marks any non-terminal workflow that exceeded
  // WORKFLOW_STALE_MS as stale. Returns array of cleaned IDs.
  cleanupStale(): string[] {
    const now = Date.now()
    const cleaned: string[] = []

    for (const wf of this.workflows.values()) {
      if (wf.status === "completed" || wf.status === "stale") continue

      const lastUpdate = new Date(wf.updatedAt || wf.createdAt).getTime()
      if (now - lastUpdate > WORKFLOW_STALE_MS) {
        wf.status = "stale"
        wf.updatedAt = new Date().toISOString()
        this.persist(wf.id)
        cleaned.push(wf.id)
      }
    }

    return cleaned
  }

  // Persist to disk (JSON file per workflow)
  persist(id: string): void {
    const state = this.workflows.get(id)
    if (!state) return

    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true })
    }
    const filePath = join(this.stateDir, `${id}.json`)
    writeFileSync(filePath, JSON.stringify(state, null, 2))
  }

  // Load a single workflow from disk into memory
  load(id: string): WorkflowState | null {
    const filePath = join(this.stateDir, `${id}.json`)
    if (!existsSync(filePath)) return null
    try {
      const state = JSON.parse(readFileSync(filePath, "utf8")) as WorkflowState
      this.workflows.set(id, state)
      return state
    } catch {
      return null
    }
  }

  // Load all workflows from disk into memory
  loadAll(): void {
    if (!existsSync(this.stateDir)) return
    const files = readdirSync(this.stateDir).filter(f => f.endsWith(".json"))
    for (const file of files) {
      try {
        const state = JSON.parse(readFileSync(join(this.stateDir, file), "utf8")) as WorkflowState
        this.workflows.set(state.id, state)
      } catch {
        // Skip corrupted files
      }
    }
  }

  // ── Private helpers ──

  private getOrThrow(id: string): WorkflowState {
    const state = this.workflows.get(id)
    if (!state) throw new Error(`Workflow ${id} not found`)
    return state
  }

  private validateTransition(state: WorkflowState, target: WorkflowStatus): void {
    const allowed = VALID_TRANSITIONS[state.status]
    if (!allowed || !allowed.includes(target)) {
      throw new Error(`Invalid transition: ${state.status} → ${target}`)
    }
  }

  private filterByStatus(status: WorkflowStatus): WorkflowState[] {
    return Array.from(this.workflows.values())
      .filter(w => w.status === status)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }
}

export default WorkflowStateManager
