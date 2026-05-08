# Agent Status UI — Terminal Dashboard Redesign

> **Design for:** `AgentStatus.tsx` → `AgentDashboard.tsx`  
> **Target:** Ink 4+ (React for CLI)  
> **Constraints:** Terminal-compatible, monospace, ANSI color, 80-char width friendly

---

## 1. Design Rationale

### Problem with Current Component

The existing `AgentStatus` component is a single-row, left-to-right badge bar. It works for one agent doing one thing, but it doesn't scale to multi-agent workflows, doesn't convey *progress*, and doesn't distinguish *states* beyond "thinking" vs "not thinking."

| Current limitation | Impact |
|---|---|
| No progress indication | User can't tell if a 2s or 2min operation |
| No state machine | "Thinking" is binary; can't show idle/done/error |
| No agent identity | Multi-agent setups blend together |
| Horizontal sprawl | Exceeds 80 cols with 4+ active tools |
| Fleeting visibility | Dismissed when idle; no history of recent actions |

### Design Goals

1. **Mini-dashboard**: Show all agents and their current state in a scannable layout.
2. **Progress bars**: Convey completion percentage for long-running tool calls.
3. **State encoding**: Use consistent icons + color for idle → running → done → error lifecycle.
4. **Compactness**: Respect terminal width; wrap gracefully.
5. **Non-intrusive**: Animate only when visible; respect Ink's rendering cycle.

---

## 2. State Model

```
                 ┌──────────┐
                 │   IDLE   │ ◌  (gray/dim)    Waiting for a task
                 └────┬─────┘
                      │ dispatch
                      ▼
              ┌───────────────┐
              │   STARTING    │ ⏳ (yellow)      Initializing context
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐
              │   THINKING    │ ◷ (cyan)        LLM streaming / planning
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐
              │  TOOL_CALL    │ ⚡ (magenta)     Executing a tool (with progress %)
              └───────┬───────┘
                      │ repeating
                      │
              ┌───────┴───────┐
              │               │
              ▼               ▼
        ┌─────────┐    ┌──────────┐
        │  DONE   │    │  ERROR   │
        │  ✓      │    │  ✗       │
        │ (green) │    │ (red)    │
        └─────────┘    └──────────┘
```

**Transitions**:
- `IDLE` → `STARTING` — on task dispatch
- `STARTING` → `THINKING` — LLM begins
- `THINKING` → `TOOL_CALL` — tool invocation
- `TOOL_CALL` → `THINKING` — tool result, back to LLM
- `THINKING` → `DONE` — final answer produced
- Any active state → `ERROR` — exception

---

## 3. Color Scheme

```
┌───────────┬──────────┬───────────────────┬──────────────────────┐
│   State   │  Hex     │  ANSI (Ink)       │  Semantic meaning    │
├───────────┼──────────┼───────────────────┼──────────────────────┤
│ IDLE      │ #6B7280  │ gray / dim        │ Inactive, waiting    │
│ STARTING  │ #F59E0B  │ yellow / #F59E0B  │ Warm-up, preparing   │
│ THINKING  │ #0EA5E9  │ cyan / #06B6D4    │ Cognition, streaming │
│ TOOL_CALL │ #A855F7  │ magenta / #A855F7 │ Action, side-effect  │
│ DONE      │ #10B981  │ green / #22C55E   │ Success, complete    │
│ ERROR     │ #EF4444  │ red / #DC2626     │ Failure, alert       │
│ PROGRESS  │ #3B82F6  │ blue / #3B82F6    │ Progress bar fill    │
│ BG-DIM    │ #1F2937  │ bgGray / #374151  │ Card backgrounds     │
│ BORDER    │ #4B5563  │ gray / #6B7280    │ Box borders          │
└───────────┴──────────┴───────────────────┴──────────────────────┘
```

---

## 4. ASCII Mockups

### 4.1 Single Agent (Compact Mode, ≤ 80 cols)

```
┌─ mammoth ──────────────────────────────────────────────────────────┐
│                                                                     │
│  ◷  THINKING   "Evaluating user intent..."          0.8s           │
│     ↳ Tool: search_web                                           │
│     ████████████░░░░░░░░  58%  (3 / 5 steps)                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Multi-Agent Mini-Dashboard

```
╔══════════════════════════════════════════════════════════════════════╗
║                        MAMMOTH AGENTS                               ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  ◷ main-agent                                                       ║
║     THINKING  "Planning multi-step analysis..."        1.2s        ║
║     ██████████░░░░░░░░░░░░░░  42%                                ║
║                                                                      ║
║  ⚡ search-agent                                                     ║
║     TOOL_CALL  bing_search("latest AI news")          0.3s         ║
║     ████████████████████░░░░  78%  (7 / 9 results)               ║
║                                                                      ║
║  ✓ file-reader                                                      ║
║     DONE  data.csv (1,420 rows)                       2.1s         ║
║                                                                      ║
║  ✗ api-connector                                                    ║
║     ERROR  Connection refused (retry 3/3)             5.0s         ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  ● 2 active  │  ✓ 1 done  │  ✗ 1 failed  │  📋 5 workflows         ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 4.3 Single Agent with Details (Expanded Mode)

