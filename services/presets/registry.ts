// src/services/mammoth/presets/registry.ts — Preset loading and validation registry
// Phase 7: Native Mammoth integration preset system.
// Loads user overrides from .claude/mammoth/presets/*.md, falls back to embedded defaults.
// Provides lookup, listing, and composition validation.

import type { TeamPreset } from '../../types/mammoth'
import { DEFAULT_PRESETS } from './defaults'
import { parsePresetContent } from '../teamSpawner'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'

// ── Canonical Agent Types ──

// Set of valid canonical agent types for validation
const VALID_AGENT_TYPES: ReadonlySet<string> = new Set([
  'executor',
  'debugger',
  'explore',
  'code-reviewer',
  'security-reviewer',
  'verifier',
  'architect',
  'analyst',
  'planner',
  'designer',
  'writer',
  'document-specialist',
  'test-engineer',
  'qa-tester',
  'scientist',
  'tracer',
  'git-master',
  'critic',
  'code-simplifier',
])

// ── Preset Loading ──

// Load all available presets.
// Scans user preset directory (.claude/mammoth/presets/ by default) for .md files,
// parses them, and overlays on top of embedded defaults.
// User presets with the same name override defaults.
function loadPresets(presetsDir?: string): Record<string, TeamPreset> {
  // Start with embedded defaults
  const presets: Record<string, TeamPreset> = { ...DEFAULT_PRESETS }

  const dir = presetsDir || join(process.cwd(), '.claude', 'mammoth', 'presets')

  if (!existsSync(dir)) {
    return presets
  }

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return presets
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue
    }

    const filePath = join(dir, entry)
    let content: string
    try {
      content = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }

    const name = basename(entry, '.md')
    const parsed = parsePresetContent(name, content)

    if (parsed) {
      presets[name] = parsed
    }
  }

  return presets
}

// ── Preset Lookup ──

// Get a single preset by name.
// Searches user overrides first, then falls back to embedded defaults.
// Returns null if no preset with the given name exists.
function getPreset(name: string, presetsDir?: string): TeamPreset | null {
  const all = loadPresets(presetsDir)
  return all[name] || null
}

// ── Preset Listing ──

// List all available preset names.
function listPresets(presetsDir?: string): string[] {
  return Object.keys(loadPresets(presetsDir))
}

// ── Preset Validation ──

// Validate a preset's composition: all roles have valid agent types,
// member count matches role count, required fields are present.
function validatePreset(preset: TeamPreset): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!preset.name || typeof preset.name !== 'string') {
    errors.push('preset.name is required and must be a string')
  }

  if (!preset.description || typeof preset.description !== 'string') {
    errors.push('preset.description is required and must be a string')
  }

  if (!preset.strategy || typeof preset.strategy !== 'string') {
    errors.push('preset.strategy is required and must be a string')
  }

  if (!preset.verificationGate || typeof preset.verificationGate !== 'string') {
    errors.push('preset.verificationGate is required and must be a string')
  }

  if (typeof preset.members !== 'number' || preset.members < 1) {
    errors.push('preset.members must be a positive number')
  }

  if (!Array.isArray(preset.roles) || preset.roles.length === 0) {
    errors.push('preset.roles must be a non-empty array')
    return { valid: false, errors }
  }

  if (preset.members !== preset.roles.length) {
    errors.push(
      `preset.members (${preset.members}) does not match roles.length (${preset.roles.length})`,
    )
  }

  const validParallelism = ['full', 'sequential', 'hybrid']
  if (!validParallelism.includes(preset.parallelism)) {
    errors.push(
      `preset.parallelism must be one of: ${validParallelism.join(', ')}`,
    )
  }

  // Validate each role
  for (let i = 0; i < preset.roles.length; i++) {
    const role = preset.roles[i]
    const prefix = `preset.roles[${i}]`

    if (!role.id || typeof role.id !== 'string') {
      errors.push(`${prefix}.id is required and must be a string`)
    }

    if (!role.name || typeof role.name !== 'string') {
      errors.push(`${prefix}.name is required and must be a string`)
    }

    if (!role.reason || typeof role.reason !== 'string') {
      errors.push(`${prefix}.reason is required and must be a string`)
    }

    if (!VALID_AGENT_TYPES.has(role.agentType)) {
      errors.push(
        `${prefix}.agentType "${role.agentType}" is not a valid canonical agent type`,
      )
    }

    const validModels = ['sonnet', 'opus', 'haiku']
    if (!validModels.includes(role.model)) {
      errors.push(
        `${prefix}.model "${role.model}" must be one of: ${validModels.join(', ')}`,
      )
    }
  }

  return { valid: errors.length === 0, errors }
}

export { loadPresets, getPreset, listPresets, validatePreset }
