-- Mammoth Memory System — 4-Tier Consolidation Schema
-- Architecture adapted from agentmemory (rohitg00/agentmemory, Apache 2.0)
-- Pure SQLite, zero external dependencies

-- Tier 0: Working Memory — raw observations from tool use, prompts, agent output
CREATE TABLE IF NOT EXISTS working_memory (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  observation TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'tool_use',
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_working_hash ON working_memory(hash);
CREATE INDEX IF NOT EXISTS idx_working_source ON working_memory(source);

-- Tier 1: Episodic Memory — compressed session summaries
CREATE TABLE IF NOT EXISTS episodic_memory (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_decisions TEXT,
  files_touched TEXT,
  errors_encountered TEXT,
  tools_used TEXT,
  outcome TEXT,
  observation_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episodic_session ON episodic_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_episodic_outcome ON episodic_memory(outcome);

-- Tier 2: Semantic Memory — extracted facts, patterns, conventions
CREATE TABLE IF NOT EXISTS semantic_memory (
  id TEXT PRIMARY KEY,
  fact TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  confidence REAL NOT NULL DEFAULT 1.0,
  source_session_id TEXT,
  source_episode_id TEXT,
  contradictions TEXT,
  access_count INTEGER DEFAULT 0,
  last_accessed TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  decay_factor REAL NOT NULL DEFAULT 1.0,
  last_reinforced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_semantic_category ON semantic_memory(category);
CREATE INDEX IF NOT EXISTS idx_semantic_confidence ON semantic_memory(confidence);
CREATE INDEX IF NOT EXISTS idx_semantic_decay ON semantic_memory(decay_factor);

-- Tier 3: Procedural Memory — learned workflows, decision patterns
CREATE TABLE IF NOT EXISTS procedural_memory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_pattern TEXT,
  steps TEXT NOT NULL,
  preconditions TEXT,
  postconditions TEXT,
  success_rate REAL DEFAULT 1.0,
  usage_count INTEGER DEFAULT 0,
  last_used TEXT,
  source_semantic_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_procedural_trigger ON procedural_memory(trigger_pattern);
CREATE INDEX IF NOT EXISTS idx_procedural_success ON procedural_memory(success_rate);

-- Session tracking
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT,
  project_name TEXT,
  workflow_type TEXT,
  personality_mode TEXT DEFAULT 'full',
  status TEXT DEFAULT 'active',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  tool_call_count INTEGER DEFAULT 0,
  edit_count INTEGER DEFAULT 0,
  agent_spawn_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  summary TEXT,
  tags TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);

-- Full-text search virtual table for observations
CREATE VIRTUAL TABLE IF NOT EXISTS working_memory_fts USING fts5(
  observation,
  content='working_memory',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS wm_fts_insert AFTER INSERT ON working_memory BEGIN
  INSERT INTO working_memory_fts(rowid, observation) VALUES (NEW.rowid, NEW.observation);
END;

CREATE TRIGGER IF NOT EXISTS wm_fts_delete AFTER DELETE ON working_memory BEGIN
  INSERT INTO working_memory_fts(working_memory_fts, rowid, observation) VALUES ('delete', OLD.rowid, OLD.observation);
END;

CREATE TRIGGER IF NOT EXISTS wm_fts_update AFTER UPDATE ON working_memory BEGIN
  INSERT INTO working_memory_fts(working_memory_fts, rowid, observation) VALUES ('delete', OLD.rowid, OLD.observation);
  INSERT INTO working_memory_fts(rowid, observation) VALUES (NEW.rowid, NEW.observation);
END;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS memory_schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);

-- Pending LLM consolidations
CREATE TABLE IF NOT EXISTS pending_consolidations (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  source_episode_id TEXT,
  prompt TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  priority INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  injected_at TEXT,
  processed_at TEXT,
  result_fact_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days'))
);

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_consolidations(status);
CREATE INDEX IF NOT EXISTS idx_pending_priority ON pending_consolidations(priority DESC);
CREATE INDEX IF NOT EXISTS idx_pending_session ON pending_consolidations(source_session_id);

INSERT OR IGNORE INTO memory_schema_version (version, description) VALUES (1, 'Initial 4-tier memory schema');
INSERT OR IGNORE INTO memory_schema_version (version, description) VALUES (2, 'Added pending_consolidations for LLM-based extraction');

-- Workflows table (added for standalone — replaces JSON file storage)
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  task TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflows_type ON workflows(type);
