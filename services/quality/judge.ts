// src/services/mammoth/quality/judge.ts — PluginEval Layer 2: Heuristic Judge
// Evaluates skill quality across 4 dimensions using structural heuristics.
// Pure heuristic engine — no LLM calls. Ported from Mammoth/quality/judge.js.

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import type { QualityGrade } from '../../types/mammoth'
import { QUALITY_THRESHOLDS } from '../../constants/mammoth'

export interface JudgeResult {
  skillName: string
  triggeringAccuracy: number   // 0-25
  orchestrationFitness: number // 0-25
  outputQuality: number        // 0-25
  scopeCalibration: number     // 0-25
  totalScore: number           // 0-100
  grade: QualityGrade
}

interface DimensionResult {
  score: number
  justification: string
}

// ── Dimension Evaluators ──

function evaluateTriggeringAccuracy(metadata: string, _instructions: string): DimensionResult {
  let score = 15 // baseline

  const triggerMatch = metadata.match(/triggers?\s*:\s*\[([^\]]+)\]/i)
  if (!triggerMatch) return { score: 0, justification: 'No triggers defined' }

  const triggers = triggerMatch[1].split(',').map((t) => t.trim().replace(/['"]/g, ''))

  // 1. Primary use case coverage (10 pts)
  const hasKeywords = triggers.length >= 2
  const keywordsSpecific = triggers.every((t) => t.length > 3 && !['todo', 'wip', 'test'].includes(t))

  if (hasKeywords && keywordsSpecific) score += 8
  else if (hasKeywords) score += 4

  // 2. False positive avoidance (10 pts)
  const triggersNotGeneric = triggers.filter(
    (t) => !['the', 'and', 'for', 'with', 'this', 'that', 'code', 'file', 'work'].includes(t),
  ).length
  if (triggersNotGeneric >= 3) score += 5
  else if (triggersNotGeneric === 2) score += 3

  // 3. Edge case handling (5 pts)
  if (triggers.some((t) => t.includes('*') || t.includes('?'))) score += 2 // Wildcards
  if (triggers.length >= 3 && triggers.length <= 5) score += 1 // Right number

  return {
    score: Math.min(25, Math.max(0, score)),
    justification: `${triggers.length} triggers: ${triggers.join(', ')}. ${triggersNotGeneric} specific, ${triggers.length - triggersNotGeneric} generic.`,
  }
}

function evaluateOrchestrationFitness(instructions: string, _skillName: string): DimensionResult {
  let score = 15

  // 1. Appropriate sub-agent spawns (10 pts)
  const hasAgentDelegation = /agent|delegate|spawn|subagent/i.test(instructions)
  const hasClearHandoffs = /handoff|collect|integrate|verify|coordinate/i.test(instructions)

  if (hasAgentDelegation && hasClearHandoffs) score += 8
  else if (hasAgentDelegation) score += 4
  else if (instructions.length < 200) score += 6 // Simple skill, no delegation needed

  // 2. Correct tool choices (10 pts)
  const toolMentions = (instructions.match(/\b(Read|Write|Edit|Bash|Grep|Glob|Agent|Task)\b/gi) || []).length
  if (toolMentions >= 3) score += 5
  else if (toolMentions >= 1) score += 3

  // 3. Clean handoffs (5 pts)
  if (hasClearHandoffs) score += 2

  return {
    score: Math.min(25, Math.max(0, score)),
    justification: `${toolMentions} tool references. Delegation: ${hasAgentDelegation ? 'yes' : 'no'}. Handoffs: ${hasClearHandoffs ? 'yes' : 'no'}.`,
  }
}

function evaluateOutputQuality(instructions: string, _skillName: string): DimensionResult {
  let score = 15

  // 1. Completeness (10 pts)
  const hasSections = (instructions.match(/^#{1,3}\s+/gm) || []).length
  const hasExamples = /example|usage|pattern/i.test(instructions)

  if (hasSections >= 3) score += 6
  else if (hasSections >= 1) score += 3
  if (hasExamples) score += 4

  // 2. Correctness (10 pts) — heuristics for quality
  const hasActionableContent = instructions.length > 200
  const wellStructured = hasSections >= 2 && instructions.split('\n').length > 15

  if (hasActionableContent && wellStructured) score += 5
  else if (hasActionableContent) score += 3

  // 3. Format (5 pts)
  if (instructions.includes('```') || instructions.includes('## ')) score += 3

  return {
    score: Math.min(25, Math.max(0, score)),
    justification: `${hasSections} sections. ${Math.round(instructions.length / 100) * 100} chars. Examples: ${hasExamples ? 'yes' : 'no'}. Structured: ${wellStructured ? 'yes' : 'no'}.`,
  }
}

function evaluateScopeCalibration(instructions: string, _metadata: string): DimensionResult {
  let score = 15

  // 1. Single responsibility (10 pts)
  const instructionLines = instructions.split('\n').length
  const sections = (instructions.match(/^#{1,3}\s+/gm) || []).length

  if (instructionLines >= 20 && instructionLines <= 300) score += 6
  else if (instructionLines >= 10 && instructionLines <= 500) score += 3

  // 2. Clear boundaries (10 pts)
  const hasDependencies = /depends|requires|works with|complements/i.test(instructions)
  const hasLimitations = /does not|not for|skip if|avoid|never/i.test(instructions)

  if (hasDependencies && hasLimitations) score += 5
  else if (hasDependencies || hasLimitations) score += 3

  // 3. Abstraction level (5 pts)
  const notTooGeneral = instructionLines > 10
  const notTooSpecific = instructionLines < 500
  if (notTooGeneral && notTooSpecific) score += 1
  if (sections >= 2 && sections <= 8) score += 1

  return {
    score: Math.min(25, Math.max(0, score)),
    justification: `${instructionLines} lines, ${sections} sections. Boundaries: ${hasDependencies || hasLimitations ? 'defined' : 'undefined'}.`,
  }
}

// ── Grade calculator ──

function calculateGrade(score: number): QualityGrade {
  if (score >= QUALITY_THRESHOLDS.Platinum) return 'Platinum'
  if (score >= QUALITY_THRESHOLDS.Gold) return 'Gold'
  if (score >= QUALITY_THRESHOLDS.Silver) return 'Silver'
  if (score >= QUALITY_THRESHOLDS.Bronze) return 'Bronze'
  return 'Unrated'
}

// ── Main judge functions ──

function evaluateSkill(skillDir: string): JudgeResult {
  const skillName = basename(skillDir)
  const metadataPath = join(skillDir, 'metadata.md')
  const instructionsPath = join(skillDir, 'instructions.md')

  if (!existsSync(metadataPath)) {
    return {
      skillName,
      triggeringAccuracy: 0,
      orchestrationFitness: 0,
      outputQuality: 0,
      scopeCalibration: 0,
      totalScore: 0,
      grade: 'Unrated',
    }
  }
  if (!existsSync(instructionsPath)) {
    return {
      skillName,
      triggeringAccuracy: 0,
      orchestrationFitness: 0,
      outputQuality: 0,
      scopeCalibration: 0,
      totalScore: 0,
      grade: 'Unrated',
    }
  }

  const metadata = readFileSync(metadataPath, 'utf8')
  const instructions = readFileSync(instructionsPath, 'utf8')

  const dimensions = {
    triggeringAccuracy: evaluateTriggeringAccuracy(metadata, instructions),
    orchestrationFitness: evaluateOrchestrationFitness(instructions, skillName),
    outputQuality: evaluateOutputQuality(instructions, skillName),
    scopeCalibration: evaluateScopeCalibration(instructions, metadata),
  }

  const total = Object.values(dimensions).reduce((s, d) => s + d.score, 0)

  return {
    skillName,
    triggeringAccuracy: dimensions.triggeringAccuracy.score,
    orchestrationFitness: dimensions.orchestrationFitness.score,
    outputQuality: dimensions.outputQuality.score,
    scopeCalibration: dimensions.scopeCalibration.score,
    totalScore: total,
    grade: calculateGrade(total),
  }
}

function evaluateAll(skillsRoot: string): JudgeResult[] {
  if (!existsSync(skillsRoot)) {
    return []
  }

  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(skillsRoot, d.name))

  const results: JudgeResult[] = []
  for (const dir of skillDirs) {
    const result = evaluateSkill(dir)
    if (result.totalScore > 0 || result.grade === 'Unrated') {
      results.push(result)
    }
  }

  return results.sort((a, b) => b.totalScore - a.totalScore)
}

function calculateJudgeGrade(score: number): QualityGrade {
  return calculateGrade(score)
}

export { evaluateSkill, evaluateAll, calculateJudgeGrade }