```
┌───────────────┐
│  ◷  THINKING  │  "Should I use search or code interpreter?"
├───────────────┤
│  Memory       │  12 facts loaded
│  Workflows    │  2 active, 3 completed
│  Tokens       │  1,247 / 8,192
├───────────────┤
│  Recent       │
│   ✓ web_fetch │  0.8s ago
│   ⚡ calculator│  2.1s ago
│   ✓ read_file │  5.3s ago
├───────────────┤
│  ⚡ tools     │  3 calls in last 10s
│  ◷ thinking   │  55% of cycle time
└───────────────┘
```

### 4.4 Progress Bar Variants

```
Determinate (known total):
  ████████████████░░░░░░░░░░░░  58%  [3/5]

Indeterminate (unknown total):
  ████████░░░░░░░░░░░░░░░░░░░░  ...  (bouncing / marquee)

Pulse (just started, no estimate):
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Calculating...

Error bar:
  ████████████▓▓▓▓▓▓░░░░░░░░░░  FAILED at 72%
```

---

## 5. Status Icons (Unicode + Spinner)

| State | Icon | Fallback | Animation |
|---|---|---|---|
| IDLE | `○` (U+25CB) | `-` | None |
| STARTING| `⏳` (U+23F3) | `*` | None (static) |
| THINKING| `◷` (U+25F7) — part of spinner | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | Rotate @ 80ms |
| TOOL_CALL | `⚡` (U+26A1) | `>` | Pulse flash |
| DONE | `✓` (U+2713) | `+` | None (or brief flash) |
| ERROR | `✗` (U+2717) | `!` | None (persistent) |

**Spinner frames** (extended set, smoother):
```
⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏   ← braille dots (10 frames @ 80ms = 800ms cycle)
◷ ◶ ◵ ◴                     ← quadrant circle (4 frames, coarser)
```

Prefer braille for THINKING (smoother), quadrant for TOOL_CALL (chunkier, feels more "active").

---

## 6. React / Ink Implementation Notes

### 6.1 Component Tree

```
<AgentDashboard agents={AgentState[]}>
  <DashboardHeader />          // "MAMMOTH AGENTS" title + summary
  <Box flexDirection="column">
    {agents.map(agent =>
      <AgentCard key={agent.id}>
        <AgentHeader />        // Icon + name + state label + elapsed
        <AgentStatusLine />    // "Thinking..." / tool name / result
        <ProgressBar />        // Conditional: only when progress > -1
        <AgentFooter />        // Optional: metrics row
      </AgentCard>
    )}
  </Box>
  <DashboardFooter />          // "● 2 active | ✓ 1 done | ✗ 1 failed"
</AgentDashboard>
```

### 6.2 Core Types

```ts
type AgentState = 'idle' | 'starting' | 'thinking' | 'tool_call' | 'done' | 'error';

interface AgentStatusProps {
  id: string;
  name: string;
  state: AgentState;
  message: string;               // e.g. "Evaluating user intent..."
  progress?: number;             // 0–100, or -1 for indeterminate
  progressLabel?: string;        // e.g. "3 / 5 steps"
  elapsedMs?: number;            // time since state entered
  toolName?: string;             // active tool (TOOL_CALL state)
  toolCalls?: number;            // total tool calls this session
  errorMessage?: string;         // error detail (ERROR state)
  workflowCount?: number;
  memoryFacts?: number;
  tokenUsage?: { used: number; total: number };
  recentActions?: { icon: string; label: string; ago: string }[];
}

interface AgentDashboardProps {
  agents: AgentStatusProps[];
  compact?: boolean;             // true = single-line per agent
  maxVisible?: number;           // cap visible agents, scroll/fold rest
}
```

### 6.3 ProgressBar Component

