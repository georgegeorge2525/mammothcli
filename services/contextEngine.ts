// src/services/mammoth/contextEngine.ts — Context profile detection
// Ported from Mammoth hooks/session-start.js context detection logic.
// Detects project context from environment, directory signals, and metadata.

import { existsSync, readdirSync } from "fs"
import type { ContextProfile } from "../types/mammoth"
import { STAGE_HINTS } from "../constants/mammoth"

const VALID_CONTEXTS: readonly ContextProfile[] = [
  "dev", "review", "debug", "security", "research", "deploy",
]

// Directory signals that strongly suggest a specific context
const CONTEXT_SIGNALS: Record<string, ContextProfile> = {
  security: "security",
  deploy: "deploy",
  k8s: "deploy",
  docker: "deploy",
  test: "review",
  spec: "review",
  __tests__: "review",
}

// Detect active context from directory signals and environment
export function detectContext(projectDir?: string): ContextProfile {
  // 1. Check MAMMOTH_CONTEXT env var
  const envCtx = process.env["MAMMOTH_CONTEXT"]?.toLowerCase().trim()
  if (envCtx && isValidContext(envCtx)) return envCtx

  // 2. Scan project directory for signal directories
  const dir = projectDir ?? process.cwd()
  try {
    if (existsSync(dir)) {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const signal = CONTEXT_SIGNALS[entry.name]
        if (signal) return signal
      }
    }
  } catch {
    // Directory not readable — fall through to default
  }

  // 3. Default to dev
  return "dev"
}

// Get the stage workflow for a context
export function getContextStages(context: ContextProfile): string[] {
  return [...STAGE_HINTS[context]]
}

// Validate a context string is a known ContextProfile
export function isValidContext(value: string): value is ContextProfile {
  return (VALID_CONTEXTS as readonly string[]).includes(value)
}

// Get preset recommendations for a context
export function getRecommendedPresets(context: ContextProfile): string[] {
  const presets: Record<ContextProfile, string[]> = {
    dev: ["feature", "fullstack", "task-coordination"],
    review: ["code-review", "security-audit", "qa-pass"],
    debug: ["trace", "investigate", "deep-dive"],
    security: ["security-audit", "threat-model", "compliance-check"],
    research: ["explore", "deep-dive", "synthesize"],
    deploy: ["preflight", "canary", "rollout", "rollback"],
  }
  return presets[context]
}
