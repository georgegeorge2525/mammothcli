// src/services/mammoth/personalityEngine.ts — Personality mode management
// Ported from Mammoth hooks/session-start.js caveman injection and
// hooks/lib/personality.js per-project isolation logic.
// Controls output density via four caveman tiers.

import type { PersonalityMode } from "../types/mammoth"

const CAVEMAN_RULES: Record<PersonalityMode, string> = {
  off: "",
  lite: "CAVEMAN lite. Drop pleasantries and hedging. Keep articles. Code/commits/security write normal.",
  full: "CAVEMAN full. Drop articles/filler/pleasantries/hedging. Fragments OK. Code/commits/PRs normal.",
  ultra: "CAVEMAN ultra. Maximum density. One-word when possible. Code/commits/security write normal.",
}

const VALID_PERSONALITIES: readonly PersonalityMode[] = ["off", "lite", "full", "ultra"]

// Get the caveman personality rules for a mode
export function getPersonalityRules(mode: PersonalityMode): string {
  return CAVEMAN_RULES[mode]
}

// Build personality context injection string for system prompts
export function buildPersonalityContext(mode: PersonalityMode): string {
  if (mode === "off") return ""
  return `<caveman_personality level="${mode}">\n${CAVEMAN_RULES[mode]}\n</caveman_personality>`
}

// Validate personality mode string
export function isValidPersonality(value: string): value is PersonalityMode {
  return (VALID_PERSONALITIES as readonly string[]).includes(value)
}

// Parse personality from /caveman command input
export function parseCavemanCommand(input: string): PersonalityMode | null {
  const trimmed = input.trim()
  // Match /caveman <mode> with optional leading whitespace, case-insensitive
  const match = trimmed.match(/^\/caveman\s+(off|lite|full|ultra)$/i)
  if (!match) return null
  const mode = match[1].toLowerCase() as PersonalityMode
  return isValidPersonality(mode) ? mode : null
}

export { CAVEMAN_RULES }
