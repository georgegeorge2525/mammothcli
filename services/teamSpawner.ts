import type {
  TeamPreset,
  TeamRole,
  CanonicalAgentType,
  ContextProfile,
} from '../types/mammoth.js';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { MammothEngine } from './engine';

// ── Canonical Agent Type Map ──

// Canonical agent types mapped to CC Agent tool agent types
const AGENT_TYPE_MAP: Record<string, CanonicalAgentType> = {
  'lead': 'architect',
  'planner': 'planner',
  'architect': 'architect',
  'implementer': 'executor',
  'implementer-1': 'executor',
  'implementer-2': 'executor',
  'executor': 'executor',
  'reviewer': 'code-reviewer',
  'reviewer-alpha': 'code-reviewer',
  'reviewer-beta': 'code-reviewer',
  'code-reviewer': 'code-reviewer',
  'security': 'security-reviewer',
  'security-reviewer': 'security-reviewer',
  'web-security': 'security-reviewer',
  'infra-security': 'security-reviewer',
  'data-security': 'security-reviewer',
  'dependency-security': 'security-reviewer',
  'debugger': 'debugger',
  'lead-debugger': 'debugger',
  'tester': 'qa-tester',
  'qa': 'qa-tester',
  'qa-tester': 'qa-tester',
  'designer': 'designer',
  'frontend': 'designer',
  'frontend-dev': 'designer',
  'writer': 'writer',
  'scientist': 'scientist',
  'researcher': 'explore',
  'researcher-1': 'explore',
  'researcher-2': 'explore',
  'researcher-3': 'explore',
  'explore': 'explore',
  'git': 'git-master',
  'git-master': 'git-master',
  'docs': 'document-specialist',
  'document-specialist': 'document-specialist',
  'verifier': 'verifier',
  'analyst': 'analyst',
  'critic': 'critic',
  'simplifier': 'code-simplifier',
  'code-simplifier': 'code-simplifier',
  'tracer': 'tracer',
  'test-engineer': 'test-engineer',
  'backend': 'executor',
  'backend-dev': 'executor',
  'fullstack': 'executor',
  'santa-method': 'code-reviewer',
};

// Set of valid canonical agent types for fallback matching
const VALID_AGENT_TYPES: ReadonlySet<string> = new Set([
  'executor', 'debugger', 'explore', 'code-reviewer', 'security-reviewer',
  'verifier', 'architect', 'analyst', 'planner', 'designer', 'writer',
  'document-specialist', 'test-engineer', 'qa-tester', 'scientist', 'tracer',
  'git-master', 'critic', 'code-simplifier',
]);

// ── Parallelism Detection ──

// Detect parallelism intent from preset content keywords
function detectParallelism(content: string): 'full' | 'sequential' | 'hybrid' {
  // Hybrid takes priority — two-phase or wave-based execution
  if (/wave\s*[12]|hybrid|staged|two[.\s-]phase/i.test(content)) {
    return 'hybrid';
  }
  // Full parallel — explicit parallel keywords
  if (/parallel|simultaneously|concurrently|independent/i.test(content)) {
    return 'full';
  }
  // Sequential — explicit sequential keywords
  if (/sequential|step by step|one after|pipeline/i.test(content)) {
    return 'sequential';
  }
  // Default to full parallel for multi-agent presets
  return 'full';
}

// ── Agent Type Normalization ──

// Normalize a free-form role name to a canonical agent type.
// Uses direct map lookup first, then strips suffixes and tries again,
// then falls back to substring matching against known valid types.
function normalizeAgentType(roleName: string): CanonicalAgentType {
  // Clean: strip parenthesized role mappings like '(planner/architect)'
  const cleaned = roleName.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();

  // Direct lookup
  if (AGENT_TYPE_MAP[cleaned]) {
    return AGENT_TYPE_MAP[cleaned];
  }

  // Try stripping numeric suffixes: implementer-1 → implementer
  const stripped = cleaned.replace(/-\d+$/, '');
  if (stripped !== cleaned && AGENT_TYPE_MAP[stripped]) {
    return AGENT_TYPE_MAP[stripped];
  }

  // Try stripping common suffixes: -dev, -alpha, -beta
  const strippedSuffix = cleaned.replace(/-(dev|alpha|beta)$/, '');
  if (strippedSuffix !== cleaned && AGENT_TYPE_MAP[strippedSuffix]) {
    return AGENT_TYPE_MAP[strippedSuffix];
  }

  // Fallback: substring match against valid agent types
  for (const valid of VALID_AGENT_TYPES) {
    if (cleaned.includes(valid) || valid.includes(cleaned)) {
      return valid as CanonicalAgentType;
    }
  }

  // Last resort: return cleaned name cast to CanonicalAgentType
  // (caller should validate)
  return cleaned as CanonicalAgentType;
}

// ── Preset Parsing ──

