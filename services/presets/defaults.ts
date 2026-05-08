// src/services/mammoth/presets/defaults.ts — Embedded Mammoth team preset defaults
// Phase 7: Native Mammoth integration preset system.
// All 7 presets bundled as TypeScript constants so they work without external .md files.
// Ported faithfully from Mammoth presets/*.md role definitions, strategies, and verification gates.

import type { TeamPreset } from '../../types/mammoth'

// ── Review Preset (review.md) ──
// 3 parallel reviewers — security, performance, architecture.
// Protocol: spawn 3 agents simultaneously, each reviews diff independently.
// Collect findings, deduplicate, prioritize P0-P3, present consolidated report.
const REVIEW_PRESET: TeamPreset = {
  name: 'review',
  description: '3 parallel reviewers — security, performance, architecture',
  context: 'review',
  parallelism: 'full',
  members: 3,
  roles: [
    {
      id: 'security-reviewer',
      name: 'Security Reviewer',
      agentType: 'security-reviewer',
      model: 'opus',
      reason: 'Security is always critical',
    },
    {
      id: 'code-reviewer',
      name: 'Code Reviewer',
      agentType: 'code-reviewer',
      model: 'opus',
      reason: 'All code review is critical',
    },
    {
      id: 'architect',
      name: 'Architect',
      agentType: 'architect',
      model: 'opus',
      reason: 'Critical architecture decisions',
    },
  ],
  strategy: 'parallel independent review, then merge findings',
  verificationGate:
    'All 3 agents returned findings (no silent failures). Overlapping findings deduplicated. Severity ratings consistent across reviewers. Zero P0 findings remaining unaddressed.',
}

// ── Debug Preset (debug.md) ──
// 3 competing hypothesis investigators.
// Protocol: each agent formulates a different hypothesis (Occam, alternative, edge case).
// Investigate independently, gather evidence for/against, return confidence 0-100.
// Orchestrator weighs by evidence quality, resolves contradictions, selects best fix path.
const DEBUG_PRESET: TeamPreset = {
  name: 'debug',
  description: '3 competing hypothesis investigators',
  context: 'debug',
  parallelism: 'full',
  members: 3,
  roles: [
    {
      id: 'debugger-lead',
      name: 'Debugger Lead',
      agentType: 'debugger',
      model: 'opus',
      reason: 'Most likely cause needs deepest analysis',
    },
    {
      id: 'debugger-alt',
      name: 'Debugger Alternative',
      agentType: 'debugger',
      model: 'sonnet',
      reason: 'Second hypothesis for diversity',
    },
    {
      id: 'debugger-edge',
      name: 'Debugger Edge Case',
      agentType: 'debugger',
      model: 'sonnet',
      reason: 'Systemic/edge case investigation',
    },
  ],
  strategy: 'parallel competing investigation, evidence-weighted resolution',
  verificationGate:
    'Fix applied and verified (bug no longer reproduces). Alternative hypotheses ruled OUT (not just less likely). Regression test added for root cause. Edge case from competing hypothesis addressed if plausible.',
}

// ── Feature Preset (feature.md) ──
// 1 lead + 2 implementers with file ownership.
// Protocol: lead plans approach and assigns file ownership (no overlap).
// Implementers work in parallel on exclusive file sets.
// Lead integrates, reviews, verifies end-to-end.
const FEATURE_PRESET: TeamPreset = {
  name: 'feature',
  description: '1 lead + 2 implementers with file ownership',
  context: 'dev',
  parallelism: 'hybrid',
  members: 3,
  roles: [
    {
      id: 'lead',
      name: 'Lead',
      agentType: 'architect',
      model: 'opus',
      reason: 'Critical architecture and coordination',
    },
    {
      id: 'implementer-1',
      name: 'Implementer 1',
      agentType: 'executor',
      model: 'sonnet',
      reason: 'Implementation from clear specs',
    },
    {
      id: 'implementer-2',
      name: 'Implementer 2',
      agentType: 'executor',
      model: 'sonnet',
      reason: 'Implementation from clear specs',
    },
  ],
  strategy: 'plan → divide by file ownership → implement in parallel → integrate',
  verificationGate:
    'All assigned files created/modified by correct owner (no cross-ownership writes). End-to-end test passes. Lead reviewed both implementations. Zero merge conflicts during integration.',
}

// ── Fullstack Preset (fullstack.md) ──
// 4 agents — frontend, backend, tests, lead.
// Protocol: lead defines API contracts and data models.
// Backend, frontend, and test-engineer implement in parallel.
// Lead wires frontend to backend, runs test suite, fixes integration issues.
const FULLSTACK_PRESET: TeamPreset = {
  name: 'fullstack',
  description: '4 agents — frontend, backend, tests, lead',
  context: 'dev',
  parallelism: 'hybrid',
  members: 4,
  roles: [
    {
      id: 'lead',
      name: 'Lead',
      agentType: 'architect',
      model: 'opus',
      reason: 'Critical architecture, contract definition, integration',
    },
    {
      id: 'backend-dev',
      name: 'Backend Developer',
      agentType: 'executor',
      model: 'sonnet',
      reason: 'Backend implementation from clear API contracts',
    },
    {
      id: 'frontend-dev',
      name: 'Frontend Developer',
      agentType: 'designer',
      model: 'sonnet',
      reason: 'Frontend implementation from clear API contracts',
    },
    {
      id: 'test-engineer',
      name: 'Test Engineer',
      agentType: 'test-engineer',
      model: 'sonnet',
      reason: 'Test generation from contract patterns',
    },
  ],
  strategy: 'parallel implementation by layer, coordinated integration',
  verificationGate:
    'All API contracts satisfied (backend returns what frontend expects). Test suite passes (zero failures). No mocks remain in production paths. End-to-end flow works (real backend + real frontend). Test-engineer confirms all contract tests pass.',
}

