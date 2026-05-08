import { Database } from 'bun:sqlite';

interface SearchResult {
  id: string;
  observation?: string;
  tool_name?: string;
  source?: string;
  created_at?: string;
  bm25_score: number;
}

interface SemanticResult {
  id: string;
  fact: string;
  category: string;
  confidence: number;
  decay_factor: number;
  access_count: number;
  last_accessed?: string;
  created_at: string;
}

interface ProceduralResult {
  id: string;
  name: string;
  description?: string;
  trigger_pattern?: string;
  steps: string;
  success_rate: number;
  usage_count: number;
}

function fallbackSearch(db: Database, terms: string, { limit = 10, sessionId = null as string | null } = {}): SearchResult[] {
  const likeTerm = `%${terms.replace(/[%_]/g, '\\$&')}%`;

  if (sessionId) {
    return db.prepare(
      `SELECT id, observation, tool_name, source, created_at, 0 AS bm25_score
       FROM working_memory
       WHERE observation LIKE ? AND session_id = ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(likeTerm, sessionId, limit) as SearchResult[];
  }

  return db.prepare(
    `SELECT id, observation, tool_name, source, created_at, 0 AS bm25_score
     FROM working_memory
     WHERE observation LIKE ?
     ORDER BY created_at DESC LIMIT ?`
  ).all(likeTerm, limit) as SearchResult[];
}

export function searchObservations(db: Database, query: string, { limit = 10, sessionId = null as string | null } = {}): SearchResult[] {
  const terms = String(query || '').trim();
  if (!terms) return [];

  try {
    if (sessionId) {
      return db.prepare(
        `SELECT wm.id, wm.observation, wm.tool_name, wm.source, wm.created_at,
                wmfts.rank AS bm25_score
         FROM working_memory_fts wmfts
         JOIN working_memory wm ON wm.rowid = wmfts.rowid
         WHERE working_memory_fts MATCH ?
           AND wm.session_id = ?
         ORDER BY bm25_score
         LIMIT ?`
      ).all(terms, sessionId, limit) as SearchResult[];
    }

    return db.prepare(
      `SELECT wm.id, wm.observation, wm.tool_name, wm.source, wm.created_at,
              wmfts.rank AS bm25_score
       FROM working_memory_fts wmfts
       JOIN working_memory wm ON wm.rowid = wmfts.rowid
       WHERE working_memory_fts MATCH ?
       ORDER BY bm25_score
       LIMIT ?`
    ).all(terms, limit) as SearchResult[];
  } catch (_e) {
    return fallbackSearch(db, terms, { limit, sessionId });
  }
}

export function searchSemantic(db: Database, query: string, { limit = 10, category = null as string | null, minConfidence = 0.3 } = {}): SemanticResult[] {
  const likeTerm = `%${String(query || '').trim().replace(/[%_]/g, '\\$&')}%`;

  let sql = `
    SELECT id, fact, category, confidence, decay_factor, access_count, last_accessed, created_at
    FROM semantic_memory
    WHERE fact LIKE ?
      AND confidence >= ?
      AND decay_factor > 0.05
  `;
  const params: (string | number)[] = [likeTerm, minConfidence];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY confidence * (1.0 - decay_factor) DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params) as SemanticResult[];
}

export function searchProcedural(db: Database, triggerText: string, { limit = 5 } = {}): ProceduralResult[] {
  const procedures = db.prepare(
    `SELECT id, name, description, trigger_pattern, steps, success_rate, usage_count
     FROM procedural_memory
     ORDER BY success_rate * usage_count DESC`
  ).all() as ProceduralResult[];

  const matched = procedures.filter(p => {
    if (!p.trigger_pattern) return false;
    try {
      return new RegExp(p.trigger_pattern, 'i').test(String(triggerText || ''));
    } catch (_e) {
      return false;
    }
  });

  return matched.slice(0, limit);
}
