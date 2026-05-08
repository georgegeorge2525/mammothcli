import { Database } from 'bun:sqlite';
import type { InjectOptions } from './types.js';

export const DEFAULT_TOKEN_BUDGET = 2000; // ~8000 chars

export function injectContext(db: Database, options: InjectOptions = {}): string | null {
  const {
    projectDir = process.cwd(),
    sessionId = process.env.CLAUDE_SESSION_ID || 'unknown',
    tokenBudget = DEFAULT_TOKEN_BUDGET,
    personalityMode = 'full'
  } = options;

  const context: string[] = [];
  let charsUsed = 0;

  const charBudget = tokenBudget * 4;

  function addSection(title: string, content: string): void {
    if (!content || charsUsed >= charBudget) return;
    const section = `<memory:${title}>\n${content}\n</memory:${title}>`;
    if (charsUsed + section.length > charBudget) {
      const remaining = charBudget - charsUsed - 50;
      if (remaining < 100) return;
      context.push(section.slice(0, remaining) + '\n...');
      charsUsed = charBudget;
      return;
    }
    context.push(section);
    charsUsed += section.length;
  }

  // 1. Recent sessions for this project
  const recentSessions = db.prepare(
    `SELECT id, workflow_type, personality_mode, started_at, summary, tool_call_count, edit_count
     FROM sessions
     WHERE project_path = ? AND id != ?
     ORDER BY started_at DESC LIMIT 5`
  ).all(projectDir, sessionId) as Array<{
    id: string; workflow_type?: string; personality_mode?: string;
    started_at: string; summary?: string; tool_call_count: number; edit_count: number;
  }>;

  if (recentSessions.length > 0) {
    const sessionList = recentSessions.map(s => {
      const date = new Date(s.started_at).toLocaleDateString();
      return `- ${date}: ${s.workflow_type || 'manual'} session (${s.tool_call_count || 0} tools, ${s.edit_count || 0} edits)${s.summary ? ` — ${s.summary.slice(0, 100)}` : ''}`;
    }).join('\n');
    addSection('recent_sessions', sessionList);
  }

  // 2. Relevant semantic facts for this project
  const semanticFacts = db.prepare(
    `SELECT sm.fact, sm.category, sm.confidence, sm.access_count
     FROM semantic_memory sm
     JOIN sessions s ON sm.source_session_id = s.id
     WHERE sm.decay_factor > 0.2 AND sm.confidence > 0.4
     AND s.project_path = ?
     ORDER BY sm.confidence * sm.access_count DESC
     LIMIT 15`
  ).all(projectDir) as Array<{ fact: string; category: string; confidence: number; access_count: number }>;

  if (semanticFacts.length > 0) {
    const factsByCategory: Record<string, string[]> = {};
    for (const f of semanticFacts) {
      if (!factsByCategory[f.category]) factsByCategory[f.category] = [];
      factsByCategory[f.category].push(`- ${f.fact}`);
    }
    const factsText = Object.entries(factsByCategory)
      .map(([cat, facts]) => `[${cat}]\n${facts.join('\n')}`)
      .join('\n\n');
    addSection('semantic_facts', factsText);
  }

  // 3. Relevant procedures
  const procedures = db.prepare(
    `SELECT name, description, trigger_pattern, success_rate, usage_count
     FROM procedural_memory
     WHERE success_rate > 0.5
     ORDER BY usage_count DESC
     LIMIT 5`
  ).all() as Array<{ name: string; description?: string; trigger_pattern?: string; success_rate: number; usage_count: number }>;

  if (procedures.length > 0) {
    const procList = procedures.map(p =>
      `- **${p.name}** (${Math.round(p.success_rate * 100)}% success, ${p.usage_count}x used): ${p.description || ''}`
    ).join('\n');
    addSection('procedures', procList);
  }

  // 4. Previous session errors
  const prevErrors = db.prepare(
    `SELECT e.errors_encountered, e.outcome, s.started_at
     FROM episodic_memory e
     JOIN sessions s ON e.session_id = s.id
     WHERE s.project_path = ? AND e.outcome != 'success'
     ORDER BY s.started_at DESC LIMIT 3`
  ).all(projectDir) as Array<{ errors_encountered: string; outcome: string; started_at: string }>;

  if (prevErrors.length > 0) {
    const errorList = prevErrors.map(e => {
      let errors: string[];
      try { errors = JSON.parse(e.errors_encountered || '[]'); } catch (_ex) { errors = []; }
      return errors.slice(0, 3).map((err: string) => `- ${err}`).join('\n');
    }).join('\n');
    if (errorList.trim()) {
      addSection('past_errors', `Errors from previous sessions:\n${errorList}`);
    }
  }

  // 5. Pending LLM consolidations
  const pendingConsolidations = db.prepare(
    `SELECT id, prompt, category, priority FROM pending_consolidations
     WHERE status = 'pending'
     ORDER BY priority DESC, created_at ASC
     LIMIT 3`
  ).all() as Array<{ id: string; prompt: string; category: string; priority: number }>;

  if (pendingConsolidations.length > 0) {
    const consolidationBlocks = pendingConsolidations.map(pc => pc.prompt).join('\n\n');
    addSection('pending_consolidations', consolidationBlocks);

    const markInjected = db.prepare(
      `UPDATE pending_consolidations SET status = 'injected', injected_at = datetime('now') WHERE id = ?`
    );
    for (const pc of pendingConsolidations) {
      markInjected.run(pc.id);
    }
  }

  // 6. Current session tracking
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, project_path, project_name, personality_mode, status, started_at)
    VALUES (?, ?, ?, ?, 'active', datetime('now'))
  `).run(
    sessionId,
    projectDir,
    projectDir.split(/[/\\]/).pop() || projectDir,
    personalityMode
  );

  return context.length > 0 ? context.join('\n\n') : null;
}
