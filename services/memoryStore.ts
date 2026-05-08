// src/services/mammoth/memoryStore.ts — MemoryManager: 4-tier consolidation system
// Ported from Mammoth memory/index.js, adapted for unified schema
//
// Tiers: working → episodic → semantic → procedural
// Consolidation based on reinforcement count, age, and relevance.
// Exponential decay: factor *= e^(-lambda * deltaT) with lambda = ln(2) / halfLifeHours.

import type { MemoryEntry, MemoryTier } from '../types/mammoth'
import { MEMORY_DEFAULTS, MEMORY_TIERS } from '../constants/mammoth'

// ── Native modules ──

import { Database } from 'bun:sqlite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import pathMod from 'node:path'

// ── Constants ──

const EVICTION_THRESHOLD = 0.05
const DEDUP_SIMILARITY_THRESHOLD = 0.75

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'that', 'this', 'it',
  'its', 'and', 'but', 'or', 'if', 'while', 'about', 'up', 'out',
  'what', 'which', 'who', 'whom'
])

// ── Helpers ──

function isoNow(): string {
  return new Date().toISOString()
}

function uuid12(): string {
  // crypto.randomUUID is available in Node 19+/modern runtimes
  return crypto.randomUUID().slice(0, 12)
}

// ── MemoryManager ──

export class MemoryManager {
  private db: any // bun:sqlite Database
  private dbPath: string
  private tokenBudget: number
  private halfLifeHours: number
  private dedupWindowMs: number
  private decayTimer: ReturnType<typeof setInterval> | null = null
  private maintainCount = 0

