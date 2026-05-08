// Bidirectional registry linking presets to contexts.
// Mirrors composition.js link validation.

import type { ContextProfile } from '../../types/mammoth'

// ── Static Mappings ──

const contextToPresets: Record<string, string[]> = {
  dev: ['feature', 'fullstack'],
  review: ['review', 'santa-method'],
  debug: ['debug'],
  security: ['security'],
  research: ['research'],
  deploy: [],
}

const presetToContext: Record<string, ContextProfile> = {
  feature: 'dev',
  fullstack: 'dev',
  review: 'review',
  'santa-method': 'review',
  debug: 'debug',
  security: 'security',
  research: 'research',
}

function isValidContext(name: string): name is ContextProfile {
  return Object.keys(contextToPresets).includes(name)
}

// ── Public API ──

/** Get all preset names associated with a context. */
export function getPresetsForContext(context: ContextProfile): string[] {
  return contextToPresets[context] ?? []
}

/** Get the context a preset belongs to, or null if unknown. */
export function getContextForPreset(presetName: string): ContextProfile | null {
  const ctx = presetToContext[presetName]
  if (!ctx) return null
  return isValidContext(ctx) ? ctx : null
}

/** Validate all preset-context mappings are consistent. */
export function validateComposition(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check: every preset references a known context
  for (const [preset, context] of Object.entries(presetToContext)) {
    if (!isValidContext(context)) {
      errors.push(
        `Preset "${preset}" references unknown context "${context}".`,
      )
    }
  }

  // Check: every context's presets must exist as known presets
  for (const [context, presets] of Object.entries(contextToPresets)) {
    for (const preset of presets) {
      if (!(preset in presetToContext)) {
        errors.push(
          `Context "${context}" references unknown preset "${preset}".`,
        )
      }
    }
  }

  // Check: bidirectional consistency — preset→context must match context→presets
  for (const [preset, context] of Object.entries(presetToContext)) {
    const presetsForContext = contextToPresets[context]
    if (presetsForContext && !presetsForContext.includes(preset)) {
      errors.push(
        `Preset "${preset}" maps to context "${context}", but context "${context}" does not list "${preset}".`,
      )
    }
  }

  // Check: context→preset must match preset→context
  for (const [context, presets] of Object.entries(contextToPresets)) {
    for (const preset of presets) {
      const mappedContext = presetToContext[preset]
      if (mappedContext && mappedContext !== context) {
        errors.push(
          `Context "${context}" lists preset "${preset}", but preset "${preset}" maps to context "${mappedContext}".`,
        )
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/** List all composition mappings. */
export function listCompositions(): Array<{
  preset: string
  context: ContextProfile
}> {
  return Object.entries(presetToContext).map(([preset, context]) => ({
    preset,
    context,
  }))
}
