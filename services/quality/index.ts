// src/services/mammoth/quality/index.ts — 3-Layer Quality Orchestrator
// Ties together lint (L1=30%), judge (L2=40%), and monte-carlo (L3=30%).
// Phase 6 of the native Mammoth integration.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { QualityEvaluation, QualityGrade, AntiPattern } from '../../types/mammoth'
import { QUALITY_WEIGHTS, QUALITY_THRESHOLDS } from '../../constants/mammoth'
import { lintSkill, lintAll } from './lint'
import { evaluateSkill as judgeSkill, evaluateAll as judgeAll } from './judge'
import { evaluateSkill as monteCarloSkill, evaluateAll as monteCarloAll } from './monteCarlo'

// ── Full Single-Skill Evaluation ──

function evaluateSkillFull(skillDir: string): QualityEvaluation {
  const lintResult = lintSkill(skillDir)
  const judgeResult = judgeSkill(skillDir)
  const mcResult = monteCarloSkill(skillDir)

  const lintScore = lintResult?.score ?? 0
  const judgeScore = judgeResult?.totalScore ?? 0
  const monteCarloScore = mcResult?.totalScore ?? 0

  const combinedScore = Math.round(
    QUALITY_WEIGHTS.lint * lintScore +
    QUALITY_WEIGHTS.judge * judgeScore +
    QUALITY_WEIGHTS.monteCarlo * monteCarloScore
  )

  const grade = calculateGrade(combinedScore)

  return {
    skillName: basename(skillDir),
    lintScore,
    judgeScore,
    monteCarloScore,
    combinedScore,
    grade,
    antiPatterns: lintResult?.antiPatterns ?? [],
    evaluatedAt: new Date().toISOString(),
  }
}

// ── Batch Evaluation ──

function evaluateAllFull(skillsRoot: string): QualityEvaluation[] {
  if (!existsSync(skillsRoot)) return []

  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => join(skillsRoot, d.name))

  return skillDirs
    .map(dir => {
      try {
        return evaluateSkillFull(dir)
      } catch {
        return null
      }
    })
    .filter((r): r is QualityEvaluation => r !== null)
    .sort((a, b) => b.combinedScore - a.combinedScore)
}

// ── Grade Calculation ──

function calculateGrade(score: number): QualityGrade {
  if (score >= QUALITY_THRESHOLDS.Platinum) return 'Platinum'
  if (score >= QUALITY_THRESHOLDS.Gold) return 'Gold'
  if (score >= QUALITY_THRESHOLDS.Silver) return 'Silver'
  if (score >= QUALITY_THRESHOLDS.Bronze) return 'Bronze'
  return 'Unrated'
}

// ── Registry Persistence ──

function updateRegistry(evaluations: QualityEvaluation[], registryPath: string): void {
  const dir = dirname(registryPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const gradeCounts = { Platinum: 0, Gold: 0, Silver: 0, Bronze: 0, Unrated: 0 }
  let totalScore = 0
  for (const e of evaluations) {
    gradeCounts[e.grade]++
    totalScore += e.combinedScore
  }

  const registry = {
    version: 2,
    lastUpdated: new Date().toISOString(),
    skills: Object.fromEntries(
      evaluations.map(e => [e.skillName, {
        lint: { score: e.lintScore },
        judge: { score: e.judgeScore },
        monteCarlo: { score: e.monteCarloScore },
        combined: { score: e.combinedScore, grade: e.grade },
        antiPatterns: e.antiPatterns,
        evaluatedAt: e.evaluatedAt,
      }])
    ),
    summary: {
      total: evaluations.length,
      platinum: gradeCounts.Platinum,
      gold: gradeCounts.Gold,
      silver: gradeCounts.Silver,
      bronze: gradeCounts.Bronze,
      unrated: gradeCounts.Unrated,
      averageCombined: evaluations.length > 0
        ? Math.round(totalScore / evaluations.length * 10) / 10
        : 0,
      evaluatedAt: new Date().toISOString(),
    },
  }

  writeFileSync(registryPath, JSON.stringify(registry, null, 2))
}

function loadRegistry(registryPath: string): QualityEvaluation[] {
  if (!existsSync(registryPath)) return []

  try {
    const raw = JSON.parse(readFileSync(registryPath, 'utf8'))
    if (!raw?.skills) return []

    return Object.entries(raw.skills as Record<string, any>).map(([name, data]) => ({
      skillName: name,
      lintScore: data?.lint?.score ?? 0,
      judgeScore: data?.judge?.score ?? 0,
      monteCarloScore: data?.monteCarlo?.score ?? 0,
      combinedScore: data?.combined?.score ?? 0,
      grade: (data?.combined?.grade ?? 'Unrated') as QualityGrade,
      antiPatterns: (data?.antiPatterns ?? []) as AntiPattern[],
      evaluatedAt: (data?.evaluatedAt ?? '') as string,
    }))
  } catch {
    return []
  }
}

// ── Report ──

function generateReport(evaluations: QualityEvaluation[]): string {
  const lines: string[] = [
    '# Quality Report',
    `Evaluated: ${new Date().toISOString()}`,
    '',
    '| Skill | Lint | Judge | MC | Combined | Grade |',
    '|-------|------|-------|-----|----------|-------|',
  ]

  for (const e of evaluations) {
    lines.push(
      `| ${e.skillName} | ${e.lintScore} | ${e.judgeScore} | ${e.monteCarloScore} | ${e.combinedScore} | ${e.grade} |`
    )
  }

  if (evaluations.length > 0) {
    const avg = Math.round(
      evaluations.reduce((s, e) => s + e.combinedScore, 0) / evaluations.length
    )
    const gradeCounts = { Platinum: 0, Gold: 0, Silver: 0, Bronze: 0, Unrated: 0 }
    for (const e of evaluations) gradeCounts[e.grade]++

    lines.push('')
    lines.push(`Average: ${avg}/100`)
    lines.push(
      `Platinum: ${gradeCounts.Platinum}  Gold: ${gradeCounts.Gold}  Silver: ${gradeCounts.Silver}  Bronze: ${gradeCounts.Bronze}  Unrated: ${gradeCounts.Unrated}`
    )
  }

  return lines.join('\n')
}

export {
  evaluateSkillFull,
  evaluateAllFull,
  calculateGrade,
  updateRegistry,
  loadRegistry,
  generateReport,
}