```tsx
// ProgressBar.tsx
const BAR_WIDTH = 30;

const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

const ProgressBar: React.FC<{ percent: number; color?: string; label?: string }> = ({
  percent, color = '#3B82F6', label
}) => {
  const clamped = Math.max(0, Math.min(100, percent));
  const totalUnits = BAR_WIDTH * 8;  // 8 sub-units per char
  const filled = Math.floor((clamped / 100) * totalUnits);
  const fullChars = Math.floor(filled / 8);
  const partialIdx = filled % 8;

  const bar = '█'.repeat(fullChars) +
    (fullChars < BAR_WIDTH ? BLOCKS[partialIdx] : '') +
    '░'.repeat(Math.max(0, BAR_WIDTH - fullChars - 1));

  return (
    <Box>
      <Text color={color}>{bar}</Text>
      <Text> {String(clamped).padStart(3)}%</Text>
      {label && <Text dimColor>  ({label})</Text>}
    </Box>
  );
};
```

*Note*: Some terminals don't render the partial block characters (`▏▎▍▌▋▊▉`). For maximum compatibility, use only `█` and `░` (full and empty), which gives a resolution of `BAR_WIDTH` steps.

```tsx
// Compatible version:
const bar = '█'.repeat(Math.floor((clamped / 100) * BAR_WIDTH)) +
            '░'.repeat(Math.ceil(((100 - clamped) / 100) * BAR_WIDTH));
```

### 6.4 Spinner with State Awareness

```tsx
const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const StatusIcon: React.FC<{ state: AgentState }> = ({ state }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (state !== 'thinking' && state !== 'tool_call') return;
    const timer = setInterval(() => setFrame(f => (f + 1) % BRAILLE_SPINNER.length), 80);
    return () => clearInterval(timer);
  }, [state]);

  const color = STATE_COLORS[state];
  // Static icons for non-animating states
  if (state === 'idle')    return <Text color={color}>○</Text>;
  if (state === 'starting')return <Text color={color}>⏳</Text>;
  if (state === 'done')    return <Text color={color}>✓</Text>;
  if (state === 'error')   return <Text color={color}>✗</Text>;

  // Animated spinner for thinking / tool_call
  return <Text color={color}>{BRAILLE_SPINNER[frame]}</Text>;
};

const STATE_COLORS: Record<AgentState, string> = {
  idle:      '#6B7280',
  starting:  '#F59E0B',
  thinking:  '#06B6D4',
  tool_call: '#A855F7',
  done:      '#22C55E',
  error:     '#DC2626',
};
```

### 6.5 Elapsed Timer Hook

```tsx
const useElapsed = (since: number | undefined, running: boolean): number => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || since == null) return;
    setElapsed(Date.now() - since);
    const timer = setInterval(() => setElapsed(Date.now() - since), 200);
    return () => clearInterval(timer);
  }, [since, running]);
  return elapsed;
};

// Format: "1.2s", "2m 3s", "1h 2m"
const formatElapsed = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
};
```

### 6.6 AgentCard Component (Full)

```tsx
const AgentCard: React.FC<AgentStatusProps & { compact?: boolean }> = (props) => {
  const {
    name, state, message, progress, progressLabel,
    elapsedMs, toolName, errorMessage, compact
  } = props;

  const showProgress = state === 'tool_call' && progress != null;
  const showError = state === 'error' && errorMessage;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Row 1: icon + name + state label + timer */}
      <Box>
        <StatusIcon state={state} />
        <Text bold> {name}</Text>
        <Text color={STATE_COLORS[state]}> {state.toUpperCase()}</Text>
        <Text dimColor>  "{message}"</Text>
        {elapsedMs != null && state !== 'idle' && state !== 'done' && state !== 'error' && (
          <Text dimColor>  {formatElapsed(elapsedMs)}</Text>
        )}
        {toolName && <Text color="#A855F7">  ↳ {toolName}</Text>}
      </Box>

      {/* Row 2: progress bar */}
      {showProgress && (
        <Box marginLeft={4}>
          <ProgressBar percent={progress} label={progressLabel} />
        </Box>
      )}

      {/* Row 3: error detail */}
      {showError && (
        <Box marginLeft={4}>
          <Text color="#DC2626">{errorMessage}</Text>
        </Box>
      )}

      {/* Compact mode stops here */}
      {!compact && (
        <Box marginLeft={4} flexDirection="column">
          {props.recentActions?.map((a, i) => (
            <Text key={i} dimColor>  {a.icon} {a.label}  {a.ago}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
};
```

### 6.7 DashboardFooter (Summary Bar)

