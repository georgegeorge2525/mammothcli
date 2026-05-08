// Mammoth Contexts — Mode definitions, reinforcement caps, tier map
// Single source of truth for autonomous workflow modes

export const PERSISTENT_MODES = [
  'autopilot', 'ralph', 'ultrawork', 'team', 'pipeline',
  'swarm', 'ultraqa', 'research', 'review', 'deep-interview'
] as const;

export const AUTONOMOUS_RESUME_MODES = [
  'autopilot', 'ralph', 'ultrawork', 'research', 'review',
  'pipeline', 'ultraqa'
] as const;

export const REINFORCEMENT_CAPS: Record<string, number> = {
  ralph: 100,
  autopilot: 50,
  ultrawork: 50,
  team: 30,
  pipeline: 40,
  swarm: 30,
  ultraqa: 20,
  research: 30,
  review: 20,
  'deep-interview': 10,
};

export const MODE_TIER_MAP: Record<string, number> = {
  review: 1,
  'deep-interview': 1,
  research: 1,
  autopilot: 2,
  team: 2,
  pipeline: 2,
  ralph: 3,
  ultraqa: 3,
  ultrawork: 4,
  swarm: 4,
  'self-improve': 3,
};

export const TIER_DESCRIPTIONS: Record<number, string> = {
  0: 'DIRECT: Do it yourself. No agents. No mode. One shot.',
  1: 'DELEGATED: Spawn executor. Wait for result. Verify. Done.',
  2: 'AUTOPILOT: Multi-step work. Create workflow state. Loop: assess→delegate→verify→repeat. Auto-continue between steps. Report progress.',
  3: 'RALPH: Quality-critical — verification MUST pass. Mandatory verification gate each iteration. Fail→fix→re-verify. Circuit breaker at 3 failures→escalate to architect.',
  4: 'ULTRAWORK: 3+ independent sub-tasks. Identify all independent tasks. Spawn ALL agents simultaneously. Collect→integrate→verify gaps. Spawn more if needed.',
};

export const STAGE_HINTS: Record<string, string> = {
  context: 'Gather project context, tech stack, conventions, and affected files.',
  plan: 'Write implementation plan with file ownership and change sequence.',
  implement: 'Execute plan in phases, verify each checkpoint.',
  verify: 'Confirm correctness: tests pass, diagnostics clean, no debug code left.',
  gather: 'Collect changed files, diff context, and PR description.',
  analyze: 'Deep-read changes for correctness, security, performance, and style.',
  prioritize: 'Rank findings by severity, filter noise, group related issues.',
  report: 'Produce structured review with severity summary and clear verdict.',
  reproduce: 'Trigger the bug consistently and capture the full failure signature.',
  isolate: 'Narrow to minimal reproduction case by eliminating irrelevant variables.',
  hypothesize: 'Form a testable root-cause hypothesis based on evidence collected.',
  test: 'Validate hypothesis with a targeted diagnostic probe.',
  fix: 'Apply the minimal correct fix at the root cause.',
  threatmodel: 'Define assets, actors, boundaries, and attack surface.',
  scan: 'Automated and manual scanning for known vulnerability patterns.',
  remediate: 'Apply fixes for confirmed vulnerabilities, starting with critical.',
  search: 'Broad parallel search across codebase and external sources.',
  crossvalidate: 'Verify findings against independent sources.',
  synthesize: 'Produce coherent synthesis with findings and recommendations.',
  precheck: 'Validate all pre-deploy gates: tests, lint, migrations, configs.',
  stage: 'Build and stage artifacts in target environment.',
  canary: 'Deploy to small subset and monitor for anomalies.',
  rollout: 'Incrementally roll out to remaining instances.',
  monitor: 'Observe production health for stabilization window.',
  rollback: 'Revert to previous known-good state.',
};

export const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export function getTierDescription(tier: number): string {
  return TIER_DESCRIPTIONS[tier] || TIER_DESCRIPTIONS[0];
}

export function getModeTier(mode: string): number {
  return MODE_TIER_MAP[mode] || 0;
}

export function isPersistent(type: string): boolean {
  return PERSISTENT_MODES.some(m => type === m);
}

export function isAutonomousResume(type: string): boolean {
  return AUTONOMOUS_RESUME_MODES.some(m => type === m);
}

export function getReinforcementCap(mode: string): number {
  return REINFORCEMENT_CAPS[mode] || 30;
}
