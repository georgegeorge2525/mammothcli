// src/services/mammoth/quality/elo.ts — PluginEval Elo Ranking System
// Ported from mammoth/quality/elo.js
// Head-to-head skill comparison using standard Elo with K=32.
// Bootstrap confidence intervals (500 resamples, percentile method).
// State persisted to state/elo-ratings.json with atomic writes.

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs'
import { ELO_DEFAULTS } from '../../constants/mammoth'

export interface EloRating {
  skillName: string
  rating: number        // baseline 1500, K=32
  confidence: number    // bootstrap CI half-width
  matches: number
}

interface RatingEntry {
  rating: number
  matches: number
  wins: number
  losses: number
  draws: number
  ci_lower: number
  ci_upper: number
  history: MatchRecord[]
}

interface MatchRecord {
  opponent: string
  result: 'win' | 'loss' | 'draw'
  timestamp: string
}

// ── Module-level ratings state ──

let _ratings: Record<string, RatingEntry> = {}
let _stateFile: string | null = null

const K_FACTOR = ELO_DEFAULTS.K_FACTOR
const BASELINE = ELO_DEFAULTS.BASELINE
const BOOTSTRAP_SAMPLES = ELO_DEFAULTS.BOOTSTRAP_SAMPLES

// ── Core Elo calculation ──

export function calculateElo(winner: number, loser: number, k = K_FACTOR): [number, number] {
  const eWinner = 1 / (1 + Math.pow(10, (loser - winner) / 400))
  const eLoser = 1 / (1 + Math.pow(10, (winner - loser) / 400))

  const newWinner = Math.round(winner + k * (1 - eWinner))
  const newLoser = Math.round(loser + k * (0 - eLoser))

  return [newWinner, newLoser]
}

// ── Rating management ──

function createEntry(): RatingEntry {
  return {
    rating: BASELINE,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    ci_lower: BASELINE,
    ci_upper: BASELINE,
    history: []
  }
}

export function updateRating(skillName: string, opponentName: string, won: boolean): void {
  // Ensure both skills exist
  if (!_ratings[skillName]) _ratings[skillName] = createEntry()
  if (!_ratings[opponentName]) _ratings[opponentName] = createEntry()

  const ratingA = _ratings[skillName].rating
  const ratingB = _ratings[opponentName].rating

  const eA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
  const eB = 1 / (1 + Math.pow(10, (ratingA - ratingB) / 400))

  const sA = won ? 1 : 0
  const sB = won ? 0 : 1

  const newRatingA = Math.round(ratingA + K_FACTOR * (sA - eA))
  const newRatingB = Math.round(ratingB + K_FACTOR * (sB - eB))

  // Update A
  _ratings[skillName].rating = newRatingA
  _ratings[skillName].matches++
  if (won) _ratings[skillName].wins++
  else _ratings[skillName].losses++
  _ratings[skillName].history.push({
    opponent: opponentName,
    result: won ? 'win' : 'loss',
    timestamp: new Date().toISOString()
  })

  // Update B
  _ratings[opponentName].rating = newRatingB
  _ratings[opponentName].matches++
  if (won) _ratings[opponentName].losses++
  else _ratings[opponentName].wins++
  _ratings[opponentName].history.push({
    opponent: skillName,
    result: won ? 'loss' : 'win',
    timestamp: new Date().toISOString()
  })

  // Recompute all confidence intervals
  recomputeConfidence()
}

export function getRatings(): EloRating[] {
  return Object.entries(_ratings)
    .map(([skillName, data]) => {
      const ciHalfWidth = Math.round((data.ci_upper - data.ci_lower) / 2)
      return {
        skillName,
        rating: data.rating,
        confidence: ciHalfWidth,
        matches: data.matches
      }
    })
    .sort((a, b) => b.rating - a.rating)
}

export function resetRatings(): void {
  _ratings = {}
}

// ── Bootstrap confidence ──

function recomputeConfidence(): void {
  const skillNames = Object.keys(_ratings).filter(
    name => _ratings[name].history && _ratings[name].history.length > 0
  )

  for (const skillName of skillNames) {
    const ci = bootstrapSkill(skillName)
    _ratings[skillName].ci_lower = ci.lower
    _ratings[skillName].ci_upper = ci.upper
  }
}

function bootstrapSkill(skillName: string): { lower: number; upper: number } {
  const skill = _ratings[skillName]
  if (!skill || !skill.history || skill.history.length === 0) {
    return { lower: BASELINE, upper: BASELINE }
  }

  const history = skill.history
  const iterations = BOOTSTRAP_SAMPLES
  const ratings: number[] = []

  for (let b = 0; b < iterations; b++) {
    let rating = BASELINE
    for (let i = 0; i < history.length; i++) {
      const idx = Math.floor(Math.random() * history.length)
      const match = history[idx]
      const opponentRating = (_ratings[match.opponent] && _ratings[match.opponent].rating) || BASELINE
      const S = match.result === 'win' ? 1 : match.result === 'loss' ? 0 : 0.5
      const E = 1 / (1 + Math.pow(10, (opponentRating - rating) / 400))
      rating = rating + K_FACTOR * (S - E)
    }
    ratings.push(rating)
  }

  ratings.sort((a, b) => a - b)
  const ciLower = Math.round(ratings[Math.floor(iterations * 0.025)])
  const ciUpper = Math.round(ratings[Math.floor(iterations * 0.975)])

  return { lower: ciLower, upper: ciUpper }
}

// ── Persistence ──

export function loadRatings(path: string): void {
  _stateFile = path
  try {
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf8'))
      if (data && data.ratings) {
        _ratings = data.ratings
      }
    }
  } catch {
    _ratings = {}
  }
}

export function saveRatings(path: string): void {
  _stateFile = path
  const data = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ratings: _ratings
  }

  try {
    const dir = path.substring(0, path.lastIndexOf('/'))
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const tmpFile = path + '.tmp'
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmpFile, path)
  } catch (e) {
    // Persistence is best-effort
  }
}
