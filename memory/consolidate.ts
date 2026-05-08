import crypto from 'node:crypto';
import { Database } from 'bun:sqlite';
import { reinforce, evictStale } from './decay.js';
import type { ConsolidationResult, FactCandidate, Episode } from './types.js';

function uuid(): string {
  return crypto.randomUUID();
}

function sharedKeywordCount(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wordsB = b.toLowerCase().split(/\W+/);
  let count = 0;
  for (const w of wordsB) {
    if (w.length > 3 && wordsA.has(w)) count++;
  }
  return count;
}

// Check for contradictions against existing facts
function detectContradictions(db: Database, newFact: FactCandidate): string[] {
  const existing = db.prepare(
    `SELECT id, fact FROM semantic_memory
     WHERE category = ? AND decay_factor > 0.1
     ORDER BY confidence DESC LIMIT 5`
  ).all(newFact.category) as Array<{ id: string; fact: string }>;

  const contradictions: string[] = [];
  for (const ex of existing) {
    const sharedWords = sharedKeywordCount(newFact.fact, ex.fact);
    if (sharedWords >= 3) {
      const hasNegation = /\b(not?|don'?t|never|cannot?|isn'?t|aren'?t|wasn'?t|wrong|incorrect)\b/i;
      if (hasNegation.test(newFact.fact) !== hasNegation.test(ex.fact)) {
        contradictions.push(ex.id);
      }
    }
  }

  return contradictions;
}

