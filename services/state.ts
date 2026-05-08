import type { MammothConfig } from '../types/mammothConfig.js';
import type {
  ConductorStage,
  ContextProfile,
  PersonalityMode,
  WorkflowState,
} from '../types/mammoth.js';

// MammothState — global runtime state singleton for Mammoth orchestration.
// One instance per process, initialized from MammothConfig. Not stored in
// bootstrap global state — exported as a module-level singleton instead.

export class MammothState {
  private static instance: MammothState | null = null;

  // Core state
  enabled = false;
  personality: PersonalityMode = 'off';
  activeContext: ContextProfile = 'dev';
  conductorStage: ConductorStage = 'plan';

  // Workflow tracking
  activeWorkflows: Map<string, WorkflowState> = new Map();

  // Gate state (gateguard hook tracking)
  sessionFiles: Map<
    string,
    { factsPresented: boolean; editCount: number }
  > = new Map();
  firstBashDone = false;
  taskSummaryPresented = false;

  // Skill indexing
  skillsIndexed = 0;

  // Quality summary
  qualitySummary = {
    total: 0,
    platinum: 0,
    gold: 0,
    silver: 0,
    bronze: 0,
    unrated: 0,
  };

  // Singleton accessor — throws if not yet initialized
  static getInstance(): MammothState {
    if (!MammothState.instance) {
      throw new Error(
        'MammothState not initialized. Construct with MammothConfig first.',
      );
    }
    return MammothState.instance;
  }

  // Initialize from config. Subsequent calls return the existing instance.
  constructor(config: MammothConfig) {
    if (MammothState.instance) {
      return MammothState.instance;
    }
    this.personality = config.personality.defaultMode;
    MammothState.instance = this;
  }

  // Clear all state back to defaults
  reset(): void {
    this.enabled = false;
    this.personality = 'off';
    this.activeContext = 'dev';
    this.conductorStage = 'plan';
    this.activeWorkflows.clear();
    this.sessionFiles.clear();
    this.firstBashDone = false;
    this.taskSummaryPresented = false;
    this.skillsIndexed = 0;
    this.qualitySummary = {
      total: 0,
      platinum: 0,
      gold: 0,
      silver: 0,
      bronze: 0,
      unrated: 0,
    };
  }

  // Enable / disable Mammoth for the session
  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  // Personality mode
  setPersonality(mode: PersonalityMode): void {
    this.personality = mode;
  }

  // Active context profile
  setContext(context: ContextProfile): void {
    this.activeContext = context;
  }

  // Advance conductor stage
  advanceStage(stage: ConductorStage): void {
    this.conductorStage = stage;
  }

  // Workflow management
  addWorkflow(workflow: WorkflowState): void {
    this.activeWorkflows.set(workflow.id, workflow);
  }

  removeWorkflow(id: string): void {
    this.activeWorkflows.delete(id);
  }

  updateWorkflow(id: string, update: Partial<WorkflowState>): void {
    const existing = this.activeWorkflows.get(id);
    if (existing) {
      this.activeWorkflows.set(id, { ...existing, ...update });
    }
  }

  getActiveWorkflows(): WorkflowState[] {
    return Array.from(this.activeWorkflows.values());
  }

  // Gate state — file edit tracking
  registerFileEdit(filePath: string): void {
    const entry = this.sessionFiles.get(filePath);
    if (entry) {
      entry.editCount++;
    } else {
      this.sessionFiles.set(filePath, { factsPresented: false, editCount: 1 });
    }
  }

  hasFactsForFile(filePath: string): boolean {
    return this.sessionFiles.get(filePath)?.factsPresented ?? false;
  }

  // Gate state — bash tracking
  markBashUsed(): void {
    this.firstBashDone = true;
  }

  // Gate state — task summary tracking
  markTaskSummaryPresented(): void {
    this.taskSummaryPresented = true;
  }
}
