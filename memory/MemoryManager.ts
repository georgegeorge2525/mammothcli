import crypto from 'node:crypto';
import { Database } from 'bun:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, isDuplicate, shouldDedup } from './dedup.js';
import { reinforce, evictStale, updateDecayFactors } from './decay.js';
import { searchObservations, searchSemantic, searchProcedural } from './search.js';
import { injectContext } from './inject.js';
import { runFullPipeline, processLlmConsolidationResult } from './consolidate.js';
import type {
  ObserveInput, ConsolidationResult, MemoryStats, SearchOptions,
  SearchResults, InjectOptions, MaintenanceReport, SessionStats, MemorySession
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MemoryManager {
  private db: Database;
  private _closed = false;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.join(process.cwd(), '.mammoth', 'state', 'memory.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolvedPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this._initSchema();
  }

  private _initSchema(): void {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  observe(input: ObserveInput): string | null {
    const {
      sessionId,
      observation,
      source = 'tool_use',
      toolName,
      toolInput,
      toolOutput
    } = input;

    try {
      const h = hash(observation, toolName || '', toolInput);
      if (shouldDedup(source) && isDuplicate(this.db, h)) return null;

      const id = `wm_${crypto.randomUUID().slice(0, 12)}`;

      this.db.prepare(`
        INSERT INTO working_memory (id, session_id, observation, source, tool_name, tool_input, tool_output, hash, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))
      `).run(
        id, sessionId,
        (observation || '').slice(0, 10000),
        source,
        toolName || null,
        toolInput ? JSON.stringify(toolInput).slice(0, 5000) : null,
        toolOutput ? String(toolOutput).slice(0, 5000) : null,
        h
      );

      // Update session tool call count
      this.db.prepare(`
        UPDATE sessions SET tool_call_count = tool_call_count + 1
        WHERE id = ?
      `).run(sessionId);

      return id;
    } catch (e) {
      console.error('MemoryManager.observe error:', e);
      return null;
    }
  }

  consolidate(sessionId: string): ConsolidationResult {
    return runFullPipeline(this.db, sessionId);
  }

  getContext(options: InjectOptions = {}): string | null {
    return injectContext(this.db, options);
  }

  search(query: string, options: SearchOptions = {}): SearchResults {
    return {
      observations: searchObservations(this.db, query, { limit: options.limit, sessionId: options.sessionId }) as SearchResults['observations'],
      semantic: searchSemantic(this.db, query, { limit: options.limit, category: options.category, minConfidence: options.minConfidence }) as SearchResults['semantic'],
      procedural: searchProcedural(this.db, query, { limit: options.limit }) as SearchResults['procedural'],
    };
  }

  reinforce(factId: string): boolean {
    const fact = this.db.prepare(
      'SELECT id, decay_factor FROM semantic_memory WHERE id = ?'
    ).get(factId) as { id: string; decay_factor: number } | undefined;

    if (!fact) return false;

    const newDecay = reinforce(fact.decay_factor);
    this.db.prepare(`
      UPDATE semantic_memory SET decay_factor = ?, last_reinforced_at = datetime('now'),
        access_count = access_count + 1, last_accessed = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(newDecay, factId);
    return true;
  }

  forget(factId: string): void {
    this.db.prepare('DELETE FROM semantic_memory WHERE id = ?').run(factId);
  }

  runMaintenance(): MaintenanceReport {
    const decayUpdates = updateDecayFactors(this.db);
    const evicted = evictStale(this.db);

    // Consolidate all sessions with pending working memory
    const sessions = this.db.prepare(
      `SELECT DISTINCT session_id FROM working_memory
       WHERE expires_at > datetime('now')`
    ).all() as Array<{ session_id: string }>;

    for (const s of sessions) {
      try { runFullPipeline(this.db, s.session_id); } catch (_e) { /* skip */ }
    }

    // Clean expired working memory
    const cleaned = this.db.prepare(
      `DELETE FROM working_memory WHERE expires_at < datetime('now')`
    ).run();

    // Clean stale procedures
    const procCleaned = this.db.prepare(`
      DELETE FROM procedural_memory
      WHERE success_rate < 0.2 AND usage_count < 3
        AND last_used < datetime('now', '-30 days')
    `).run();

    return {
      decayUpdates,
      evicted,
      cleanedObservations: cleaned.changes,
      proceduralCleaned: procCleaned.changes,
    };
  }

  checkIntegrity(): boolean {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const result = this.db.query('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    return result.length === 1 && result[0].integrity_check === 'ok';
  }

  getSessionStats(sessionId: string): SessionStats {
    const session = this.db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).get(sessionId) as MemorySession | undefined;

    const observationsBySource = this.db.prepare(
      `SELECT source, COUNT(*) as count FROM working_memory
       WHERE session_id = ? GROUP BY source`
    ).all(sessionId) as Array<{ source: string; count: number }>;

    const totalObservations = observationsBySource.reduce((sum, r) => sum + r.count, 0);

    return {
      sessionId,
      session: session || null,
      observationsBySource: Object.fromEntries(observationsBySource.map(r => [r.source, r.count])),
      totalObservations,
    };
  }

  getRecentSessions(limit = 10): MemorySession[] {
    return this.db.prepare(
      `SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?`
    ).all(limit) as MemorySession[];
  }

  getMemoryStats(): MemoryStats {
    const working = (this.db.prepare('SELECT COUNT(*) as c FROM working_memory').get() as { c: number }).c;
    const episodic = (this.db.prepare('SELECT COUNT(*) as c FROM episodic_memory').get() as { c: number }).c;
    const semantic = (this.db.prepare('SELECT COUNT(*) as c FROM semantic_memory').get() as { c: number }).c;
    const procedural = (this.db.prepare('SELECT COUNT(*) as c FROM procedural_memory').get() as { c: number }).c;
    const sessions = (this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;

    return { working, episodic, semantic, procedural, sessions };
  }

  endSession(sessionId: string, summary?: string): void {
    this.db.prepare(`
      UPDATE sessions SET status = 'ended', ended_at = datetime('now'), summary = ?
      WHERE id = ?
    `).run(summary || null, sessionId);
  }

  processLlmConsolidation(llmOutput: string, sessionId: string): string[] {
    return processLlmConsolidationResult(this.db, llmOutput, sessionId);
  }

  close(): void {
    if (!this._closed) {
      this.db.close();
      this._closed = true;
    }
  }
}
