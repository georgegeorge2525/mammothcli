// src/services/mammoth/review/pipeline.ts — Review Pipeline Orchestration Engine
// 5-phase checkpointed review state machine. Generates structured agent prompts.
// Phase 8: Native Mammoth review pipeline integration.
// Ported from Mammoth review/pipeline.js.

import { REVIEW_PIPELINE_PHASES } from '../../constants/mammoth.js'
import type { ReviewSeverity } from '../../types/mammoth.js'
import { SEVERITY_ORDER, classifySeverity, formatSeverity } from './severity.js'

// ── Phase result shape ──

interface PhaseResult {
  phase: number
  name: string
  findings: string[]
}

interface PipelineResult {
  phases: PhaseResult[]
  summary: string
}

// ── Review Pipeline ──

class ReviewPipeline {
  // Run a single review phase against a diff
  runPhase(phase: number, diff: string): PhaseResult {
    const def = REVIEW_PIPELINE_PHASES.find(p => p.phase === phase)
    if (!def) {
      throw new Error(`Invalid phase: ${phase}. Must be 1-${REVIEW_PIPELINE_PHASES.length}.`)
    }

    const findings: string[] = []
    if (!diff || diff.trim().length === 0) {
      return { phase: def.phase, name: def.name, findings }
    }

    // Generate structured findings based on the phase focus
    const issues = this._analyzeDiff(phase, diff)
    findings.push(...issues)

    return { phase: def.phase, name: def.name, findings }
  }

  // Run all 5 phases against a diff and produce a consolidated result
  runAll(diff: string): PipelineResult {
    const phases: PhaseResult[] = []

    for (const def of REVIEW_PIPELINE_PHASES) {
      const result = this.runPhase(def.phase, diff)
      phases.push(result)
    }

    // Build consolidated summary
    const totalFindings = phases.reduce((sum, p) => sum + p.findings.length, 0)
    const summary = totalFindings > 0
      ? `Review complete: ${totalFindings} finding(s) across ${phases.length} phases.`
      : `Review complete: no findings across ${phases.length} phases.`

    return { phases, summary }
  }

  // Format the full results as a markdown report with severity icons
  formatReport(results: PipelineResult): string {
    const lines: string[] = []
    lines.push('# Mammoth Review Report')
    lines.push('')

    let totalFindings = 0
    for (const phase of results.phases) {
      totalFindings += phase.findings.length
      lines.push(`## Phase ${phase.phase}: ${phase.name}`)

      if (phase.findings.length === 0) {
        lines.push('')
        lines.push('No findings.')
        lines.push('')
        continue
      }

      lines.push('')
      for (const finding of phase.findings) {
        const severity = classifySeverity(finding)
        const icon = formatSeverity(severity)
        lines.push(`- ${icon} ${finding}`)
      }
      lines.push('')
    }

    // Summary section
    lines.push('---')
    lines.push('')
    lines.push(`**Total phases:** ${results.phases.length}`)
    lines.push(`**Total findings:** ${totalFindings}`)
    lines.push('')

    // Severity distribution
    const counts: Record<ReviewSeverity, number> = {
      P0_CRITICAL: 0,
      P1_HIGH: 0,
      P2_MEDIUM: 0,
      P3_LOW: 0,
    }
    for (const phase of results.phases) {
      for (const f of phase.findings) {
        const sev = classifySeverity(f)
        counts[sev] = (counts[sev] || 0) + 1
      }
    }

    lines.push('### Severity Distribution')
    lines.push('')
    for (const sev of SEVERITY_ORDER) {
      const count = counts[sev]
      if (count > 0) {
        lines.push(`- ${formatSeverity(sev)}: ${count} finding(s)`)
      }
    }

    // Overall verdict
    const verdict = this._verdict(counts)
    lines.push('')
    lines.push(`### Verdict: ${verdict}`)

    return lines.join('\n')
  }

  // ── Private helpers ──

  // Analyze a diff for phase-specific issues
  private _analyzeDiff(phase: number, diff: string): string[] {
    const findings: string[] = []

    // Phase-specific shallow analysis — real findings come from LLM agents
    switch (phase) {
      case 1: { // Code Quality + Architecture
        if (/TODO|FIXME|HACK/i.test(diff)) findings.push('Code contains TODO/FIXME/HACK markers that may indicate unfinished work.')
        if (/console\.log\(/i.test(diff)) findings.push('Debug logging (console.log) found in production code.')
        if (/any\s*type|\.\s*any/i.test(diff)) findings.push('Usage of `any` type may weaken type safety.')
        if (/\.then\(|new Promise\(/i.test(diff) && /async|await/i.test(diff) === false) {
          findings.push('Promise chains without async/await may benefit from modern async patterns.')
        }
        break
      }
      case 2: { // Security + Performance
        if (/password|secret|token|api[_-]?key/i.test(diff) && /["'][A-Za-z0-9+/=]{20,}["']/.test(diff)) {
          findings.push('Potential hardcoded credential or secret detected.')
        }
        if (/eval\(|Function\(/i.test(diff)) findings.push('Dynamic code execution (eval/Function) may pose security risk.')
        if (/innerHTML|dangerouslySetInnerHTML/i.test(diff)) findings.push('Unsanitized HTML insertion may create XSS vulnerability.')
        if (/O\(n\^2\)|O\(2\^n\)|O\(n!\)|nested.*for.*for/i.test(diff)) {
          findings.push('Potential performance concern: nested loops or high-complexity algorithm detected.')
        }
        break
      }
      case 3: { // Testing + Documentation
        if (/export (class|function|interface)/i.test(diff) && !/\/\*[^*]*\*\/|\/\/\s*\w/i.test(diff)) {
          findings.push('Exported symbols may lack documentation comments.')
        }
        if (/(\.test|\.spec)\.(ts|tsx|js|jsx)["']/i.test(diff) === false && /describe\(|it\(|test\(/i.test(diff) === false) {
          findings.push('No test files or test cases detected in the diff — consider adding tests.')
        }
        break
      }
      case 4: { // Best Practices + CI/CD
        if (/process\.exit\(/i.test(diff)) findings.push('Hard process.exit() calls may prevent graceful shutdown.')
        if (/TODO|FIXME/i.test(diff)) findings.push('Unresolved TODO/FIXME markers should be addressed or tracked.')
        if (/catch\s*\(\s*\)/.test(diff) || /catch\s*\(_\)/.test(diff)) {
          findings.push('Empty or silent catch blocks may hide errors.')
        }
        break
      }
      case 5: { // Consolidated Report
        // Phase 5 synthesizes; no independent analysis in the shallow pass
        break
      }
    }

    return findings
  }

  // Determine overall verdict from severity counts
  private _verdict(counts: Record<ReviewSeverity, number>): string {
    if (counts.P0_CRITICAL > 0) return 'REJECT — Critical issues must be resolved before merge.'
    if (counts.P1_HIGH > 3) return 'REQUEST CHANGES — Multiple high-severity issues found.'
    if (counts.P1_HIGH > 0) return 'APPROVE WITH CONDITIONS — Fix high-severity items before merge.'
    return 'APPROVE — No critical or high-severity issues found.'
  }
}

export { ReviewPipeline }
export type { PhaseResult, PipelineResult }
