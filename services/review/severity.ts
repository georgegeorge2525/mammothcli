// src/services/mammoth/review/severity.ts — Severity classification utilities
// Maps review issues to P0-P3 severity levels with human-friendly labels and icons.
// Phase 8: Native Mammoth review pipeline integration.

import type { ReviewSeverity } from '../../types/mammoth.js'

// Severity labels with full descriptions
const SEVERITY_LABELS: Record<ReviewSeverity, string> = {
  P0_CRITICAL: 'CRITICAL',
  P1_HIGH: 'HIGH',
  P2_MEDIUM: 'MEDIUM',
  P3_LOW: 'LOW',
}

// Severity order from highest to lowest priority
const SEVERITY_ORDER: ReviewSeverity[] = [
  'P0_CRITICAL',
  'P1_HIGH',
  'P2_MEDIUM',
  'P3_LOW',
]

// Icons for markdown display — mapped by severity
const SEVERITY_ICONS: Record<ReviewSeverity, string> = {
  P0_CRITICAL: '\u{1F534}', // red circle
  P1_HIGH: '\u{1F7E0}', // orange circle
  P2_MEDIUM: '\u{1F7E1}', // yellow circle
  P3_LOW: '\u{1F535}', // blue circle
}

// Keyword patterns for auto-classifying issue text into severity buckets
const CRITICAL_PATTERNS = /security|vulnerability|crash|data\s*loss|corruption|injection|bypass|secret|credential|exploit/i
const HIGH_PATTERNS = /logic\s*defect|correctness|bug|regression|race\s*condition|deadlock|memory\s*leak|perf/i
const LOW_PATTERNS = /style|naming|cosmetic|whitespace|comment|typo|minor/i

// Classify an issue string into a ReviewSeverity
function classifySeverity(issue: string): ReviewSeverity {
  if (!issue) return 'P2_MEDIUM'
  if (CRITICAL_PATTERNS.test(issue)) return 'P0_CRITICAL'
  if (HIGH_PATTERNS.test(issue)) return 'P1_HIGH'
  if (LOW_PATTERNS.test(issue)) return 'P3_LOW'
  return 'P2_MEDIUM'
}

// Format severity for display: "RED CIRCLE CRITICAL", "ORANGE CIRCLE HIGH", etc.
function formatSeverity(severity: ReviewSeverity): string {
  const icon = SEVERITY_ICONS[severity] || ''
  const label = SEVERITY_LABELS[severity] || severity
  return `${icon} ${label}`
}

// Get numeric priority for sorting (lower = higher priority)
function severityPriority(severity: ReviewSeverity): number {
  return SEVERITY_ORDER.indexOf(severity)
}

export { SEVERITY_LABELS, SEVERITY_ORDER, classifySeverity, formatSeverity, severityPriority }