// Working → Episodic (session summary)
function consolidateToEpisodic(db: Database, sessionId: string): string | null {
  const observations = db.prepare(
    `SELECT * FROM working_memory
     WHERE session_id = ?
     ORDER BY created_at ASC`
  ).all(sessionId) as Array<{
    id: string; session_id: string; observation: string; source: string;
    tool_name?: string; tool_input?: string; tool_output?: string;
    hash: string; created_at: string; expires_at?: string;
  }>;

  if (observations.length === 0) return null;

  const toolsUsed = [...new Set(observations.map(o => o.tool_name).filter(Boolean))];
  const fileOps = observations.filter(o => o.tool_name === 'Edit' || o.tool_name === 'Write');
  const filesTouched = [...new Set(
    fileOps.map(o => {
      try { return JSON.parse(o.tool_input || '{}').file_path || null; } catch (_e) { return null; }
    }).filter(Boolean) as string[]
  )];

  const errors = observations
    .filter(o => o.source === 'tool_use' && o.tool_output && /error|fail|exception/i.test(String(o.tool_output).slice(0, 500)))
    .map(o => String(o.tool_output).slice(0, 200));

  const decisions = observations
    .filter(o => ['Write', 'Edit'].includes(o.tool_name || '') || (o.source === 'user_prompt'))
    .map(o => o.observation.slice(0, 300));

  const toolNames = toolsUsed.join(', ');
  const fileList = filesTouched.slice(0, 20).join(', ');

  let summary = `Session with ${observations.length} observations`;
  summary += `\nTools used: ${toolNames || 'none'}`;
  if (filesTouched.length > 0) {
    summary += `\nFiles: ${fileList}${filesTouched.length > 20 ? '...' : ''}`;
  }
  if (errors.length > 0) {
    summary += `\nErrors: ${errors.length} encountered`;
  }

  let outcome: 'success' | 'partial' | 'failure' | 'abandoned' = 'success';
  if (errors.length > observations.length * 0.3) outcome = 'failure';
  else if (errors.length > 0) outcome = 'partial';
  if (observations.length < 2) outcome = 'abandoned';

  const id = `ep_${uuid().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO episodic_memory (id, session_id, summary, key_decisions, files_touched,
      errors_encountered, tools_used, outcome, observation_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, sessionId,
    summary.slice(0, 5000),
    JSON.stringify(decisions.slice(0, 10)),
    JSON.stringify(filesTouched),
    JSON.stringify(errors.slice(0, 20)),
    JSON.stringify(toolsUsed),
    outcome,
    observations.length
  );

  return id;
}

// Extract facts from episode observations (heuristic patterns)
function extractFacts(_episode: Episode, observations: Array<{
  tool_name?: string; tool_input?: string; tool_output?: string;
  source: string; observation: string;
}>, _db: Database): FactCandidate[] {
  const facts: FactCandidate[] = [];

  // Pattern 1: File creation/editing → architecture fact
  const fileOps = observations.filter(o => o.tool_name === 'Write' || o.tool_name === 'Edit');
  for (const op of fileOps) {
    try {
      const input = JSON.parse(op.tool_input || '{}');
      const fp = input.file_path || '';
      if (fp) {
        facts.push({ category: 'architecture', fact: `Project contains file: ${fp}`, confidence: 0.7 });
      }
    } catch (_e) { /* skip */ }
  }

  // Pattern 2: User prompts → decision facts
  const userPrompts = observations.filter(o => o.source === 'user_prompt');
  for (const prompt of userPrompts.slice(0, 5)) {
    const text = String(prompt.observation || '').trim();
    if (text.length > 20 && text.length < 500) {
      facts.push({ category: 'decision', fact: `User requested: ${text}`, confidence: 0.9 });
    }
  }

  // Pattern 3: Errors → bug facts
  const errorObs = observations.filter(o =>
    o.tool_output && /error|fail|exception/i.test(String(o.tool_output).slice(0, 500))
  );
  for (const err of errorObs.slice(0, 5)) {
    const errText = String(err.tool_output).slice(0, 300);
    facts.push({ category: 'bug', fact: `Error in ${err.tool_name || 'unknown'}: ${errText}`, confidence: 0.85 });
  }

  // Pattern 4: Repeated patterns → convention facts
  const toolCounts: Record<string, number> = {};
  for (const obs of observations) {
    if (obs.tool_name) toolCounts[obs.tool_name] = (toolCounts[obs.tool_name] || 0) + 1;
  }
  const frequentTools = Object.entries(toolCounts).filter(([, c]) => c >= 5);
  for (const [tool, count] of frequentTools) {
    facts.push({
      category: 'convention',
      fact: `Frequently uses ${tool} (${count}x per session)`,
      confidence: Math.min(0.9, 0.4 + count * 0.05)
    });
  }

  return facts;
}

// Episodic → Semantic (fact creation with dedup)
function consolidateToSemantic(db: Database, episodeId: string, sessionId: string): string[] {
  const episode = db.prepare('SELECT * FROM episodic_memory WHERE id = ?').get(episodeId) as Episode | undefined;
  if (!episode) return [];

  const observations = db.prepare(
    'SELECT * FROM working_memory WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as Array<{
    tool_name?: string; tool_input?: string; tool_output?: string;
    source: string; observation: string;
  }>;

  const facts = extractFacts(episode, observations, db);
  const persistedIds: string[] = [];

  for (const fact of facts) {
    const contradictions = detectContradictions(db, fact);
    let confidence = fact.confidence;
    if (contradictions.length > 0) confidence *= 0.6;

    // Check for duplicate fact
    const existing = db.prepare(
      `SELECT id, confidence, access_count, decay_factor FROM semantic_memory
       WHERE fact = ? LIMIT 1`
    ).get(fact.fact) as { id: string; confidence: number; access_count: number; decay_factor: number } | undefined;

    if (existing) {
      const newConfidence = Math.min(1.0, confidence + 0.1);
      const newDecay = reinforce(existing.decay_factor);
      db.prepare(
        `UPDATE semantic_memory SET confidence = ?, access_count = access_count + 1,
         last_accessed = datetime('now'), last_reinforced_at = datetime('now'),
         decay_factor = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(newConfidence, newDecay, existing.id);
      persistedIds.push(existing.id);
      continue;
    }

    const id = `sm_${uuid().slice(0, 12)}`;
    db.prepare(`
      INSERT INTO semantic_memory (id, fact, category, confidence, source_session_id,
        source_episode_id, contradictions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, fact.fact, fact.category, confidence, sessionId, episodeId, JSON.stringify(contradictions));
    persistedIds.push(id);
  }

  return persistedIds;
}

// Semantic → Procedural (pattern synthesis)
function consolidateToProcedural(db: Database): Array<{ id: string; name: string; category: string }> {
  const categories = db.prepare(
    `SELECT category, COUNT(*) as cnt FROM semantic_memory
     WHERE decay_factor > 0.2 AND confidence > 0.5
     GROUP BY category HAVING cnt >= 3
     ORDER BY cnt DESC`
  ).all() as Array<{ category: string; cnt: number }>;

  const created: Array<{ id: string; name: string; category: string }> = [];

  for (const cat of categories) {
    const facts = db.prepare(
      `SELECT id, fact FROM semantic_memory WHERE category = ? AND decay_factor > 0.2 AND confidence > 0.5
       ORDER BY confidence DESC LIMIT 20`
    ).all(cat.category) as Array<{ id: string; fact: string }>;

    if (facts.length < 5) continue;

    const existing = db.prepare(
      `SELECT id FROM procedural_memory WHERE trigger_pattern = ? LIMIT 1`
    ).get(`category:${cat.category}`);

    if (existing) continue;

    let name: string, description: string, steps: string, triggerPattern: string;

    switch (cat.category) {
      case 'bug':
        name = 'Bug Resolution Pattern';
        description = 'Learned pattern for resolving bugs based on error type';
        triggerPattern = '\\b(bug|error|fix|broken|failing|crash)\\b';
        steps = JSON.stringify([
          { action: 'Identify error type from message', tool: 'Grep' },
          { action: 'Find all references to affected code', tool: 'FindReferences' },
          { action: 'Check recent changes in affected files', tool: 'git diff' },
          { action: 'Apply fix and verify with tests', tool: 'Edit' },
          { action: 'Run lsp_diagnostics on modified files', tool: 'lsp_diagnostics' }
        ]);
        break;
      case 'architecture':
        name = 'Architecture Exploration Pattern';
        description = 'Learned pattern for understanding project architecture';
        triggerPattern = '\\b(how does|architecture|structure|design|organize)\\b';
        steps = JSON.stringify([
          { action: 'Search for relevant files by pattern', tool: 'Glob' },
          { action: 'Find key symbols and patterns', tool: 'Grep' },
          { action: 'Read top-level configuration files', tool: 'Read' },
          { action: 'Map dependencies between modules', tool: 'lsp_find_references' }
        ]);
        break;
      case 'convention':
        name = 'Code Convention Pattern';
        description = 'Learned pattern for following project conventions';
        triggerPattern = '\\b(style|convention|pattern|idiom|best practice)\\b';
        steps = JSON.stringify([
          { action: 'Search for similar existing code', tool: 'Grep' },
          { action: 'Read the convention rules file', tool: 'Read' },
          { action: 'Check project CLAUDE.md or AGENTS.md', tool: 'Read' }
        ]);
        break;
      default:
        name = `${cat.category} Pattern`;
        description = `Learned workflow for ${cat.category}`;
        triggerPattern = `\\b${cat.category}\\b`;
        steps = JSON.stringify([
          { action: 'Analyze context', tool: 'Read' },
          { action: 'Apply pattern', tool: 'Edit' },
          { action: 'Verify result', tool: 'lsp_diagnostics' }
        ]);
    }

    const id = `pm_${uuid().slice(0, 12)}`;
    db.prepare(`
      INSERT INTO procedural_memory (id, name, description, trigger_pattern, steps, source_semantic_ids)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, description, triggerPattern, steps, JSON.stringify(facts.map(f => f.id)));

    created.push({ id, name, category: cat.category });
  }

  return created;
}

