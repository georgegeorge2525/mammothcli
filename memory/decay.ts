import { Database } from 'bun:sqlite';

export const DEFAULT_HALF_LIFE_HOURS = 168; // 7 days
export const EVICTION_THRESHOLD = 0.05;     // below 5% strength → evict
export const REINFORCEMENT_BOOST = 0.3;     // +0.3 strength on re-observation (cap 1.0)

export function decayFactor(lastReinforcedAt: string, halfLifeHours: number = DEFAULT_HALF_LIFE_HOURS): number {
  const hoursSince = (Date.now() - new Date(lastReinforcedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSince <= 0) return 1.0;
  return Math.exp(-hoursSince / halfLifeHours);
}

export function shouldEvict(record: { last_reinforced_at?: string; lastReinforcedAt?: string; created_at: string }): boolean {
  const factor = decayFactor(
    record.last_reinforced_at || record.lastReinforcedAt || record.created_at
  );
  return factor < EVICTION_THRESHOLD;
}

export function reinforce(currentFactor: number): number {
  return Math.min(1.0, (currentFactor || 0.5) + REINFORCEMENT_BOOST);
}

export function evictStale(db: Database): number {
  const stale = db.prepare(
    `SELECT id, last_reinforced_at, created_at FROM semantic_memory WHERE decay_factor < ?`
  ).all(EVICTION_THRESHOLD) as Array<{ id: string; last_reinforced_at: string; created_at: string }>;

  if (stale.length > 0) {
    const ids = stale.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM semantic_memory WHERE id IN (${placeholders})`).run(...ids);
  }

  return stale.length;
}

export function updateDecayFactors(db: Database): number {
  const all = db.prepare(
    'SELECT id, last_reinforced_at, created_at, decay_factor FROM semantic_memory'
  ).all() as Array<{ id: string; last_reinforced_at: string; created_at: string; decay_factor: number }>;

  const update = db.prepare(
    'UPDATE semantic_memory SET decay_factor = ? WHERE id = ?'
  );

  let updated = 0;
  for (const row of all) {
    const timeBased = decayFactor(
      row.last_reinforced_at || row.created_at,
      DEFAULT_HALF_LIFE_HOURS
    );
    const current = row.decay_factor || 1.0;
    const factor = Math.min(current, timeBased);
    if (Math.abs(factor - current) > 0.001) {
      update.run(factor, row.id);
      updated++;
    }
  }
  return updated;
}