// Parse a preset markdown file into a TeamPreset
function parsePreset(presetPath: string): TeamPreset | null {
  if (!existsSync(presetPath)) {
    return null;
  }
  const content = readFileSync(presetPath, 'utf8');
  const name = basename(presetPath, '.md');
  return parsePresetContent(name, content);
}

// Parse a preset from markdown content string
function parsePresetContent(name: string, content: string): TeamPreset | null {
  const roles: TeamRole[] = [];

  // Extract YAML frontmatter
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  let context: ContextProfile = 'dev';
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    const ctxMatch = fm.match(/context:\s*(\w+)/);
    if (ctxMatch) {
      const raw = ctxMatch[1].toLowerCase();
      if (isValidContext(raw)) {
        context = raw;
      }
    }
  }

  // Extract title description (line after '# Team Preset: ...')
  let description = '';
  const titleMatch = content.match(/^#\s+Team Preset:\s*.+/m);
  if (titleMatch) {
    const titleIndex = content.indexOf(titleMatch[0]);
    const afterTitle = content.slice(titleIndex + titleMatch[0].length);
    const descMatch = afterTitle.match(/^\s*\n\s*([^\n]+)/);
    if (descMatch) {
      description = descMatch[1].trim();
    }
  }

  // Extract Members count
  const membersMatch = content.match(/[-*]\s+Members:\s*(\d+)/i);
  const members = membersMatch ? parseInt(membersMatch[1], 10) : 0;

  // Extract Roles line: '- Roles: type1, type2, type3' or with (N instances)
  const rolesMatch = content.match(/[-*]\s+Roles:\s*([^\n]+)/i);
  const rolesLine = rolesMatch ? rolesMatch[1].trim() : '';

  if (rolesLine) {
    // Check for '(N instances)' pattern
    const instancesMatch = rolesLine.match(/\((\d+)\s*instances?\s*(?:with\s+)?([^)]*)\)/i);
    if (instancesMatch) {
      const count = parseInt(instancesMatch[1], 10);
      const desc = instancesMatch[2] || '';
      const agentType = normalizeAgentType(
        rolesLine.replace(/\s*\(\d+\s*instances[^)]*\)/i, '').trim(),
      );
      for (let i = 0; i < count; i++) {
        roles.push({
          id: `${agentType}-${i + 1}`,
          name: `${capitalize(agentType)}-${i + 1}`,
          agentType,
          model: 'sonnet',
          reason: desc || agentType,
        });
      }
    } else {
      // Comma-separated agent types
      const types = rolesLine.split(',').map((t) => {
        return t.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
      });
      for (const type of types) {
        if (!type) continue;
        const agentType = normalizeAgentType(type);
        roles.push({
          id: agentType,
          name: capitalize(type),
          agentType,
          model: 'sonnet',
          reason: type,
        });
      }
    }
  }

  // If members specified but no roles parsed, try detailed Agent lines
  if (members > 0 && roles.length === 0) {
    const agentSpecs =
      content.match(/- Agent \d+[:\s]*\**`?([^`*\n]+)`?\**\s*[—–-]\s*([^\n]+)/gi) || [];
    for (let i = 0; i < Math.min(members, agentSpecs.length); i++) {
      const spec = agentSpecs[i];
      const typeMatch = spec.match(/`([^`]+)`/);
      if (typeMatch) {
        const agentType = normalizeAgentType(typeMatch[1]);
        roles.push({
          id: `${agentType}-${i + 1}`,
          name: capitalize(agentType),
          agentType,
          model: 'sonnet',
          reason: spec.split(/[—–-]/).pop()?.trim() || agentType,
        });
      }
    }
  }

  // Enrich with detailed Agent line descriptions
  const agentLines = content.match(/- Agent \d+[:\s]+([^\n]+)/gi);
  if (agentLines) {
    for (let i = 0; i < agentLines.length && i < roles.length; i++) {
      const line = agentLines[i];
      const descMatch = line.match(/[—–-]\s*(.+)/);
      if (descMatch && roles[i]) {
        roles[i].reason = descMatch[1].trim().slice(0, 200);
      }
    }
  }

  // Fallback: scan for backtick-wrapped valid agent types
  if (roles.length === 0) {
    const agentRefs =
      content.match(/`([a-z][a-z-]+)`\s*(?:agent|reviewer|specialist)?/gi) || [];
    const seen = new Set<string>();
    for (const ref of agentRefs) {
      const cleaned = ref.replace(/`/g, '').trim();
      if (cleaned.length > 3 && !seen.has(cleaned) && VALID_AGENT_TYPES.has(cleaned)) {
        seen.add(cleaned);
        roles.push({
          id: cleaned,
          name: capitalize(cleaned),
          agentType: cleaned as CanonicalAgentType,
          model: 'sonnet',
          reason: cleaned,
        });
      }
    }
  }

  // Extract model assignments from table
  const modelMap = parseModelTable(content);
  for (const role of roles) {
    if (modelMap.has(role.agentType)) {
      role.model = modelMap.get(role.agentType)!;
    }
  }

  // Extract Strategy section
  const strategyMatch = content.match(
    /##\s*(?:Strategy|Protocol|Process)\s*\n([\s\S]*?)(?=##\s|$)/i,
  );
  const strategy = strategyMatch ? strategyMatch[1].trim() : '';

  // Extract Verification section
  const verifyMatch = content.match(
    /##\s*(?:Verification(?:\s*Gate)?|Communication|Outcome)\s*\n([\s\S]*?)(?=##\s|$)/i,
  );
  const verificationGate = verifyMatch ? verifyMatch[1].trim() : '';

  const parallelism = detectParallelism(content);

  return {
    name,
    description,
    context,
    parallelism,
    members: roles.length > 0 ? roles.length : members,
    roles,
    strategy,
    verificationGate,
  };
}

// ── Model Table Parser ──

// Parse the Model Assignment markdown table to extract per-role model preferences
function parseModelTable(content: string): Map<string, 'sonnet' | 'opus' | 'haiku'> {
  const map = new Map<string, 'sonnet' | 'opus' | 'haiku'>();
  const tableMatch = content.match(
    /\|.+Role.+\|.+Model.+\|[\s\S]*?\n((?:\|.+\|.+\|.*\n)+)/i,
  );
  if (!tableMatch) return map;

  const rows = tableMatch[1].split('\n').filter((r) => r.trim());
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      const roleCell = cells[0].toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
      const modelCell = cells[1].toLowerCase();
      const agentType = normalizeAgentType(roleCell);
      if (
        modelCell === 'sonnet' ||
        modelCell === 'opus' ||
        modelCell === 'haiku'
      ) {
        map.set(agentType, modelCell);
      }
    }
  }
  return map;
}

// ── Orchestration Context ──

// Generate orchestration context for a team spawn
function generateOrchestrationContext(
  preset: TeamPreset,
  task: string,
): {
  agents: Array<{
    role: string;
    agentType: CanonicalAgentType;
    model: string;
    instructions: string;
  }>;
  parallelism: 'full' | 'sequential' | 'hybrid';
  workflowId: string;
} {
  const workflowId = `team-${preset.name}-${Date.now()}`;

  const engine = MammothEngine.getInstance();
  const agents = preset.roles.map((role) => {
    const model = engine.getModelForAgent(role.agentType);
    return {
      role: role.name,
      agentType: role.agentType,
      model,
      instructions: generateSpawnInstructions(role, task, model),
    };
  });

  return {
    agents,
    parallelism: preset.parallelism,
    workflowId,
  };
}

// ── Agent Spawn Instructions ──

// Generate spawn instructions for a single agent
function generateSpawnInstructions(agent: TeamRole, taskContext: string, model?: string): string {
  const modelLine = model ? `Model: ${model}` : `Model: ${agent.model}`;
  return [
    `Role: ${agent.name}`,
    `Type: ${agent.agentType}`,
    modelLine,
    `Task: ${taskContext}`,
    `Context: ${agent.reason}`,
    '',
    'Report results back. Include: what you found, what you changed, what still needs attention.',
  ].join('\n');
}

// ── Result Collection ──

// Collect and merge results from multiple agents
function collectResults(
  agentResults: Array<{ agent: string; output: string }>,
): {
  merged: string;
  status: 'complete' | 'partial' | 'failed';
} {
  const total = agentResults.length;
  if (total === 0) {
    return { merged: '', status: 'failed' };
  }

  const succeeded: Array<{ agent: string; output: string }> = [];
  const failed: string[] = [];

  for (const result of agentResults) {
    if (!result.output || result.output.trim() === '') {
      failed.push(result.agent);
    } else {
      succeeded.push(result);
    }
  }

  // Merge succeeded outputs
  const mergedParts = succeeded.map(
    (r) => `## ${r.agent}\n${r.output}`,
  );
  const merged = mergedParts.join('\n\n');

  // Determine status
  if (failed.length === total) {
    return { merged, status: 'failed' };
  }
  if (failed.length > 0) {
    return { merged, status: 'partial' };
  }
  return { merged, status: 'complete' };
}

// ── Helpers ──

function capitalize(str: string): string {
  return str
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function isValidContext(value: string): value is ContextProfile {
  const validContexts: ReadonlySet<string> = new Set([
    'dev', 'review', 'debug', 'security', 'research', 'deploy',
  ]);
  return validContexts.has(value);
}

export {
  parsePreset,
  parsePresetContent,
  normalizeAgentType,
  generateOrchestrationContext,
  generateSpawnInstructions,
  collectResults,
  detectParallelism,
  AGENT_TYPE_MAP,
};
