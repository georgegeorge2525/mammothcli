import type { AgentSpec, TeamPreset, AgentSpawnInstruction, TeamResult, ParallelismMode } from './types.js';

// Complexity assessment keywords
const FORCE_COMPLEX_KEYWORDS = ['critical', 'production', 'security', 'data loss', 'vulnerability', 'breach', 'auth', 'encrypt'];
const FORCE_SIMPLE_KEYWORDS = ['typo', 'rename', 'simple fix', 'add comment', 'formatting', 'whitespace', 'spelling'];

// Agent type defaults for model routing
const OPUS_REQUIRED = ['debugger', 'code-reviewer', 'security-reviewer', 'verifier', 'architect'];
const SONNET_DEFAULT = ['executor', 'designer', 'git-master', 'qa-tester', 'analyst', 'test-engineer', 'scientist', 'critic', 'planner', 'tracer', 'code-simplifier'];
const HAIKU_DEFAULT = ['explore', 'writer', 'document-specialist'];

// Hardcoded preset definitions (replaces .md file parsing)
const BUILTIN_PRESETS: Record<string, Omit<TeamPreset, 'name'>> = {
  review: {
    agents: [
      { role: 'Security Reviewer', type: 'security-reviewer', description: 'Review for security vulnerabilities' },
      { role: 'Code Reviewer', type: 'code-reviewer', description: 'Review code quality and patterns' },
      { role: 'Architect', type: 'architect', description: 'Review architectural decisions' },
    ],
    strategy: 'All reviewers run in parallel. Each produces independent findings.',
    verification: 'Cross-reference all findings. Resolve conflicts via majority.',
    parallelism: 'full',
  },
  debug: {
    agents: [
      { role: 'Lead Debugger', type: 'debugger', description: 'Primary hypothesis investigation' },
      { role: 'Debugger 2', type: 'debugger', description: 'Alternative hypothesis investigation' },
      { role: 'Debugger 3', type: 'debugger', description: 'Edge case investigation' },
    ],
    strategy: 'Three competing hypotheses investigated in parallel.',
    verification: 'Each debugger reports findings. Lead debugger synthesizes.',
    parallelism: 'full',
  },
  research: {
    agents: [
      { role: 'Researcher 1', type: 'explore', description: 'Primary codebase search' },
      { role: 'Researcher 2', type: 'explore', description: 'External documentation search' },
      { role: 'Researcher 3', type: 'explore', description: 'Pattern and convention analysis' },
    ],
    strategy: 'Parallel research across codebase, docs, and patterns.',
    verification: 'Findings cross-validated against each other.',
    parallelism: 'full',
  },
};

export function parsePreset(name: string, _taskContext?: string): TeamPreset | null {
  const def = BUILTIN_PRESETS[name];
  if (!def) return null;
  return { name, ...def };
}

export function assessComplexity(task: string, agentType: string): 'simple' | 'standard' | 'complex' {
  const taskLower = task.toLowerCase();

  for (const kw of FORCE_COMPLEX_KEYWORDS) {
    if (taskLower.includes(kw)) return 'complex';
  }
  for (const kw of FORCE_SIMPLE_KEYWORDS) {
    if (taskLower.includes(kw)) return 'simple';
  }

  // Agent type defaults
  if (OPUS_REQUIRED.includes(agentType)) return 'complex';
  if (HAIKU_DEFAULT.includes(agentType)) return 'simple';

  // File count heuristic
  const fileMatch = task.match(/(\d+)\s*[-+]?\s*(?:files?|modules?|components?|endpoints?)/i);
  if (fileMatch) {
    const count = parseInt(fileMatch[1], 10);
    if (count === 1) return 'simple';
    if (count <= 5) return 'standard';
    return 'complex';
  }

  // Keyword classification
  if (/\b(?:cross[- ]module|refactor|architect|redesign|migrat)\b/i.test(task)) return 'complex';
  if (/\b(?:single[- ]file|simple|trivial|minor|one[- ]line)\b/i.test(task)) return 'simple';
  if (/\b(?:across|multiple|several|various)\b/i.test(task)) return 'standard';

  return 'standard';
}

