// src/services/mammoth/quality/lint.ts — PluginEval Layer 1: Static Analysis Linter
// Scores skill directories against anti-pattern rules. <2s, zero cost.
// Ported from Mammoth/quality/lint.js.

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import type { AntiPattern, QualityGrade } from '../../types/mammoth'
import { QUALITY_THRESHOLDS } from '../../constants/mammoth'

// Anti-patterns with descriptions and penalty weights
const ANTI_PATTERNS: Record<AntiPattern, { description: string; weight: number }> = {
  OVER_CONSTRAINED: { description: 'Triggers are too narrow, skill rarely activates', weight: 0.15 },
  EMPTY_DESCRIPTION: { description: 'Metadata description is missing or empty', weight: 0.10 },
  MISSING_TRIGGER: { description: 'No trigger keywords defined', weight: 0.20 },
  BLOATED_SKILL: { description: 'Instructions exceed 500 lines', weight: 0.10 },
  MISSING_EXAMPLES: { description: 'No example resources found', weight: 0.10 },
  CIRCULAR_REFERENCE: { description: 'Skill references itself or creates a cycle', weight: 0.20 },
  ORPHAN_REFERENCE: { description: 'References a non-existent skill or file', weight: 0.10 },
  DEAD_CROSS_REF: { description: 'Cross-reference to skill that lacks return reference', weight: 0.05 },
}

export interface LintResult {
  skillName: string
  score: number          // 0-100, lower = more anti-patterns
  antiPatterns: AntiPattern[]
  details: string[]
}

interface Finding {
  pattern: string
  penalty: number
  detail: string
  fix: string
}

// ── Anti-pattern detectors ──

function detectOverConstrained(metadata: string): Finding | null {
  const triggerLine = metadata.split('\n').find((l) => l.startsWith('triggers:'))
  if (!triggerLine) return null
  const match = triggerLine.match(/\[([^\]]+)\]/)
  if (!match) return null
  const triggers = match[1].split(',').map((t) => t.trim())
  if (triggers.length > 5) {
    return {
      pattern: 'OVER_CONSTRAINED',
      penalty: 15,
      detail: `${triggers.length} triggers (max recommended: 5)`,
      fix: 'Reduce to 2-3 core triggers. Use broader patterns.',
    }
  }
  return null
}