```tsx
const DashboardFooter: React.FC<{ agents: AgentStatusProps[] }> = ({ agents }) => {
  const counts = {
    active: agents.filter(a => ['starting', 'thinking', 'tool_call'].includes(a.state)).length,
    done: agents.filter(a => a.state === 'done').length,
    error: agents.filter(a => a.state === 'error').length,
    totalWorkflows: agents.reduce((sum, a) => sum + (a.workflowCount ?? 0), 0),
    totalFacts: agents.reduce((sum, a) => sum + (a.memoryFacts ?? 0), 0),
  };

  return (
    <Box paddingX={1} borderStyle="single" borderColor="#4B5563">
      <Text>● {counts.active} active</Text>
      <Text dimColor>  │  </Text>
      <Text color="#22C55E">✓ {counts.done} done</Text>
      <Text dimColor>  │  </Text>
      <Text color="#DC2626">✗ {counts.error} failed</Text>
      {counts.totalWorkflows > 0 && (
        <>
          <Text dimColor>  │  </Text>
          <Text>📋 {counts.totalWorkflows} workflows</Text>
        </>
      )}
      {counts.totalFacts > 0 && (
        <>
          <Text dimColor>  │  </Text>
          <Text>🧠 {counts.totalFacts} facts</Text>
        </>
      )}
    </Box>
  );
};
```

### 6.8 Handling Terminal Width

Ink doesn't expose `process.stdout.columns` directly in render, but you can:

```tsx
const useTermWidth = (): number => {
  const [width, setWidth] = useState(80);
  useEffect(() => {
    setWidth(process.stdout.columns ?? 80);
    const onResize = () => setWidth(process.stdout.columns ?? 80);
    process.stdout.on('resize', onResize);
    return () => process.stdout.off('resize', onResize);
  }, []);
  return width;
};
```

- **Width ≥ 100**: Show full dashboard with all columns.
- **Width 60–99**: Compact mode — each agent on one line, truncate messages.
- **Width < 60**: Ultra-compact — only status icon + name + timer.

---

## 7. Accessibility & Compatibility

| Concern | Mitigation |
|---|---|
| No-color terminals | Provide `--no-color` mode; use prefixes `[OK]`, `[ERR]`, `[..]` |
| CJK / narrow terminals | All icons are single-width Unicode; test in Windows Terminal |
| Screen readers | State text always present alongside icon (e.g. `◷ THINKING`) |
| CI / piped output | Detect `!process.stdout.isTTY` and emit plain-text format |
| Animation lag | Use `setTimeout` (not `requestAnimationFrame`); cap at 12.5 FPS (80ms) |

---

## 8. Migration Path from AgentStatus → AgentDashboard

1. **Keep `AgentStatus` as a compatibility wrapper**: Internally delegate to `AgentDashboard` with a single agent in ultra-compact mode.
2. **Progressive enhancement**: Start with the multi-agent `AgentDashboard` but default to showing only one agent (the primary).
3. **Feature flag**: Use a `MAMMOTH_MULTI_AGENT_UI=1` env var to toggle between old and new UI.

```tsx
// Backwards-compat shim
export const AgentStatus: React.FC<OldProps> = (props) => {
  const agent: AgentStatusProps = {
    id: 'main',
    name: 'mammoth',
    state: props.isThinking ? 'thinking' : 'idle',
    message: props.isThinking ? 'Thinking...' : '',
    toolName: props.activeTools[0],
    workflowCount: props.workflowCount,
    memoryFacts: props.memoryFacts,
  };
  return <AgentDashboard agents={[agent]} compact={true} />;
};
```

---

## 9. Open Questions / Future Iterations

- **Persistent log panel**: A scrollable terminal "pane" showing the last N state transitions (like `tmux` status line history).
- **Agent dependency graph**: Visualize which agent is waiting for which other agent's output.
- **Streaming token indicator**: Animate a live token counter during THINKING state.
- **Keyboard shortcuts overlay**: Show `[Ctrl+C] cancel  [D] details  [L] log` in footer.
- **Theme support**: Allow overriding color scheme via a `theme` prop or `.mammothrc`.

---

## 10. Summary

| Design Element | Recommendation |
|---|---|
| Layout | Vertical stacked "cards" with borders, 1 per agent |
| Primary states | 6 states: idle, starting, thinking, tool_call, done, error |
| Progress | `████░░░░` bar with percentage, shown during `tool_call` |
| Icons | Unicode + braille spinner; always paired with text label |
| Colors | Distinct ANSI-safe hex per state, dim for secondary info |
| Width adaptation | 3 tiers: full (≥100), compact (60-99), ultra (<60) |
| Backwards compat | Shim old `AgentStatus` props to new `AgentDashboard` |
