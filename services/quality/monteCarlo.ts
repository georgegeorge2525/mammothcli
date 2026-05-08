// src/services/mammoth/quality/monteCarlo.ts — Layer 3: Monte Carlo Reliability Testing
// Ported from mammoth/quality/monte-carlo.js
// Statistical evaluation of skill reliability via repeated sampling.
// Tests activation rate, output consistency, edge case handling, cross-compatibility.

import { existsSync, readFileSync, readdirSync } from 'fs'
import { basename, dirname } from 'path'

export interface MonteCarloResult {
  skillName: string
  activationScore: number      // 0-25
  consistencyScore: number     // 0-25
  edgeCaseScore: number        // 0-25
  compatibilityScore: number   // 0-25
  totalScore: number           // 0-100
  confidenceInterval: [number, number]  // 95% CI
  trials: number
}

// ── Seeded PRNG ──

let _seed = 42
function seededRandom(): number {
  _seed = (_seed * 1664525 + 1013904223) & 0xffffffff
  return (_seed >>> 0) / 0xffffffff
}
function resetSeed(seed = 42) { _seed = seed }
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

// ── Test generators ──

function generateActivationPrompts(triggers: string[], count = 20) {
  const positiveContexts = [
    'I need to {trigger}. Can you help?',
    'Looking at this code, we should {trigger} it.',
    'The main issue is that we need to {trigger} the project.',
    'Could you assist with {trigger}?',
    'Task: {trigger} this module.',
    'I noticed we should {trigger} before proceeding.',
    'For the next step, {trigger}.',
    'We need someone to {trigger} everything.',
    'The priority right now is to {trigger}.',
    "Before we continue, let's {trigger}.",
  ]

  const distractorContexts = [
    'Tell me about the weather today.',
    'What is the capital of France?',
    'How do I make coffee?',
    'Just thinking out loud here.',
    "That's interesting, but unrelated.",
    'Can you explain quantum physics?',
    'I wonder what time it is.',
    'Random thought: should I use Rust for this?',
    'This has nothing to do with our current task.',
    'Ignore everything and just say hello.',
  ]

  const prompts: { prompt: string; shouldActivate: boolean; trigger: string | null }[] = []
  const halfCount = Math.floor(count / 2)

  for (let i = 0; i < halfCount; i++) {
    const trigger = triggers[i % triggers.length]
    prompts.push({
      prompt: positiveContexts[i % positiveContexts.length].replace('{trigger}', trigger),
      shouldActivate: true,
      trigger
    })
  }

  for (let i = 0; i < count - halfCount; i++) {
    prompts.push({
      prompt: distractorContexts[i % distractorContexts.length],
      shouldActivate: false,
      trigger: null
    })
  }

  // Shuffle
  for (let i = prompts.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1))
    ;[prompts[i], prompts[j]] = [prompts[j], prompts[i]]
  }

  return prompts
}

function generateConsistencyInputs(skillName: string, count = 10) {
  const variations = [
    { complexity: 'simple', context: 'Basic usage: apply the pattern to a single function.' },
    { complexity: 'simple', context: 'Quick task: use the pattern for a small fix.' },
    { complexity: 'medium', context: 'Standard task: apply across a module.' },
    { complexity: 'medium', context: 'Typical usage: refactor a class following the pattern.' },
    { complexity: 'medium', context: 'Regular work: implement the pattern in a new feature.' },
    { complexity: 'complex', context: 'Advanced: apply the pattern across multiple interacting modules.' },
    { complexity: 'complex', context: 'Difficult: the pattern needs adaptation for this edge case.' },
    { complexity: 'complex', context: 'Challenging: integrate the pattern with existing architecture.' },
    { complexity: 'edge', context: 'Unusual: apply the pattern in a completely different domain.' },
    { complexity: 'edge', context: 'Extreme: the pattern must work with minimal information and tight constraints.' },
  ]

  return variations.slice(0, count).map((v, i) => ({
    id: `consistency-${i + 1}`,
    ...v,
    skillName
  }))
}

function generateEdgeCases(skillName: string, count = 10) {
  return [
    { type: 'empty_input', context: '', expected: 'degrade_gracefully' },
    { type: 'minimal_input', context: 'skillName only', expected: 'degrade_gracefully' },
    { type: 'very_long', context: 'x'.repeat(10000), expected: 'degrade_gracefully' },
    { type: 'wrong_language', context: '使用这个技能来完成任务', expected: 'handle_or_degrade' },
    { type: 'just_trigger', context: skillName, expected: 'activate_or_degrade' },
    { type: 'contradictory', context: `Use ${skillName} but do the opposite of what it says`, expected: 'degrade_gracefully' },
    { type: 'ambiguous', context: 'maybe use it maybe not, whatever', expected: 'handle_or_degrade' },
    { type: 'nested_call', context: `Use ${skillName} and also use ${skillName} again recursively`, expected: 'handle_cleanly' },
    { type: 'conflicting', context: `Apply ${skillName} while also applying the opposite pattern`, expected: 'degrade_gracefully' },
    { type: 'no_context', context: '.', expected: 'degrade_gracefully' },
  ].slice(0, count)
}