function detectEmptyDescription(metadata: string): Finding | null {
  const descMatch = metadata.match(/description\s*:\s*(.+)/i)
  if (!descMatch || !descMatch[1]) {
    return {
      pattern: 'EMPTY_DESCRIPTION',
      penalty: 20,
      detail: 'Missing description field',
      fix: 'Write clear 1-2 sentence description of what the skill does.',
    }
  }
  const desc = descMatch[1].trim().replace(/['"]/g, '')
  if (desc.length < 10 || ['TODO', 'WIP', 'TBD', '...'].some((w) => desc.includes(w))) {
    return {
      pattern: 'EMPTY_DESCRIPTION',
      penalty: 20,
      detail: `Description too short or placeholder: "${desc}"`,
      fix: 'Write clear 1-2 sentence description of what the skill does.',
    }
  }
  return null
}

function detectMissingTrigger(metadata: string): Finding | null {
  if (!metadata.includes('triggers:')) {
    return {
      pattern: 'MISSING_TRIGGER',
      penalty: 15,
      detail: 'No triggers field in metadata',
      fix: 'Add triggers: [keyword1, keyword2, ...] to metadata.md',
    }
  }
  return null
}

function detectBloatedSkill(instructionsPath: string): Finding | null {
  try {
    const content = readFileSync(instructionsPath, 'utf8')
    const lines = content.split('\n').length
    if (lines > 500) {
      return {
        pattern: 'BLOATED_SKILL',
        penalty: 10,
        detail: `instructions.md is ${lines} lines (max: 500)`,
        fix: 'Split into sub-skills or move reference material to resources/',
      }
    }
  } catch {
    // File missing, handled by other checks
  }
  return null
}

function detectMissingExamples(resourcesDir: string): Finding | null {
  try {
    if (!existsSync(resourcesDir)) {
      return {
        pattern: 'MISSING_EXAMPLES',
        penalty: 5,
        detail: 'No resources/ directory',
        fix: 'Create resources/ with at least 2 usage examples.',
      }
    }
    const files = readdirSync(resourcesDir).filter((f) => !f.startsWith('.'))
    if (files.length === 0) {
      return {
        pattern: 'MISSING_EXAMPLES',
        penalty: 5,
        detail: 'resources/ directory is empty',
        fix: 'Add at least 2 usage examples in resources/.',
      }
    }
  } catch {
    // Skip
  }
  return null
}

function detectCircularReference(instructionsPath: string, skillName: string): Finding | null {
  try {
    const content = readFileSync(instructionsPath, 'utf8')
    const selfRefs = [
      new RegExp(`delegate to ${skillName}`, 'i'),
      new RegExp(`spawn ${skillName}`, 'i'),
      new RegExp(`Task\\(.*${skillName}`, 'i'),
      new RegExp(`subagent_type.*${skillName}`, 'i'),
    ]
    for (const ref of selfRefs) {
      if (ref.test(content)) {
        return {
          pattern: 'CIRCULAR_REFERENCE',
          penalty: 25,
          detail: `instructions.md references itself (pattern: ${ref.source})`,
          fix: 'Remove self-references. Delegate to different skill.',
        }
      }
    }
  } catch {
    // Skip
  }
  return null
}

function detectMissingInstructions(skillDir: string): Finding {
  const instPath = join(skillDir, 'instructions.md')
  if (!existsSync(instPath)) {
    return {
      pattern: 'MISSING_INSTRUCTIONS',
      penalty: 25,
      detail: 'No instructions.md found',
      fix: 'Create instructions.md with the skill behavior definition.',
    }
  }
  return { pattern: '', penalty: 0, detail: '', fix: '' }
}

// ── PluginEval Anti-Pattern Detection (multiplicative penalty layer) ──

function detectAntiPatterns(
  skillDir: string,
  metadata: string,
  instructions: string,
  allSkills: string[],
): { flags: string[]; flagDetails: Finding[]; penalty: number } {
  const flags: Finding[] = []
  const skillName = basename(skillDir)

  // 1. OVER_CONSTRAINED — > 15 MUST/ALWAYS/NEVER directives in instructions.md
  if (instructions) {
    const directives = (instructions.match(/\b(MUST|ALWAYS|NEVER)\b/gi) || []).length
    if (directives > 15) {
      flags.push({
        pattern: 'OVER_CONSTRAINED',
        penalty: 0,
        detail: `${directives} MUST/ALWAYS/NEVER directives (max: 15)`,
        fix: 'Reduce imperative directives. Use recommendations over requirements.',
      })
    }
  }

  // 2. EMPTY_DESCRIPTION — description < 20 characters in metadata.md
  if (metadata) {
    const descMatch = metadata.match(/description\s*:\s*(.+)/i)
    const desc = descMatch ? descMatch[1].trim().replace(/['"]/g, '') : ''
    if (desc.length < 20) {
      flags.push({
        pattern: 'EMPTY_DESCRIPTION',
        penalty: 0,
        detail: `Description is ${desc.length} chars (min: 20)`,
        fix: 'Write a clear 1-2 sentence description of what the skill does.',
      })
    }
  } else {
    flags.push({
      pattern: 'EMPTY_DESCRIPTION',
      penalty: 0,
      detail: 'No metadata.md found (description not available)',
      fix: 'Create metadata.md with a description field >= 20 characters.',
    })
  }

  // 3. MISSING_TRIGGER — No "Use when" trigger phrase in description
  if (metadata) {
    const descMatch = metadata.match(/description\s*:\s*(.+)/i)
    const desc = descMatch ? descMatch[1] : ''
    if (!/Use when/i.test(desc)) {
      flags.push({
        pattern: 'MISSING_TRIGGER',
        penalty: 0,
        detail: 'Description does not contain "Use when" activation phrase',
        fix: 'Add "Use when" to description to clarify when the skill should activate.',
      })
    }
  } else {
    flags.push({
      pattern: 'MISSING_TRIGGER',
      penalty: 0,
      detail: 'No metadata.md found (cannot verify trigger description)',
      fix: 'Create metadata.md with description containing "Use when" activation phrase.',
    })
  }

  // 4. BLOATED_SKILL — > 800 lines without a resources/ directory
  if (instructions) {
    const lines = instructions.split('\n').length
    let hasResources = false
    try {
      const resourcesDir = join(skillDir, 'resources')
      if (existsSync(resourcesDir)) {
        const resFiles = readdirSync(resourcesDir).filter((f) => !f.startsWith('.'))
        hasResources = resFiles.length > 0
      }
    } catch {
      // Ignore
    }
    if (lines > 800 && !hasResources) {
      flags.push({
        pattern: 'BLOATED_SKILL',
        penalty: 0,
        detail: `instructions.md is ${lines} lines with no resources/ directory`,
        fix: 'Move reference material or examples to resources/ directory.',
      })
    }
  }

  // 5. ORPHAN_REFERENCE — Dead link to a file in resources/
  if (instructions && skillDir) {
    const refPattern = /(?:resources\/[^\s)\]]+|`[^`]*resources\/[^`]*`)/gi
    const refs = instructions.match(refPattern) || []
    for (const ref of refs) {
      const cleanRef = ref.replace(/`/g, '').trim()
      const resolvedPath = join(skillDir, cleanRef)
      if (!existsSync(resolvedPath)) {
        flags.push({
          pattern: 'ORPHAN_REFERENCE',
          penalty: 0,
          detail: `Dead link to resources/ file: ${cleanRef}`,
          fix: 'Fix or remove the broken reference to resources/ file.',
        })
        break
      }
    }
  }

  // 6. DEAD_CROSS_REF — Cross-reference to non-existent skill/agent
  if (instructions && allSkills && allSkills.length > 0) {
    const allLower = allSkills.map((s) => s.toLowerCase())
    const skillRefs = instructions.match(
      /(?:delegate to|spawn|use the|consult the|escalate to|hand off to|route to)\s+([\w][\w-]*[\w])/gi,
    ) || []
    for (const skillRef of skillRefs) {
      const skillPart = skillRef
        .replace(/(?:delegate to|spawn|use the|consult the|escalate to|hand off to|route to)\s+/i, '')
        .trim()
      if (
        skillPart.length > 2 &&
        !allLower.includes(skillPart.toLowerCase()) &&
        skillPart.toLowerCase() !== skillName.toLowerCase()
      ) {
        flags.push({
          pattern: 'DEAD_CROSS_REF',
          penalty: 0,
          detail: `References unknown skill/agent: "${skillPart}"`,
          fix: 'Update cross-reference to an existing skill or remove it.',
        })
        break
      }
    }
  }

  // Multiplicative penalty: each flag reduces score by 5%, minimum 50% of original
  const penaltyFactor = Math.max(0.5, 1.0 - 0.05 * flags.length)

  return {
    flags: flags.map((f) => f.pattern),
    flagDetails: flags,
    penalty: Math.round(penaltyFactor * 100) / 100,
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

// ── Main lint functions ──

function lintSkill(skillDir: string, allSkills?: string[]): LintResult {
  const skillName = basename(skillDir)
  const metadataPath = join(skillDir, 'metadata.md')
  const instructionsPath = join(skillDir, 'instructions.md')
  const resourcesDir = join(skillDir, 'resources')

  const findings: Finding[] = []

  if (!existsSync(skillDir)) {
    return {
      skillName,
      score: 0,
      antiPatterns: [],
      details: [`Directory not found: ${skillDir}`],
    }
  }

  // Read metadata
  let metadata = ''
  if (existsSync(metadataPath)) {
    metadata = readFileSync(metadataPath, 'utf8')
  } else {
    findings.push({
      pattern: 'MISSING_METADATA',
      penalty: 30,
      detail: 'No metadata.md found',
      fix: 'Create metadata.md with name, triggers, grade, and description frontmatter.',
    })
  }

  // Read instructions (for anti-pattern detection)
  let instructions = ''
  if (existsSync(instructionsPath)) {
    instructions = readFileSync(instructionsPath, 'utf8')
  }

  // Run all detectors
  if (metadata) {
    const detections = [
      detectOverConstrained(metadata),
      detectEmptyDescription(metadata),
      detectMissingTrigger(metadata),
    ]
    for (const d of detections) {
      if (d) findings.push(d)
    }
  }

  if (existsSync(instructionsPath)) {
    const detections = [
      detectBloatedSkill(instructionsPath),
      detectCircularReference(instructionsPath, skillName),
    ]
    for (const d of detections) {
      if (d) findings.push(d)
    }
  } else {
    const missing = detectMissingInstructions(skillDir)
    if (missing.pattern) findings.push(missing)
  }

  const exampleFinding = detectMissingExamples(resourcesDir)
  if (exampleFinding) findings.push(exampleFinding)

  // Calculate score
  let score = 100
  for (const f of findings) {
    score -= f.penalty
  }
  score = Math.max(0, score)

  // Apply PluginEval multiplicative anti-pattern penalty
  const antiResult = detectAntiPatterns(skillDir, metadata, instructions, allSkills || [])
  if (antiResult.flags.length > 0) {
    score = Math.round(Math.max(0, score) * antiResult.penalty)
    for (const flagDetail of antiResult.flagDetails) {
      findings.push({
        pattern: `ANTI_${flagDetail.pattern}`,
        penalty: 0,
        detail: flagDetail.detail,
        fix: flagDetail.fix,
      })
    }
  }
  score = Math.max(0, score)

  // Build result
  const antiPatterns = new Set<AntiPattern>()
  for (const f of findings) {
    const pattern = f.pattern.startsWith('ANTI_') ? f.pattern.slice(5) : f.pattern
    if (pattern in ANTI_PATTERNS) {
      antiPatterns.add(pattern as AntiPattern)
    }
  }

  return {
    skillName,
    score,
    antiPatterns: [...antiPatterns],
    details: findings.map((f) => `[${f.pattern}] -${f.penalty}pts: ${f.detail} (Fix: ${f.fix})`),
  }
}

function lintAll(skillsRoot: string): LintResult[] {
  if (!existsSync(skillsRoot)) {
    return []
  }

  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(skillsRoot, d.name))

  const allSkillNames = skillDirs.map((d) => basename(d))
  const results = skillDirs.map((d) => lintSkill(d, allSkillNames))

  return results.sort((a, b) => b.score - a.score)
}

function calculateLintGrade(score: number): QualityGrade {
  return calculateGrade(score)
}

export { lintSkill, lintAll, calculateLintGrade, ANTI_PATTERNS }