// ── Research Preset (research.md) ──
// 3 parallel researchers with non-overlapping search strategies.
// Protocol: codebase-researcher explores repo/grep/trace.
// docs-researcher reads docs/README/wiki/API references.
// external-researcher searches web/GitHub/Stack Overflow.
// Orchestrator cross-validates, synthesizes, lists unanswered questions.
const RESEARCH_PRESET: TeamPreset = {
  name: 'research',
  description: '3 parallel researchers',
  context: 'research',
  parallelism: 'full',
  members: 3,
  roles: [
    {
      id: 'codebase-researcher',
      name: 'Codebase Researcher',
      agentType: 'explore',
      model: 'opus',
      reason: 'Codebase exploration requires deep analysis',
    },
    {
      id: 'docs-researcher',
      name: 'Docs Researcher',
      agentType: 'document-specialist',
      model: 'sonnet',
      reason: 'Documentation search is pattern-based',
    },
    {
      id: 'external-researcher',
      name: 'External Researcher',
      agentType: 'explore',
      model: 'sonnet',
      reason: 'Web/external search is breadth-oriented',
    },
  ],
  strategy: 'parallel independent research, complementary coverage',
  verificationGate:
    'All 3 researchers returned (no silent failures). Confidence levels assigned to ALL findings. Contradictory findings flagged and investigated. Gaps explicitly listed as unanswered questions. Every HIGH confidence finding has source evidence.',
}

// ── Security Preset (security.md) ──
// 4 parallel security reviewers by domain.
// Protocol: web-security (XSS, CSRF, injection, auth, CORS).
// infra-security (deploy config, secrets, network, IAM).
// data-security (encryption, PII, SQL injection, data leaks).
// dependency-security (supply chain, CVEs, unpinned versions).
// All 4 review simultaneously through their domain lens. No cross-talk.
const SECURITY_PRESET: TeamPreset = {
  name: 'security',
  description: '4 parallel security reviewers by domain',
  context: 'security',
  parallelism: 'full',
  members: 4,
  roles: [
    {
      id: 'web-security',
      name: 'Web Security',
      agentType: 'security-reviewer',
      model: 'opus',
      reason: 'Web vulnerabilities are critical',
    },
    {
      id: 'infra-security',
      name: 'Infra Security',
      agentType: 'security-reviewer',
      model: 'opus',
      reason: 'Infrastructure security is critical',
    },
    {
      id: 'data-security',
      name: 'Data Security',
      agentType: 'security-reviewer',
      model: 'opus',
      reason: 'Data security is critical',
    },
    {
      id: 'dependency-security',
      name: 'Dependency Security',
      agentType: 'security-reviewer',
      model: 'sonnet',
      reason: 'Dependency scanning is pattern-based',
    },
  ],
  strategy: 'domain-specialized parallel security review',
  verificationGate:
    'All 4 domain reviewers returned findings (no silent failures). CRITICAL findings: zero remaining unaddressed. HIGH findings: all have assigned fix owners. Overlapping findings deduplicated. Dependency CVEs checked against live database.',
}

// ── Santa Method Preset (santa-method.md) ──
// Dual independent review with no shared context (double-entry bookkeeping).
// Protocol: both reviewers spawn simultaneously, rate NICE or NAUGHTY.
// NICE+NICE → SHIP. Either NAUGHTY → fix all issues, re-review.
// Loop max 3 cycles. Escalate to human on non-convergence.
const SANTA_METHOD_PRESET: TeamPreset = {
  name: 'santa-method',
  description: '2 independent reviewers converging',
  context: 'review',
  parallelism: 'full',
  members: 2,
  roles: [
    {
      id: 'reviewer-alpha',
      name: 'Reviewer Alpha',
      agentType: 'code-reviewer',
      model: 'opus',
      reason: 'Critical independent review',
    },
    {
      id: 'reviewer-beta',
      name: 'Reviewer Beta',
      agentType: 'code-reviewer',
      model: 'opus',
      reason: 'Critical independent review',
    },
  ],
  strategy: 'independent parallel review → verdict gate → fix → repeat until NICE/NICE',
  verificationGate:
    'Both reviewers returned NICE in the SAME cycle (not alpha in cycle 1, beta in cycle 2). Zero CRITICAL or HIGH issues remain. Fixes applied and verified (diff reviewed post-fix). No reviewer saw the other review (isolation maintained across cycles). Max cycles not exceeded (3).',
}

// ── Default Presets Map ──

const DEFAULT_PRESETS: Record<string, TeamPreset> = {
  review: REVIEW_PRESET,
  debug: DEBUG_PRESET,
  feature: FEATURE_PRESET,
  fullstack: FULLSTACK_PRESET,
  research: RESEARCH_PRESET,
  security: SECURITY_PRESET,
  'santa-method': SANTA_METHOD_PRESET,
}

export {
  DEFAULT_PRESETS,
  REVIEW_PRESET,
  DEBUG_PRESET,
  FEATURE_PRESET,
  FULLSTACK_PRESET,
  RESEARCH_PRESET,
  SECURITY_PRESET,
  SANTA_METHOD_PRESET,
}