// LLM Consolidation Prompts
function generateLlmConsolidationPrompts(db: Database, sessionId: string, episodeId: string | null): number {
  const prompts: Array<{ category: string; priority: number; prompt: string }> = [];

  const observations = db.prepare(
    `SELECT * FROM working_memory WHERE session_id = ? ORDER BY created_at ASC`
  ).all(sessionId) as Array<{
    tool_name?: string; tool_output?: string; observation: string;
  }>;

  // 1. Fact extraction
  const richObservations = observations.filter(o =>
    o.tool_output && String(o.tool_output).length > 200 &&
    !['Edit', 'Write'].includes(o.tool_name || '')
  ).slice(0, 10);

  if (richObservations.length > 0) {
    const summaries = richObservations.map(o =>
      `[${o.tool_name}] ${String(o.observation).slice(0, 500)}`
    ).join('\n---\n');

    prompts.push({
      category: 'fact_extraction',
      priority: 5,
      prompt: [
        '<consolidation_task type="fact_extraction">',
        'Extract reusable facts from these tool outputs. Output as <remember> tags.',
        '',
        'Rules:',
        '- One fact per <remember> tag',
        '- Category must be: architecture, pattern, convention, bug, decision, api, config',
        '- Confidence 0.0-1.0 based on how certain the fact is',
        '- Skip trivial/obvious facts already known from file structure',
        '',
        '<observations>',
        summaries,
        '</observations>',
        '',
        'Format each fact as:',
        '<remember>',
        'Category: <category>',
        'Confidence: <0.0-1.0>',
        'Fact: <one sentence>',
        '</remember>',
        '</consolidation_task>'
      ].join('\n')
    });
  }

  // 2. Contradiction detection
  const recentFacts = db.prepare(
    `SELECT id, fact, category, confidence FROM semantic_memory
     WHERE decay_factor > 0.2
     ORDER BY created_at DESC LIMIT 20`
  ).all() as Array<{ id: string; fact: string; category: string; confidence: number }>;

  if (recentFacts.length >= 4) {
    prompts.push({
      category: 'contradiction_resolution',
      priority: 3,
      prompt: [
        '<consolidation_task type="contradiction_resolution">',
        'Review these recently extracted facts. Identify any that contradict each other.',
        'Output contradictions as <remember> tags with reduced confidence on the conflicting facts.',
        '',
        '<recent_facts>',
        recentFacts.map(f => `[${f.id}] [${f.category}] conf=${f.confidence.toFixed(1)}: ${f.fact}`).join('\n'),
        '</recent_facts>',
        '',
        'If contradictions found, output:',
        '<remember>',
        'Category: contradiction',
        'Contradicts: <fact_id>',
        'Resolution: <one sentence resolution>',
        '</remember>',
        '</consolidation_task>'
      ].join('\n')
    });
  }

  // 3. Pattern synthesis
  const frequentTools = db.prepare(
    `SELECT tool_name, COUNT(*) as cnt FROM working_memory
     WHERE session_id = ? AND tool_name IS NOT NULL
     GROUP BY tool_name HAVING cnt >= 3
     ORDER BY cnt DESC`
  ).all(sessionId) as Array<{ tool_name: string; cnt: number }>;

  if (frequentTools.length >= 2) {
    prompts.push({
      category: 'pattern_synthesis',
      priority: 2,
      prompt: [
        '<consolidation_task type="pattern_synthesis">',
        'This session showed repeated tool usage patterns. Synthesize a procedural workflow.',
        '',
        '<tool_patterns>',
        frequentTools.map(t => `- ${t.tool_name}: ${t.cnt}x used`).join('\n'),
        '</tool_patterns>',
        '',
        'If a reusable workflow pattern is evident, output:',
        '<remember>',
        'Category: pattern',
        'Name: <workflow name>',
        'Trigger: <when to use this pattern>',
        'Steps: <numbered list>',
        '</remember>',
        '</consolidation_task>'
      ].join('\n')
    });
  }

  let stored = 0;
  for (const p of prompts) {
    const id = `pc_${crypto.randomUUID().slice(0, 12)}`;
    try {
      db.prepare(`
        INSERT INTO pending_consolidations (id, source_session_id, source_episode_id,
          prompt, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, sessionId, episodeId, p.prompt, p.category, p.priority);
      stored++;
    } catch (_e) {
      console.error('Failed to store LLM consolidation prompt:', _e);
    }
  }

  return stored;
}

// Full pipeline: Working → Episodic → Semantic → Procedural
export function runFullPipeline(db: Database, sessionId: string): ConsolidationResult {
  const result: ConsolidationResult = {
    sessionId,
    episodic: null,
    semantic: [],
    procedural: [],
    llmPromptsGenerated: 0,
    cleanedObservations: 0
  };

  const begin = db.prepare('BEGIN IMMEDIATE');
  const commit = db.prepare('COMMIT');
  try {
    begin.run();

    const episodeId = consolidateToEpisodic(db, sessionId);
    if (!episodeId) {
      commit.run();
      return result;
    }

    result.episodic = episodeId;
    result.semantic = consolidateToSemantic(db, episodeId, sessionId);
    result.procedural = consolidateToProcedural(db);

    // Evict stale procedures
    db.prepare(`
      DELETE FROM procedural_memory
      WHERE success_rate < 0.2
        AND usage_count < 3
        AND last_used < datetime('now', '-30 days')
    `).run();

    result.llmPromptsGenerated = generateLlmConsolidationPrompts(db, sessionId, episodeId);
    result.cleanedObservations = evictStale(db);

    commit.run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }

  return result;
}

// Process LLM consolidation output — parses <remember> tags
export function processLlmConsolidationResult(db: Database, llmOutput: string, sessionId: string): string[] {
  const rememberPattern = /<remember>\s*\n?\s*Category:\s*(\w+)\s*\n?\s*Confidence:\s*([\d.]+)\s*\n?\s*(?:Fact|Resolution|Name):\s*(.+?)(?:\n?\s*(?:Contradicts|Trigger|Steps):\s*(.+?))?\s*\n?\s*<\/remember>/gi;

  const facts: Array<{ category: string; confidence: number; fact: string; extra: string | null }> = [];
  let match;
  while ((match = rememberPattern.exec(llmOutput)) !== null) {
    const category = match[1].toLowerCase();
    const confidence = parseFloat(match[2]) || 0.5;
    const fact = match[3].trim();
    const extra = match[4] ? match[4].trim() : null;

    if (fact.length > 10 && fact.length < 1000) {
      facts.push({ category, confidence: Math.min(1, Math.max(0, confidence)), fact, extra });
    }
  }

  const ids: string[] = [];
  for (const f of facts) {
    const existing = db.prepare(
      `SELECT id, confidence, access_count, decay_factor FROM semantic_memory
       WHERE fact = ? LIMIT 1`
    ).get(f.fact) as { id: string; confidence: number; access_count: number; decay_factor: number } | undefined;

    if (existing) {
      const newConfidence = Math.min(1.0, f.confidence + 0.1);
      const newDecay = reinforce(existing.decay_factor);
      db.prepare(
        `UPDATE semantic_memory SET confidence = ?, access_count = access_count + 1,
         last_accessed = datetime('now'), last_reinforced_at = datetime('now'),
         decay_factor = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(newConfidence, newDecay, existing.id);
      ids.push(existing.id);
      continue;
    }

    const id = `sm_${uuid().slice(0, 12)}`;
    db.prepare(`
      INSERT INTO semantic_memory (id, fact, category, confidence, source_session_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, f.fact, f.category, f.confidence, sessionId);
    ids.push(id);
  }

  // Mark pending consolidations as processed
  db.prepare(`
    UPDATE pending_consolidations SET status = 'processed', processed_at = datetime('now')
    WHERE source_session_id = ? AND status = 'injected'
  `).run(sessionId);

  return ids;
}
