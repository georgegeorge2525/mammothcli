import { Database } from 'bun:sqlite';
import type { MemoryManager } from '../memory/MemoryManager.js';
import { isAutonomousResume } from '../contexts/modes.js';
import {
  createWorkflow, loadWorkflow, saveWorkflow, transitionWorkflow,
  checkpoint as wfCheckpoint, recordError as wfRecordError,
  recordCompletion as wfRecordCompletion, listActive, listPaused,
  cleanupStale, setDatabase
} from './workflow-manager.js';
import {
  parsePreset, generateOrchestrationContext, generateSpawnInstructions,
  collectResults, listPresets
} from './team-spawner.js';
import {
  getWorkflowStatus, getMammothStatus, getPersonalityStatus,
  getMemoryStatus, getQualityStatus, getSessionStatus,
  formatStatusline, generateHudContext
} from './hud-provider.js';
import type { WorkflowState, WorkflowType, TeamOrchestration, EngineStatus } from './types.js';

export class MammothEngine {
  private memoryManager?: MemoryManager;
  private sessionId: string;
  private projectDir: string;

  constructor(options: { sessionId?: string; projectDir?: string; memoryManager?: MemoryManager; db?: Database } = {}) {
    this.sessionId = options.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
    this.projectDir = options.projectDir || process.cwd();
    this.memoryManager = options.memoryManager;

    if (options.db) {
      setDatabase(options.db);
    }
  }

  // ── Team Orchestration ──

  prepareTeam(presetName: string, task: string): TeamOrchestration | { error: string } {
    const preset = parsePreset(presetName);
    if (!preset) return { error: `Preset "${presetName}" not found` };

    const wf = createWorkflow('team', task, {
      metadata: { presetName, agents: preset.agents.map(a => a.type) },
      sessionId: this.sessionId,
      projectDir: this.projectDir,
    });

    const context = generateOrchestrationContext(presetName, task, wf.id);
    if (!context) return { error: 'Failed to generate orchestration context' };

    return {
      preset,
      context,
      workflowId: wf.id,
      agents: preset.agents,
      parallelism: preset.parallelism,
    };
  }

  listPresets(): string[] {
    return listPresets();
  }

  // ── Workflow Control ──

  startWorkflow(type: WorkflowType, task: string, options: Partial<WorkflowState> = {}): WorkflowState {
    return createWorkflow(type, task, {
      ...options,
      sessionId: this.sessionId,
      projectDir: this.projectDir,
    });
  }

  checkpointWorkflow(id: string, progress: string, remaining?: string[]): WorkflowState | null {
    return wfCheckpoint(id, progress, remaining);
  }

  completeWorkflow(id: string, subtask: string): WorkflowState | null {
    return wfRecordCompletion(id, subtask);
  }

  failWorkflow(id: string, error: string): WorkflowState | null {
    return wfRecordError(id, error);
  }

  pauseWorkflow(id: string): WorkflowState | { error: string } {
    return transitionWorkflow(id, 'paused');
  }

  resumeWorkflow(id: string): WorkflowState | { error: string } {
    return transitionWorkflow(id, 'in_progress');
  }

  getWorkflow(id: string): WorkflowState | null {
    return loadWorkflow(id);
  }

  // ── Status & HUD ──

  getStatus(): EngineStatus {
    const memStats = this.memoryManager?.getMemoryStats();
    return {
      mammoth: getMammothStatus(),
      personality: getPersonalityStatus(),
      workflow: getWorkflowStatus(),
      memory: getMemoryStatus(memStats),
      quality: getQualityStatus(),
      session: getSessionStatus(this.sessionId, this.projectDir),
      timestamp: new Date().toISOString(),
    };
  }

  getHudContext(): string {
    const memStats = this.memoryManager?.getMemoryStats();
    return generateHudContext(memStats);
  }

  getStatusline(): string {
    return formatStatusline(this.getStatus());
  }

  // ── Session Lifecycle ──

  onSessionStart(): string {
    const output: string[] = [];

    // Resume paused workflows
    const paused = listPaused();
    if (paused.length > 0) {
      const pausedList = paused.map(w =>
        `- ${w.id}: ${w.type} — paused at ${w.pausedAt || 'unknown'}`
      ).join('\n');
      output.push(`<workflow_resume>\nPaused workflows:\n${pausedList}\n</workflow_resume>`);

      for (const w of paused) {
        if (isAutonomousResume(w.type)) {
          transitionWorkflow(w.id, 'in_progress');
        }
      }
    }

    // Clean up stale workflows
    const cleaned = cleanupStale();
    if (cleaned > 0) {
      output.push(`Cleaned ${cleaned} stale workflows.`);
    }

    // HUD context
    output.push(this.getHudContext());

    return output.join('\n\n');
  }

  onSessionEnd(): { paused: number; status: string } {
    const active = listActive();
    for (const wf of active) {
      transitionWorkflow(wf.id, 'paused');
    }

    cleanupStale();

    return { paused: active.length, status: 'ok' };
  }

  // ── Memory delegation ──

  observeMemory(input: { sessionId: string; observation: string; source?: 'tool_use' | 'user_prompt' | 'agent_output' | 'system'; toolName?: string; toolInput?: unknown; toolOutput?: string }): string | null {
    if (!this.memoryManager) return null;
    return this.memoryManager.observe({
      sessionId: input.sessionId,
      observation: input.observation,
      source: input.source,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolOutput: input.toolOutput,
    });
  }

  consolidateMemory(sessionId: string) {
    return this.memoryManager?.consolidate(sessionId);
  }
}