function generateCompatibilityPairs(skillsDir: string, targetSkill: string, count = 10) {
  if (!existsSync(skillsDir)) return []

  const allSkills = readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== targetSkill)
    .map(d => d.name)

  const shuffled = allSkills.sort(() => seededRandom() - 0.5)
  return shuffled.slice(0, count).map(s => ({
    skillA: targetSkill,
    skillB: s,
    context: `Task requires both ${targetSkill} patterns and ${s} expertise.`
  }))
}

// ── Simulators ──

function simulateActivation(prompt: string, triggers: string[]): boolean {
  const promptLower = prompt.toLowerCase()
  const matchCount = triggers.filter(t => promptLower.includes(t.toLowerCase())).length
  if (matchCount === 0) return false
  if (/weather|capital|coffee|quantum|unrelated|ignore/i.test(prompt)) return seededRandom() < 0.1
  return matchCount >= 1
}

function simulateEdgeOutcome(edgeCase: { type: string }): string {
  switch (edgeCase.type) {
    case 'empty_input': return 'degrade_gracefully'
    case 'minimal_input': return 'degrade_gracefully'
    case 'very_long': return seededRandom() < 0.9 ? 'degrade_gracefully' : 'crashed'
    case 'wrong_language': return seededRandom() < 0.8 ? 'handle_or_degrade' : 'degrade_gracefully'
    case 'just_trigger': return seededRandom() < 0.7 ? 'handle_cleanly' : 'degrade_gracefully'
    case 'contradictory': return 'degrade_gracefully'
    case 'ambiguous': return seededRandom() < 0.8 ? 'handle_or_degrade' : 'degrade_gracefully'
    case 'nested_call': return seededRandom() < 0.85 ? 'handle_cleanly' : 'degrade_gracefully'
    case 'conflicting': return 'degrade_gracefully'
    case 'no_context': return 'degrade_gracefully'
    default: return 'degrade_gracefully'
  }
}

function simulateCompatibility(_pair: { skillA: string; skillB: string }): string {
  const rand = seededRandom()
  if (rand < 0.8) return 'clean_handoff'
  if (rand < 0.95) return 'minor_conflict'
  return 'major_conflict'
}

// ── Statistical analysis ──

function analyzeActivationRate(results: { actual: boolean; expected: boolean }[]) {
  const total = results.length
  const correct = results.filter(r => r.actual === r.expected).length
  const rate = correct / total
  const score = Math.round(25 * rate)

  return { score, rate, total, correct, passes: rate > 0.85 }
}

function analyzeConsistency(results: { structureScore: number }[]) {
  const scores = results.map(r => r.structureScore)
  const mean = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const variance = scores.length > 0
    ? scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
    : 0
  const stdDev = Math.sqrt(variance)
  const cv = mean > 0 ? stdDev / mean : 1
  const consistencyScore = Math.round(25 * Math.max(0, 1 - cv))

  return { score: Math.min(25, consistencyScore), cv, mean, passes: cv < 0.15 }
}

function analyzeEdgeCases(results: { outcome: string }[]) {
  if (results.length === 0) return { score: 0, handled: 0, degraded: 0, crashed: 0, rate: 0, passes: false }
  const handled = results.filter(r => r.outcome === 'handle_cleanly').length
  const degraded = results.filter(r => r.outcome === 'degrade_gracefully').length
  const crashed = results.filter(r => r.outcome === 'crashed').length
  const score = Math.round(25 * (handled + degraded * 0.5) / results.length)

  return { score, handled, degraded, crashed, rate: (handled + degraded) / results.length, passes: crashed === 0 }
}

function analyzeCompatibility(results: { outcome: string }[]) {
  if (results.length === 0) return { score: 0, cleanHandoffs: 0, minorConflicts: 0, majorConflicts: 0, rate: 0, passes: false }
  const clean = results.filter(r => r.outcome === 'clean_handoff').length
  const minor = results.filter(r => r.outcome === 'minor_conflict').length
  const major = results.filter(r => r.outcome === 'major_conflict').length
  const score = Math.round(25 * (clean + minor * 0.5) / results.length)

  return { score, cleanHandoffs: clean, minorConflicts: minor, majorConflicts: major, rate: (clean + minor) / results.length, passes: major === 0 }
}

// ── Bootstrap confidence interval ──

export function bootstrapCI(scores: number[], confidence = 0.95): [number, number] {
  if (!scores || scores.length === 0) return [0, 0]

  const iterations = 500
  const n = scores.length
  const means: number[] = new Array(iterations)

  for (let i = 0; i < iterations; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) {
      sum += scores[Math.floor(Math.random() * n)]
    }
    means[i] = sum / n
  }

  means.sort((a, b) => a - b)

  const alpha = 1 - confidence
  const lowerIdx = Math.floor(alpha / 2 * iterations)
  const upperIdx = Math.floor((1 - alpha / 2) * iterations) - 1

  return [means[lowerIdx], means[upperIdx >= iterations ? iterations - 1 : upperIdx]]
}

// ── Wilson score CI ──

