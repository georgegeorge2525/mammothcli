// Mammoth Memory System — Type definitions for 4-tier consolidation

export interface Observation {
  id: string;
  session_id: string;
  observation: string;
  source: 'tool_use' | 'user_prompt' | 'agent_output' | 'system';
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  hash: string;
  created_at: string;
  expires_at?: string;
}

export interface ObserveInput {
  sessionId: string;
  observation: string;
  source?: 'tool_use' | 'user_prompt' | 'agent_output' | 'system';
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
}

export interface Episode {
  id: string;
  session_id: string;
  summary: string;
  key_decisions: string;    // JSON array
  files_touched: string;     // JSON array
  errors_encountered: string; // JSON array
  tools_used: string;        // JSON array
  outcome: 'success' | 'partial' | 'failure' | 'abandoned';
  observation_count: number;
  created_at: string;
}

export interface SemanticFact {
  id: string;
  fact: string;
  category: 'architecture' | 'pattern' | 'convention' | 'bug' | 'decision' | 'api' | 'config' | 'general';
  confidence: number;
  source_session_id?: string;
  source_episode_id?: string;
  contradictions?: string;  // JSON array
  access_count: number;
  last_accessed?: string;
  created_at: string;
  updated_at: string;
  decay_factor: number;
  last_reinforced_at: string;
}

export interface ProcedureStep {
  action: string;
  tool: string;
  expected?: string;
}

export interface Procedure {
  id: string;
  name: string;
  description?: string;
  trigger_pattern?: string;
  steps: string;             // JSON array of ProcedureStep
  preconditions?: string;    // JSON array
  postconditions?: string;   // JSON array
  success_rate: number;
  usage_count: number;
  last_used?: string;
  source_semantic_ids?: string;
  created_at: string;
  updated_at: string;
}

export interface MemorySession {
  id: string;
  project_path?: string;
  project_name?: string;
  workflow_type?: string;
  personality_mode?: string;
  status: 'active' | 'ended';
  started_at: string;
  ended_at?: string;
  tool_call_count: number;
  edit_count: number;
  agent_spawn_count: number;
  error_count: number;
  summary?: string;
  tags?: string;
}

export interface PendingConsolidation {
  id: string;
  source_session_id: string;
  source_episode_id?: string;
  prompt: string;
  category: 'fact_extraction' | 'contradiction_resolution' | 'pattern_synthesis';
  priority: number;
  status: 'pending' | 'injected' | 'processed' | 'expired';
  injected_at?: string;
  processed_at?: string;
  result_fact_ids?: string;
  created_at: string;
  expires_at: string;
}

export interface ConsolidationResult {
  sessionId: string;
  episodic: string | null;
  semantic: string[];
  procedural: Array<{ id: string; name: string; category: string }>;
  llmPromptsGenerated: number;
  cleanedObservations: number;
}

export interface MemoryStats {
  working: number;
  episodic: number;
  semantic: number;
  procedural: number;
  sessions: number;
}

export interface SearchOptions {
  limit?: number;
  sessionId?: string;
  category?: string;
  minConfidence?: number;
}

export interface SearchResults {
  observations: Array<Observation & { bm25_score: number }>;
  semantic: Partial<SemanticFact>[];
  procedural: Partial<Procedure>[];
}

export interface InjectOptions {
  projectDir?: string;
  sessionId?: string;
  tokenBudget?: number;
  personalityMode?: string;
}

export interface MaintenanceReport {
  decayUpdates: number;
  evicted: number;
  cleanedObservations: number;
  proceduralCleaned: number;
}

export interface SessionStats {
  sessionId: string;
  session: MemorySession | null;
  observationsBySource: Record<string, number>;
  totalObservations: number;
}

export interface FactCandidate {
  category: string;
  fact: string;
  confidence: number;
}