export function selectModel(complexity: string, agentType: string): string {
  if (OPUS_REQUIRED.includes(agentType)) return 'opus';
  if (HAIKU_DEFAULT.includes(agentType)) return 'haiku';
  if (SONNET_DEFAULT.includes(agentType)) return 'sonnet';

  // Fallback by complexity
  if (complexity === 'complex') return 'opus';
  if (complexity === 'simple') return 'haiku';
  return 'sonnet';
}

export function normalizeAgentType(type: string): string {
  const map: Record<string, string> = {
    lead: 'architect', architect: 'architect',
    implementer: 'executor', backend: 'executor', 'backend-dev': 'executor',
    frontend: 'designer', 'frontend-dev': 'designer',
    tester: 'test-engineer', 'test-engineer': 'test-engineer',
    researcher: 'explore', 'researcher-1': 'explore', 'researcher-2': 'explore', 'researcher-3': 'explore',
    reviewer: 'code-reviewer', 'reviewer-alpha': 'code-reviewer', 'reviewer-beta': 'code-reviewer',
    'code-reviewer': 'code-reviewer', 'santa-method': 'code-reviewer',
    'security-reviewer': 'security-reviewer', 'web-security': 'security-reviewer',
    'infra-security': 'security-reviewer', 'data-security': 'security-reviewer',
    'dependency-security': 'security-reviewer',
    debugger: 'debugger', 'lead-debugger': 'debugger',
    writer: 'writer', designer: 'designer',
    'document-specialist': 'document-specialist',
    'qa-tester': 'qa-tester', scientist: 'scientist',
    planner: 'planner', analyst: 'analyst', critic: 'critic', tracer: 'tracer',
    'git-master': 'git-master', 'code-simplifier': 'code-simplifier',
    verifier: 'verifier',
  };
  return map[type] || type;
}

export function generateOrchestrationContext(presetName: string, task: string, workflowId: string): string | null {
  const preset = parsePreset(presetName);
  if (!preset) return null;

  const agentLines = preset.agents.map(a => {
    const complexity = assessComplexity(task, a.type);
    const model = selectModel(complexity, a.type);
    return `- ${a.role} (${a.type}) [${model.toUpperCase()}]`;
  }).join('\n');

  const proCount = preset.agents.filter(a => selectModel(assessComplexity(task, a.type), a.type) === 'opus').length;
  const flashCount = preset.agents.length - proCount;

  return [
    '<team_orchestration>',
    `Team: ${preset.name} | ${preset.parallelism} | ${preset.agents.length} agents`,
    '',
    '## Task',
    task,
    '',
    '## Agent Roster',
    agentLines,
    '',
    '## Model Routing',
    `${proCount} agents on PRO (opus), ${flashCount} on flash`,
    '',
    '## Strategy',
    preset.strategy,
    '',
    '## Verification',
    preset.verification,
    '',
    `Workflow ID: ${workflowId}`,
    '</team_orchestration>',
  ].join('\n');
}

export function generateSpawnInstructions(agent: AgentSpec, taskContext: string): AgentSpawnInstruction {
  return {
    description: `${agent.role}: ${agent.description}`,
    prompt: `Task: ${taskContext}\n\nRole: ${agent.role}\nType: ${agent.type}\nDescription: ${agent.description}`,
    subagentType: normalizeAgentType(agent.type),
    model: selectModel(assessComplexity(taskContext, agent.type), agent.type),
    runInBackground: true,
  };
}

export function collectResults(agentResults: Array<{ agentName: string; result: string; error?: string }>): TeamResult {
  const total = agentResults.length;
  const succeeded = agentResults.filter(a => !a.error).length;
  const failed = total - succeeded;
  const findings = agentResults.filter(a => !a.error).map(a => a.result.slice(0, 500));
  const gaps = agentResults.filter(a => a.error).map(a => `${a.agentName}: ${a.error}`);

  const integrationNeeded: string[] = [];
  if (failed > 0) {
    integrationNeeded.push(`${failed} agent(s) failed — review gaps and respawn if needed`);
  }
  if (succeeded > 1) {
    integrationNeeded.push('Cross-reference findings from all successful agents');
  }

  return { total, succeeded, failed, findings, gaps, integrationNeeded };
}

export function listPresets(): string[] {
  return Object.keys(BUILTIN_PRESETS);
}