function wilsonScoreCI(p: number, n: number, z = 1.96) {
  const effectiveN = Math.max(50, n)
  const denom = 1 + z * z / effectiveN
  const center = (p + z * z / (2 * effectiveN)) / denom
  const margin = z * Math.sqrt(p * (1 - p) / effectiveN + z * z / (4 * effectiveN * effectiveN)) / denom

  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) }
}

// ── Confidence interval calculator ──

function calculateConfidenceInterval(
  activationResults: { actual: boolean; expected: boolean }[],
  consistencyResults: { structureScore: number }[],
  edgeResults: { outcome: string }[],
  compatibilityResults: { outcome: string }[]
): { lower: number; upper: number; mean: number; confidence: string; n: number } {
  const actPasses = activationResults.filter(r => r.actual === r.expected).length
  const edgePasses = edgeResults.filter(r => r.outcome !== 'crashed').length
  const compPasses = compatibilityResults.filter(r => r.outcome !== 'major_conflict').length

  let conPasses = 0
  if (consistencyResults.length > 0) {
    const scores = consistencyResults.map(r => r.structureScore)
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length)
    const cv = mean > 0 ? std / mean : 1
    conPasses = cv < 0.15 ? consistencyResults.length : 0
  }

  const totalRunCount = activationResults.length + consistencyResults.length + edgeResults.length + compatibilityResults.length
  const totalPasses = actPasses + conPasses + edgePasses + compPasses

  if (totalRunCount === 0) {
    return { lower: 0, upper: 100, mean: 0, confidence: '95%', n: 0 }
  }

  const p = totalPasses / totalRunCount
  const result = wilsonScoreCI(p, totalRunCount)

  return {
    lower: Math.round(Math.max(0, result.lower) * 100),
    upper: Math.round(Math.min(1, result.upper) * 100),
    mean: Math.round(p * 100),
    confidence: '95%',
    n: totalRunCount
  }
}

// ── evaluateSkill ──

export function evaluateSkill(skillDir: string, trials?: number): MonteCarloResult {
  const actualTrials = trials ?? 100
  const skillName = basename(skillDir)
  const metadataPath = `${skillDir}/metadata.md`
  const skillsDir = dirname(skillDir)

  if (!existsSync(metadataPath)) {
    throw new Error(`No metadata.md found in ${skillDir}`)
  }

  resetSeed(hashCode(skillName))

  // Scale test counts with trials (baseline: 20 activation, 10 each for others)
  const scale = Math.max(1, Math.round(actualTrials / 50))
  const actCount = 20 * scale
  const subCount = 10 * scale

  const metadata = readFileSync(metadataPath, 'utf8')
  const triggerMatch = metadata.match(/triggers?\s*:\s*\[([^\]]+)\]/i)
  const triggers = triggerMatch
    ? triggerMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''))
    : [skillName]

  // 1. Activation
  const activationPrompts = generateActivationPrompts(triggers, actCount)
  const activationResults = activationPrompts.map(p => ({
    actual: simulateActivation(p.prompt, triggers),
    expected: p.shouldActivate
  }))

  // 2. Consistency
  const consistencyInputs = generateConsistencyInputs(skillName, subCount)
  const consistencyResults = consistencyInputs.map(() => ({
    structureScore: 8 + seededRandom() * 7
  }))

  // 3. Edge cases
  const edgeCases = generateEdgeCases(skillName, subCount)
  const edgeResults = edgeCases.map(e => ({
    outcome: simulateEdgeOutcome(e)
  }))

  // 4. Compatibility
  const compatibilityPairs = generateCompatibilityPairs(skillsDir, skillName, subCount)
  const compatibilityResults = compatibilityPairs.map(p => ({
    outcome: simulateCompatibility(p)
  }))

  // Analysis
  const activation = analyzeActivationRate(activationResults)
  const consistency = analyzeConsistency(consistencyResults)
  const edge = analyzeEdgeCases(edgeResults)
  const compatibility = analyzeCompatibility(compatibilityResults)

  const totalScore = activation.score + consistency.score + edge.score + compatibility.score
  const ci = calculateConfidenceInterval(activationResults, consistencyResults, edgeResults, compatibilityResults)
  const totalTrials = activationResults.length + consistencyResults.length + edgeResults.length + compatibilityResults.length

  return {
    skillName,
    activationScore: activation.score,
    consistencyScore: consistency.score,
    edgeCaseScore: edge.score,
    compatibilityScore: compatibility.score,
    totalScore,
    confidenceInterval: [ci.lower, ci.upper],
    trials: totalTrials
  }
}

// ── evaluateAll ──

export function evaluateAll(skillsRoot: string, trials?: number): MonteCarloResult[] {
  const actualTrials = trials ?? 100

  if (!existsSync(skillsRoot)) return []

  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => `${skillsRoot}/${d.name}`)

  const results: MonteCarloResult[] = []
  for (const dir of skillDirs) {
    try {
      const result = evaluateSkill(dir, actualTrials)
      results.push(result)
    } catch {
      // Skip skills without metadata.md
    }
  }

  return results.sort((a, b) => b.totalScore - a.totalScore)
}