  constructor(
    dbPath: string,
    options?: {
      tokenBudget?: number
      halfLifeHours?: number
      dedupWindowMs?: number
    }
  ) {
    this.dbPath = dbPath
    this.tokenBudget = options?.tokenBudget ?? MEMORY_DEFAULTS.TOKEN_BUDGET
    this.halfLifeHours = options?.halfLifeHours ?? MEMORY_DEFAULTS.HALF_LIFE_HOURS
    this.dedupWindowMs = options?.dedupWindowMs ?? MEMORY_DEFAULTS.DEDUP_WINDOW_MS

    const dir = pathMod.dirname(this.dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.initDB()
  }

  // ── Schema Initialization ──

  private initDB(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL CHECK(tier IN ('working','episodic','semantic','procedural')),
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        last_reinforced_at TEXT NOT NULL,
        decay_factor REAL NOT NULL DEFAULT 1.0,
        reinforcement_count INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','priority'))
      );
    `)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_priority ON memories(priority);`)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_embeddings (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        token_vector TEXT NOT NULL
      );
    `)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_search_embeddings_memory ON search_embeddings(memory_id);`)
  }

  // ── Row → MemoryEntry mapping ──

  private rowToEntry(row: any): MemoryEntry {
    let tags: string[] = []
    try {
      tags = JSON.parse(row.tags || '[]')
    } catch {
      tags = []
    }
    return {
      id: row.id,
      tier: row.tier as MemoryTier,
      content: row.content,
      tags,
      createdAt: row.created_at,
      lastReinforcedAt: row.last_reinforced_at,
      decayFactor: row.decay_factor,
      source: row.source,
      priority: row.priority as 'normal' | 'priority',
    }
  }

  // ── Observe ──

  async observe(
    content: string,
    tags: string[],
    source: string,
    priority: 'normal' | 'priority' = 'normal'
  ): Promise<string> {
    const id = `mem_${uuid12()}`
    const now = isoNow()
    const contentTruncated = String(content).slice(0, 10000)

    this.db
      .prepare(
        `INSERT INTO memories (id, tier, content, tags, created_at, last_reinforced_at,
         decay_factor, reinforcement_count, source, priority)
         VALUES (?, 'working', ?, ?, ?, ?, 1.0, 1, ?, ?)`
      )
      .run(id, contentTruncated, JSON.stringify(tags), now, now, source, priority)

    await this.indexForSearch(id)
    return id
  }

  // ── Consolidate ──

  async consolidate(): Promise<number> {
    let promoted = 0
    const now = Date.now()

    // Working → Episodic: reinforced >= 2 OR (age > working TTL AND reinforced >= 1)
    const workingTTL = MEMORY_TIERS.working.ttlHours
    const workingEntries = this.db
      .prepare(`SELECT * FROM memories WHERE tier = 'working'`)
      .all()

    for (const entry of workingEntries) {
      const ageHours = (now - new Date(entry.created_at).getTime()) / (1000 * 60 * 60)
      if (entry.reinforcement_count >= 2 || (ageHours > workingTTL && entry.reinforcement_count >= 1)) {
        this.db
          .prepare(`UPDATE memories SET tier = 'episodic' WHERE id = ?`)
          .run(entry.id)
        promoted++
        await this.indexForSearch(entry.id)
      }
    }

    // Episodic → Semantic: reinforced >= 3 AND age > episodic TTL
    const episodicTTL = MEMORY_TIERS.episodic.ttlHours
    const episodicEntries = this.db
      .prepare(`SELECT * FROM memories WHERE tier = 'episodic'`)
      .all()

    for (const entry of episodicEntries) {
      const ageHours = (now - new Date(entry.created_at).getTime()) / (1000 * 60 * 60)
      if (entry.reinforcement_count >= 3 && ageHours > episodicTTL) {
        this.db
          .prepare(`UPDATE memories SET tier = 'semantic' WHERE id = ?`)
          .run(entry.id)
        promoted++
        await this.indexForSearch(entry.id)
      }
    }

    // Semantic → Procedural: reinforced >= 5 AND age > semantic TTL
    const semanticTTL = MEMORY_TIERS.semantic.ttlHours
    const semanticEntries = this.db
      .prepare(`SELECT * FROM memories WHERE tier = 'semantic' AND reinforcement_count >= 5`)
      .all()

    for (const entry of semanticEntries) {
      const ageHours = (now - new Date(entry.created_at).getTime()) / (1000 * 60 * 60)
      if (ageHours > semanticTTL) {
        this.db
          .prepare(`UPDATE memories SET tier = 'procedural' WHERE id = ?`)
          .run(entry.id)
        promoted++
        await this.indexForSearch(entry.id)
      }
    }

    return promoted
  }

  // ── Decay ──

  async decay(): Promise<number> {
    const now = Date.now()
    const lambda = Math.LN2 / this.halfLifeHours // ln(2) / halfLifeHours

    const all = this.db
      .prepare(
        `SELECT id, last_reinforced_at, decay_factor FROM memories`
      )
      .all()

    const update = this.db.prepare(
      `UPDATE memories SET decay_factor = ? WHERE id = ?`
    )

    let updated = 0
    for (const row of all) {
      const hoursSince =
        (now - new Date(row.last_reinforced_at).getTime()) / (1000 * 60 * 60)
      const timeDecay = Math.exp(-lambda * hoursSince)
      const current = row.decay_factor ?? 1.0
      // Only decrease — never overwrite a reinforced value with a higher time-based one
      const factor = Math.min(current, timeDecay)
      if (Math.abs(factor - current) > 0.0001) {
        update.run(factor, row.id)
        updated++
      }
    }

    // Evict entries below threshold
    const result = this.db
      .prepare(`DELETE FROM memories WHERE decay_factor < ?`)
      .run(EVICTION_THRESHOLD)

    return result.changes
  }

  // ── Deduplicate ──

  async deduplicate(): Promise<number> {
    const windowStart = new Date(Date.now() - this.dedupWindowMs).toISOString()

    const recent = this.db
      .prepare(
        `SELECT * FROM memories WHERE created_at >= ? ORDER BY created_at ASC`
      )
      .all(windowStart)

    if (recent.length < 2) return 0

    const merged = new Set<string>()
    const keptIds = new Set<string>()

    for (let i = 0; i < recent.length; i++) {
      if (merged.has(recent[i].id)) continue
      for (let j = i + 1; j < recent.length; j++) {
        if (merged.has(recent[j].id)) continue
        if (recent[i].tier !== recent[j].tier) continue

        const similarity = cosineSimilarity(recent[i].content, recent[j].content)
        if (similarity >= DEDUP_SIMILARITY_THRESHOLD) {
          // Merge j into i: keep the older entry, update its decay_factor and reinforcement_count
          const survivor = recent[i]
          const victim = recent[j]

          const boostedDecay = Math.min(1.0, survivor.decay_factor + 0.1)
          const mergedReinforcement =
            survivor.reinforcement_count + victim.reinforcement_count
          const mergedTags = mergeTags(
            this.rowToEntry(survivor).tags,
            this.rowToEntry(victim).tags
          )

          this.db
            .prepare(
              `UPDATE memories SET decay_factor = ?, reinforcement_count = ?, tags = ? WHERE id = ?`
            )
            .run(boostedDecay, mergedReinforcement, JSON.stringify(mergedTags), survivor.id)

          this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(victim.id)

          merged.add(victim.id)
          keptIds.add(survivor.id)
        }
      }
    }

    return merged.size
  }

  // ── Search ──

  async search(
    query: string,
    options?: {
      tiers?: MemoryTier[]
      limit?: number
      minDecay?: number
      tags?: string[]
    }
  ): Promise<MemoryEntry[]> {
    const { tiers, limit = 10, minDecay = EVICTION_THRESHOLD, tags } = options ?? {}
    const likeTerm = `%${String(query).replace(/[%_]/g, '\\$&')}%`

    let sql = `SELECT * FROM memories WHERE content LIKE ? AND decay_factor >= ?`
    const params: any[] = [likeTerm, minDecay]

    if (tiers && tiers.length > 0) {
      sql += ` AND tier IN (${tiers.map(() => '?').join(',')})`
      params.push(...tiers)
    }

    if (tags && tags.length > 0) {
      // tags stored as JSON string — match any of the requested tags
      const tagConditions = tags.map(() => `tags LIKE ?`).join(' OR ')
      sql += ` AND (${tagConditions})`
      params.push(...tags.map((t) => `%${t}%`))
    }

    sql += ` ORDER BY decay_factor DESC, reinforcement_count DESC LIMIT ?`
    params.push(limit)

    const rows = this.db.prepare(sql).all(...params)
    return rows.map((r: any) => this.rowToEntry(r))
  }

  // ── Semantic Search ──

  /**
   * Build a token frequency vector from text.
   * Lowercase, strip punctuation, split on whitespace, filter stop words, count frequencies.
   */
  private tokenize(text: string): Map<string, number> {
    const vec = new Map<string, number>()
    const tokens = String(text)
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    for (const t of tokens) {
      vec.set(t, (vec.get(t) || 0) + 1)
    }
    return vec
  }

  /**
   * Compute cosine similarity between two token frequency vectors.
   * cosine = dot(a, b) / (||a|| * ||b||)
   */
  private cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    if (a.size === 0 || b.size === 0) return 0

    const allKeys = new Set([...a.keys(), ...b.keys()])
    let dotProduct = 0
    let magnitudeA = 0
    let magnitudeB = 0

    for (const key of allKeys) {
      const aVal = a.get(key) || 0
      const bVal = b.get(key) || 0
      dotProduct += aVal * bVal
      magnitudeA += aVal * aVal
      magnitudeB += bVal * bVal
    }

    const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB)
    if (denominator === 0) return 0
    return dotProduct / denominator
  }

  /**
   * Index a memory entry for semantic search.
   * Extracts token vector from content and stores it in search_embeddings.
   */
  async indexForSearch(id: string): Promise<void> {
    const row = this.db.prepare(`SELECT content FROM memories WHERE id = ?`).get(id)
    if (!row) return

    const vector = this.tokenize(row.content)
    const json = JSON.stringify(Object.fromEntries(vector))

    this.db
      .prepare(
        `INSERT OR REPLACE INTO search_embeddings (memory_id, token_vector) VALUES (?, ?)`
      )
      .run(id, json)
  }

  /**
   * Semantic search — returns entries ranked by cosine similarity to query.
   * Uses TF-IDF (token frequency) vectors stored in search_embeddings.
   */
  async semanticSearch(
    query: string,
    options?: {
      tiers?: MemoryTier[]
      limit?: number
      minSimilarity?: number
      tags?: string[]
    }
  ): Promise<Array<MemoryEntry & { similarity: number }>> {
    const { tiers, limit = 10, minSimilarity = 0.3, tags } = options ?? {}

    // Build query vector
    const queryVector = this.tokenize(query)
    if (queryVector.size === 0) return []

    // Get candidate embeddings, filtered by tier/tags if specified
    let sql = `SELECT se.memory_id, se.token_vector, m.id, m.tier, m.content, m.tags,
               m.created_at, m.last_reinforced_at, m.decay_factor,
               m.reinforcement_count, m.source, m.priority
               FROM search_embeddings se
               JOIN memories m ON se.memory_id = m.id
               WHERE m.decay_factor >= ?`
    const params: any[] = [EVICTION_THRESHOLD]

    if (tiers && tiers.length > 0) {
      sql += ` AND m.tier IN (${tiers.map(() => '?').join(',')})`
      params.push(...tiers)
    }

    if (tags && tags.length > 0) {
      const tagConditions = tags.map(() => `m.tags LIKE ?`).join(' OR ')
      sql += ` AND (${tagConditions})`
      params.push(...tags.map((t) => `%${t}%`))
    }

    const rows = this.db.prepare(sql).all(...params)

    // Compute similarities
    const results: Array<MemoryEntry & { similarity: number }> = []
    for (const row of rows) {
      const vectorObj: Record<string, number> = JSON.parse(row.token_vector || '{}')
      const vectorMap = new Map<string, number>(Object.entries(vectorObj))
      const similarity = this.cosineSimilarity(queryVector, vectorMap)
      if (similarity >= minSimilarity) {
        const { token_vector, ...entryRow } = row
        results.push({ ...this.rowToEntry(entryRow), similarity: Number(similarity.toFixed(4)) })
      }
    }

    // Sort by similarity desc
    results.sort((a, b) => b.similarity - a.similarity)
    return results.slice(0, limit)
  }

  /**
   * Hybrid search — combines lexical (LIKE) and semantic (cosine similarity) results.
   * finalScore = lexicalWeight * normalizedLexicalScore + semanticWeight * similarityScore
   */
  async hybridSearch(
    query: string,
    options?: {
      tiers?: MemoryTier[]
      limit?: number
      lexicalWeight?: number
      semanticWeight?: number
    }
  ): Promise<Array<MemoryEntry & { score: number }>> {
    const {
      tiers,
      limit = 10,
      lexicalWeight = 0.3,
      semanticWeight = 0.7,
    } = options ?? {}

    // Get both result sets in parallel
    const [semanticResults, lexicalResults] = await Promise.all([
      this.semanticSearch(query, { tiers, limit: 100, minSimilarity: 0.1 }),
      this.search(query, { tiers, limit: 100 }),
    ])

    // Merge: build score map keyed by memory id
    const scoreMap = new Map<
      string,
      { entry: MemoryEntry; semanticScore: number; lexicalMatch: boolean }
    >()

    for (const r of semanticResults) {
      const { similarity, ...entry } = r
      scoreMap.set(entry.id, { entry, semanticScore: similarity, lexicalMatch: false })
    }

    for (const r of lexicalResults) {
      const existing = scoreMap.get(r.id)
      if (existing) {
        existing.lexicalMatch = true
      } else {
        scoreMap.set(r.id, { entry: r, semanticScore: 0, lexicalMatch: true })
      }
    }

    // Compute final scores
    const scored: Array<MemoryEntry & { score: number }> = []
    for (const { entry, semanticScore, lexicalMatch } of scoreMap.values()) {
      const score =
        lexicalWeight * (lexicalMatch ? 1.0 : 0.0) + semanticWeight * semanticScore
      scored.push({ ...entry, score: Number(score.toFixed(4)) })
    }

    // Sort by score desc
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  }

  /**
   * Rebuild all search embeddings from current memories.
   * Useful for migration or after bulk changes.
   */
  async rebuildSearchIndex(): Promise<number> {
    // Clear existing embeddings
    this.db.prepare(`DELETE FROM search_embeddings`).run()

    // Rebuild from all memories
    const rows = this.db.prepare(`SELECT id, content FROM memories`).all()

    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO search_embeddings (memory_id, token_vector) VALUES (?, ?)`
    )

    for (const row of rows) {
      const vector = this.tokenize(row.content)
      const json = JSON.stringify(Object.fromEntries(vector))
      insert.run(row.id, json)
    }

    return rows.length
  }

  // ── Inject ──

  async inject(
    options?: {
      tiers?: MemoryTier[]
      tokenBudget?: number
      priorityOnly?: boolean
    }
  ): Promise<string> {
    const {
      tiers,
      tokenBudget = this.tokenBudget,
      priorityOnly = false,
    } = options ?? {}

    let sql = `SELECT * FROM memories WHERE decay_factor >= ?`
    const params: any[] = [EVICTION_THRESHOLD]

    if (tiers && tiers.length > 0) {
      sql += ` AND tier IN (${tiers.map(() => '?').join(',')})`
      params.push(...tiers)
    }

    if (priorityOnly) {
      sql += ` AND priority = 'priority'`
    }

    sql += ` ORDER BY priority DESC, decay_factor DESC, reinforcement_count DESC`

    const rows = this.db.prepare(sql).all(...params)
    const entries = rows.map((r: any) => this.rowToEntry(r))

    if (entries.length === 0) return ''

    const maxChars = tokenBudget * 4
    const sections: string[] = []
    let charsUsed = 0

    function addSection(title: string, content: string) {
      if (!content || charsUsed >= maxChars) return
      const section = `<memory:${title}>\n${content}\n</memory:${title}>`
      if (charsUsed + section.length > maxChars) {
        const remaining = maxChars - charsUsed - 50
        if (remaining < 100) return
        sections.push(section.slice(0, remaining) + '\n...')
        charsUsed = maxChars
        return
      }
      sections.push(section)
      charsUsed += section.length
    }

    // Group entries by tier
    const byTier: Record<string, MemoryEntry[]> = {}
    for (const entry of entries) {
      if (!byTier[entry.tier]) byTier[entry.tier] = []
      byTier[entry.tier].push(entry)
    }

    // Inject procedural first (most valuable), then semantic, episodic, working
    const tierOrder: MemoryTier[] = ['procedural', 'semantic', 'episodic', 'working']
    for (const tier of tierOrder) {
      const tierEntries = byTier[tier]
      if (!tierEntries || tierEntries.length === 0) continue

      const items = tierEntries
        .map((e) => {
          const tagStr = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : ''
          return `- [${e.priority === 'priority' ? '!' : ' '}] ${e.content}${tagStr}`
        })
        .join('\n')
      addSection(tier, items)
    }

    return sections.join('\n\n')
  }

  // ── Reinforce ──

  async reinforce(id: string): Promise<void> {
    const row = this.db
      .prepare(`SELECT id FROM memories WHERE id = ?`)
      .get(id)

    if (!row) return

    const now = isoNow()
    this.db
      .prepare(
        `UPDATE memories SET decay_factor = 1.0, last_reinforced_at = ?,
         reinforcement_count = reinforcement_count + 1
         WHERE id = ?`
      )
      .run(now, id)
  }

  // ── Maintenance ──

  async maintain(): Promise<{
    consolidated: number
    decayed: number
    deduplicated: number
  }> {
    const consolidated = await this.consolidate()
    const decayed = await this.decay()
    const deduplicated = await this.deduplicate()

    this.maintainCount++
    if (this.maintainCount % 10 === 0) {
      await this.rebuildSearchIndex()
    }

    return { consolidated, decayed, deduplicated }
  }

  startMaintenance(): void {
    if (this.decayTimer) return
    // Run maintenance every hour
    this.decayTimer = setInterval(() => {
      this.maintain().catch(() => {
        // Silently ignore errors during periodic maintenance
      })
    }, 60 * 60 * 1000)
  }

  stopMaintenance(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer)
      this.decayTimer = null
    }
  }

  // ── Get All Memories ──

  getAll(): MemoryEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories ORDER BY tier, created_at ASC`)
      .all()
    return rows.map((r: any) => this.rowToEntry(r))
  }

  // ── Stats ──

  getStats(): {
    total: number
    byTier: Record<MemoryTier, number>
    oldestEntry: string
    newestEntry: string
  } {
    const total =
      this.db.prepare(`SELECT COUNT(*) as cnt FROM memories`).get().cnt

    const byTier: Record<MemoryTier, number> = {
      working: 0,
      episodic: 0,
      semantic: 0,
      procedural: 0,
    }
    const tierRows = this.db
      .prepare(`SELECT tier, COUNT(*) as cnt FROM memories GROUP BY tier`)
      .all()
    for (const row of tierRows) {
      if (row.tier in byTier) {
        byTier[row.tier as MemoryTier] = row.cnt
      }
    }

    const oldest = this.db
      .prepare(`SELECT created_at FROM memories ORDER BY created_at ASC LIMIT 1`)
      .get()
    const newest = this.db
      .prepare(`SELECT created_at FROM memories ORDER BY created_at DESC LIMIT 1`)
      .get()

    return {
      total,
      byTier,
      oldestEntry: oldest?.created_at ?? '',
      newestEntry: newest?.created_at ?? '',
    }
  }

  // ── Close ──

  close(): void {
    this.stopMaintenance()
    this.db.close()
  }
}

// ── Private Helpers (module-level) ──

/**
 * Compute cosine similarity between two strings using word frequency vectors.
 */
function cosineSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a)
  const tokensB = tokenize(b)

  if (tokensA.length === 0 || tokensB.length === 0) return 0

  const freqA = wordFrequencies(tokensA)
  const freqB = wordFrequencies(tokensB)

  const allWords = new Set([...Object.keys(freqA), ...Object.keys(freqB)])

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (const word of allWords) {
    const aVal = freqA[word] || 0
    const bVal = freqB[word] || 0
    dotProduct += aVal * bVal
    magnitudeA += aVal * aVal
    magnitudeB += bVal * bVal
  }

  const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

function tokenize(text: string): string[] {
  return String(text)
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

function wordFrequencies(tokens: string[]): Record<string, number> {
  const freq: Record<string, number> = {}
  for (const t of tokens) {
    freq[t] = (freq[t] || 0) + 1
  }
  return freq
}

function mergeTags(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])]
}

export default MemoryManager
