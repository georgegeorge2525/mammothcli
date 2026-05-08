# Tool Execution Pipeline Architecture

## 1. Overview

The **Tool Execution Pipeline** sits between `AgentRunner` and `ToolRegistry`, transforming the current direct call:

```
AgentRunner.run() → ToolRegistry.execute(tc) → ToolDef.execute(args)
```

into a composable, resilient pipeline:

```
AgentRunner.run() → ToolPipeline.execute(tc)
                      │
                      ├─ 1. Pre-Hooks (modify/augment the call)
                      ├─ 2. Cache Check (return cached result if hit)
                      ├─ 3. Middleware Chain (intercept, transform, retry, timeout)
                      ├─ 4. ToolRegistry.execute(tc)  ← actual execution
                      ├─ 5. Post-Hooks (modify/log/transform the result)
                      ├─ 6. Cache Write (store result for future calls)
                      │
                      → result string returned to AgentRunner
```

### Why a pipeline?

Currently `AgentRunner` calls `ToolRegistry.execute()` directly with zero cross-cutting concerns. Every tool invocation is a bare metal call — no retry on transient failure, no timeout enforcement, no caching, no observability. The pipeline layers these concerns *without* modifying either `AgentRunner` or `ToolRegistry`.

---

## 2. Core Types

### 2.1 `ToolCallContext`

Carries the full context of a single tool invocation through the pipeline. Middleware and hooks can read and mutate it.

```typescript
interface ToolCallContext {
  // Immutable identity
  readonly callId: string;          // UUID v4 generated at pipeline entry
  readonly toolCall: DSMLToolCall;  // { id, name, arguments }

  // Mutable metadata (hooks/middleware can set these)
  startTime: number;                // Date.now() at pipeline entry
  timeoutMs: number;                // Per-call timeout (default: 30_000)
  maxRetries: number;               // Max retry attempts (default: 2)
  retryCount: number;               // Current retry attempt (0-based)
  cacheKey: string | null;          // Set by cache middleware
  tags: Map<string, string>;        // Arbitrary key-value tags for logging/tracing

  // Result placeholders
  result?: string;                  // Final result string
  error?: Error;                    // Error if execution failed
  fromCache: boolean;               // True if result came from cache
  durationMs: number;               // Wall-clock duration of execution
}
```

### 2.2 Middleware

A middleware is a function that receives the context and a `next` function. It can:

- Inspect or mutate `ctx` before calling `next`.
- Call `next` zero times (short-circuit, e.g., cache hit).
- Call `next` multiple times (retry).
- Wrap `next` with a timeout.
- Inspect or mutate `ctx.result` after `next` returns.

```typescript
type NextFunction = (ctx: ToolCallContext) => Promise<void>;

interface ToolMiddleware {
  name: string;
  apply(ctx: ToolCallContext, next: NextFunction): Promise<void>;
}
```

### 2.3 Hooks

Simpler than middleware — just before/after callbacks. Hooks run in registration order.

```typescript
type PreHook  = (ctx: ToolCallContext) => Promise<void> | void;
type PostHook = (ctx: ToolCallContext) => Promise<void> | void;
```

---

## 3. `ToolPipeline` Class

`ToolPipeline` is the single entry point that `AgentRunner` calls instead of `ToolRegistry.execute()`.

```typescript
export class ToolPipeline {
  private registry: ToolRegistry;
  private middlewares: ToolMiddleware[] = [];
  private preHooks: PreHook[] = [];
  private postHooks: PostHook[] = [];
  private cache?: ToolResultCache;
  private defaultTimeoutMs: number = 30_000;
  private defaultMaxRetries: number = 2;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  // ── Builder API ──

  use(middleware: ToolMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  onPre(hook: PreHook): this {
    this.preHooks.push(hook);
    return this;
  }

  onPost(hook: PostHook): this {
    this.postHooks.push(hook);
    return this;
  }

  withCache(cache: ToolResultCache): this {
    this.cache = cache;
    return this;
  }

  withDefaultTimeout(ms: number): this {
    this.defaultTimeoutMs = ms;
    return this;
  }

  // ── Main Execution ──

  async execute(toolCall: DSMLToolCall): Promise<string> {
    const ctx = this.buildContext(toolCall);

    // 1. Run pre-hooks
    for (const hook of this.preHooks) {
      await hook(ctx);
    }

    // 2. Cache read (if cache is configured)
    if (this.cache && ctx.cacheKey) {
      const cached = await this.cache.get(ctx.cacheKey);
      if (cached !== undefined) {
        ctx.result = cached;
        ctx.fromCache = true;
        ctx.durationMs = Date.now() - ctx.startTime;
        // Still run post-hooks on cache hit
        for (const hook of this.postHooks) {
          await hook(ctx);
        }
        return ctx.result;
      }
    }

    // 3. Execute through middleware chain
    try {
      await this.invokeChain(ctx, 0);
    } catch (err) {
      ctx.error = err instanceof Error ? err : new Error(String(err));
    }

    ctx.durationMs = Date.now() - ctx.startTime;

    // 4. Cache write (if result is not an error)
    if (this.cache && ctx.cacheKey && ctx.result && !ctx.error) {
      await this.cache.set(ctx.cacheKey, ctx.result);
    }

    // 5. Run post-hooks
    for (const hook of this.postHooks) {
      await hook(ctx);
    }

    // 6. Return result or throw
    if (ctx.error) {
      return `Error: ${ctx.error.message}`;
    }
    return ctx.result ?? '';
  }

  // ── Private Helpers ──

  private buildContext(toolCall: DSMLToolCall): ToolCallContext {
    return {
      callId: crypto.randomUUID(),
      toolCall,
      startTime: Date.now(),
      timeoutMs: this.defaultTimeoutMs,
      maxRetries: this.defaultMaxRetries,
      retryCount: 0,
      cacheKey: null,
      tags: new Map(),
      fromCache: false,
      durationMs: 0,
    };
  }

  private async invokeChain(ctx: ToolCallContext, index: number): Promise<void> {
    if (index >= this.middlewares.length) {
      // End of chain: execute the actual tool
      ctx.result = await this.registry.execute(ctx.toolCall);
      return;
    }
    const middleware = this.middlewares[index];
    await middleware.apply(ctx, (nextCtx) => this.invokeChain(nextCtx ?? ctx, index + 1));
  }
}
```

---

## 4. Built-in Middleware Implementations

### 4.1 Timeout Middleware

Wraps the `next()` call with `Promise.race` against a timeout. If the timeout wins, the tool call is aborted and the context error is set.

```typescript
export class TimeoutMiddleware implements ToolMiddleware {
  readonly name = 'timeout';

  async apply(ctx: ToolCallContext, next: NextFunction): Promise<void> {
    const deadline = ctx.timeoutMs;

    await Promise.race([
      next(ctx),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(
          `Tool '${ctx.toolCall.name}' timed out after ${deadline}ms`
        )), deadline)
      ),
    ]);
  }
}
```

> **Note:** True abort of in-flight work requires an `AbortController` passed through context. For now, `Promise.race` ensures the AgentRunner doesn't hang — the underlying `ToolDef.execute` promise is left dangling but the pipeline moves on.

### 4.2 Retry with Exponential Backoff

Retries the tool on failure, with configurable backoff strategy.

```typescript
export interface RetryConfig {
  maxRetries: number;        // default: 2 (3 total attempts)
  baseDelayMs: number;       // default: 500
  maxDelayMs: number;        // default: 10_000
  backoffMultiplier: number; // default: 2
  jitter: boolean;           // default: true
  retryableErrors: RegExp[]; // default: [/timeout/i, /ECONNREFUSED/i, /429/i, /5\d\d/i]
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: [/timeout/i, /ECONNREFUSED/i, /429/i, /5\d\d/i, /EACCES/i],
};

export class RetryMiddleware implements ToolMiddleware {
  readonly name = 'retry';
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  async apply(ctx: ToolCallContext, next: NextFunction): Promise<void> {
    const max = ctx.maxRetries;

    for (let attempt = 0; attempt <= max; attempt++) {
      ctx.retryCount = attempt;

      try {
        await next(ctx);
        return; // success
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isRetryable = this.config.retryableErrors.some((re) => re.test(message));

        if (attempt === max || !isRetryable) {
          throw err; // final attempt or non-retryable error
        }

        // Calculate delay with exponential backoff and optional jitter
        const delay = Math.min(
          this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt),
          this.config.maxDelayMs,
        );
        const jittered = this.config.jitter ? delay * (0.5 + Math.random()) : delay;

        ctx.tags.set('retryDelay', String(Math.round(jittered)));
        ctx.tags.set('retryAttempt', String(attempt + 1));

        await new Promise((r) => setTimeout(r, jittered));
      }
    }
  }
}
```

#### Backoff Visualization

| Attempt | Base Delay | Multiplier | Raw Delay | With Jitter (50-150%) |
|---------|------------|------------|-----------|----------------------|
| 0       | 500ms      | ×1         | 500ms     | 250-750ms            |
| 1       | 500ms      | ×2         | 1000ms    | 500-1500ms           |
| 2       | 500ms      | ×4         | 2000ms    | 1000-3000ms          |
| 3+      | —          | capped      | 10000ms   | 5000-15000ms         |

### 4.3 Cache Middleware

Generates a deterministic cache key from the tool call and checks cache before executing.

```typescript
export interface ToolResultCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryToolCache implements ToolResultCache {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private defaultTtlMs = 60_000; // 1 minute

  async get(key: string): Promise<string | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export class CacheMiddleware implements ToolMiddleware {
  readonly name = 'cache';
  private cache: ToolResultCache;
  private ttlMs: number;
  private readTools: Set<string>; // Only cache reads, never writes

  constructor(
    cache: ToolResultCache,
    options: { ttlMs?: number; cacheableTools?: string[] } = {},
  ) {
    this.cache = cache;
    this.ttlMs = options.ttlMs ?? 60_000;
    this.readTools = new Set(options.cacheableTools ?? ['Read', 'Glob', 'Grep']);
  }

  async apply(ctx: ToolCallContext, next: NextFunction): Promise<void> {
    if (!this.readTools.has(ctx.toolCall.name)) {
      // Pass through — don't cache mutating tools like Write, Bash, Edit
      await next(ctx);
      return;
    }

    // Deterministic cache key: toolName + stable JSON of arguments
    ctx.cacheKey = this.computeKey(ctx.toolCall);

    const cached = await this.cache.get(ctx.cacheKey);
    if (cached !== undefined) {
      ctx.result = cached;
      ctx.fromCache = true;
      return; // short-circuit: don't call next()
    }

    await next(ctx);

    // Cache successful results
    if (ctx.result && !ctx.error) {
      await this.cache.set(ctx.cacheKey, ctx.result, this.ttlMs);
    }
  }

  private computeKey(call: DSMLToolCall): string {
    // Sort keys for deterministic hashing
    const sorted = JSON.stringify(call.arguments, Object.keys(call.arguments).sort());
    return `${call.name}:${sorted}`;
  }
}
```

### 4.4 Logging/Observability Middleware

```typescript
export class LoggingMiddleware implements ToolMiddleware {
  readonly name = 'logging';
  private logger: (msg: string) => void;

  constructor(logger: (msg: string) => void = console.log) {
    this.logger = logger;
  }

  async apply(ctx: ToolCallContext, next: NextFunction): Promise<void> {
    const start = Date.now();
    this.logger(`[pipeline] ▶ ${ctx.toolCall.name} (${JSON.stringify(ctx.toolCall.arguments)})`);

    try {
      await next(ctx);
      const ms = Date.now() - start;
      const source = ctx.fromCache ? ' (cached)' : '';
      this.logger(`[pipeline] ✓ ${ctx.toolCall.name} → ${ms}ms${source}`);
    } catch (err) {
      const ms = Date.now() - start;
      this.logger(`[pipeline] ✗ ${ctx.toolCall.name} → ${ms}ms error: ${err}`);
      throw err;
    }
  }
}
```

---

## 5. Pipeline Assembly (Factory)

The factory function wires everything together in the recommended order:

```typescript
export function createToolPipeline(
  registry: ToolRegistry,
  options?: {
    timeoutMs?: number;
    maxRetries?: number;
    cache?: ToolResultCache;
    logger?: (msg: string) => void;
  },
): ToolPipeline {
  const pipeline = new ToolPipeline(registry);

  if (options?.timeoutMs !== undefined) {
    pipeline.withDefaultTimeout(options.timeoutMs);
  }

  // ═══ Pre-hooks ═══
  pipeline.onPre(async (ctx) => {
    // Inject agent/truncation context from thread-local storage if needed
    ctx.tags.set('pipelineVersion', '1.0');
  });

  // ═══ Middleware (order matters!) ═══

  // 1. Logging FIRST — so we see the raw call before any transformation
  pipeline.use(new LoggingMiddleware(options?.logger));

  // 2. Cache — short-circuits for cache hits, preventing unnecessary work
  if (options?.cache) {
    pipeline.use(new CacheMiddleware(options.cache));
  }

  // 3. Timeout — wraps retry so each retry attempt gets its own timeout
  pipeline.use(new TimeoutMiddleware());

  // 4. Retry — innermost, closest to actual execution
  pipeline.use(new RetryMiddleware({ maxRetries: options?.maxRetries ?? 2 }));

  // ═══ Post-hooks ═══
  pipeline.onPost(async (ctx) => {
    // Trim excessively long results to prevent context pollution
    if (ctx.result && ctx.result.length > 100_000) {
      ctx.result = ctx.result.slice(0, 100_000) +
        `\n\n... [truncated ${ctx.result.length - 100_000} chars]`;
    }
  });

  pipeline.onPost(async (ctx) => {
    // Collect metrics: duration, retry count, cache hits
    // Could push to an in-memory ring buffer for the TUI diagnostics panel
  });

  return pipeline;
}
```

---

## 6. Integration with AgentRunner

### Before (Current)

```typescript
// AgentRunner.ts, line 89
const result = await this.tools.execute(tc);
```

### After (With Pipeline)

```typescript
// AgentRunner.ts — constructor changes
export class AgentRunner {
  private tools: ToolRegistry;
  private pipeline: ToolPipeline;   // ← NEW
  private apiKey: string;

  constructor(tools: ToolRegistry, apiKey: string) {
    this.tools = tools;
    this.apiKey = apiKey;
    this.pipeline = createToolPipeline(tools, {
      timeoutMs: 45_000,
      maxRetries: 2,
      cache: new InMemoryToolCache(),
      logger: (msg) => { /* optional */ },
    });
  }
}

// AgentRunner.ts, line 89 becomes:
const result = await this.pipeline.execute(tc);
```

The `AgentRunner` needs no other changes. The pipeline is a drop-in replacement for `ToolRegistry.execute()`, returning the same `Promise<string>`.

---

## 7. Full Execution Flow Diagram

```
AgentRunner.run()
    │
    │  for each turn:
    │    stream API response
    │    detect tool_calls[]
    │
    ▼
ToolPipeline.execute(tc)
    │
    ├─► buildContext(tc)          // Create fresh ToolCallContext
    │
    ├─► preHooks[0](ctx)          // Pre-processing hooks
    ├─► preHooks[1](ctx)
    │     ...
    │
    ├─► [cache?] cache.get(key)
    │     │
    │     ├─ HIT ──────────────────────► set ctx.result, ctx.fromCache=true
    │     │                                   │
    │     │                                   ├─► postHooks
    │     │                                   └─► return result
    │     │
    │     └─ MISS ─────────────────────► continue to middleware chain
    │
    ├─► middleware[0].apply(ctx, next) ──► LoggingMiddleware
    │     │                                     │
    │     │  "▶ Read /foo/bar.ts"              │
    │     │                                     ▼
    │     ├─► middleware[1].apply(ctx, next) ──► CacheMiddleware
    │     │     │                                   │
    │     │     │  computeKey() → "Read:{\"file_path\":...}"
    │     │     │  cache.get() → MISS                │
    │     │     │                                   ▼
    │     │     ├─► middleware[2].apply(ctx, next) ──► TimeoutMiddleware
    │     │     │     │                                 │
    │     │     │     │  Promise.race([next, timeout]) │
    │     │     │     │                                 ▼
    │     │     │     ├─► middleware[3].apply(ctx, next) ──► RetryMiddleware
    │     │     │     │     │
    │     │     │     │     │  for attempt 0..maxRetries:
    │     │     │     │     │    try next()
    │     │     │     │     │    catch → backoff → retry
    │     │     │     │     │
    │     │     │     │     │    │
    │     │     │     │     │    ▼
    │     │     │     │     └──► ToolRegistry.execute(tc)  ← ACTUAL EXECUTION
    │     │     │     │              │
    │     │     │     │              │  tool.execute(args)
    │     │     │     │              │
    │     │     │     │              ▼
    │     │     │     │         ctx.result = "file contents..."
    │     │     │     │
    │     │     │     │    ◄── return
    │     │     │     │
    │     │     │     ◄── return
    │     │     │
    │     │     ◄── return (cache writes ctx.result)
    │     │
    │     ◄── "✓ Read → 12ms"
    │
    ├─► [cache?] cache.set(key, ctx.result)
    │
    ├─► postHooks[0](ctx)         // Truncate long results
    ├─► postHooks[1](ctx)         // Collect metrics
    │     ...
    │
    └─► return ctx.result

AgentRunner continues with result string
```

---

## 8. Design Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| **Middleware order: Logging → Cache → Timeout → Retry** | Logging first captures the raw call. Cache second short-circuits early. Timeout wraps retry so each individual attempt gets the timeout. Retry is innermost since it actually invokes the tool. |
| **Cache-only reads (Read, Glob, Grep)** | Caching `Write` or `Bash` would produce stale side-effects. Only pure-read tools are safe to cache. |
| **Cache key = `toolName + sorted JSON(args)`** | Deterministic; sorting keys ensures `{a:1,b:2}` and `{b:2,a:1}` produce the same key. Not suitable for tools with non-deterministic arguments (e.g., timestamps), but ok for Mammoth tools. |
| **`Promise.race` for timeout (not `AbortController`)** | AbortController requires the underlying `ToolDef.execute` to accept a signal. Since existing tools don't, `Promise.race` is a non-invasive first step. Future: add `AbortSignal` to `ToolDef.execute` signature. |
| **Jittered exponential backoff** | Prevents thundering-herd retry storms when multiple agents retry simultaneously. Jitter range: 50%-150% of calculated delay. |
| **Pipeline is a drop-in replacement** | Returns `Promise<string>` — same signature as `ToolRegistry.execute()`. AgentRunner needs only constructor change. |
| **Post-hook truncation at 100KB** | Prevents a single huge tool result from consuming the entire context window in subsequent turns. |

---

## 9. Extension Points

Future enhancements that fit naturally into this architecture:

1. **Rate Limiting Middleware** — throttle tool calls per-second across all agents.
2. **Circuit Breaker Middleware** — if a tool fails repeatedly, temporarily disable it.
3. **Result Streaming** — for tools that produce streaming output, add a `stream` variant that yields chunks.
4. **AbortController Propagation** — thread an `AbortSignal` through `ToolCallContext` so timeout can truly cancel in-flight I/O.
5. **Persistent Cache** — swap `InMemoryToolCache` for a SQLite-backed cache that survives restarts.
6. **Tool Call Auditing** — append every `ToolCallContext` to a ring buffer for real-time TUI diagnostics.
7. **Conditional Middleware** — per-agent middleware config (e.g., explorer agent gets caching, executor agent does not).

---

## 10. File Structure

```
MammothMINICLI/
  AgentRunner.ts              ← Calls pipeline.execute(tc) instead of registry.execute(tc)
  ToolRegistry.ts             ← Unchanged
  ToolPipeline.ts             ← NEW: ToolPipeline class, factory, core types
  middleware/
    LoggingMiddleware.ts      ← NEW
    CacheMiddleware.ts        ← NEW
    TimeoutMiddleware.ts      ← NEW
    RetryMiddleware.ts        ← NEW
  cache/
    ToolResultCache.ts        ← NEW: interface + InMemoryToolCache
  architecture_tool_pipeline.md ← THIS FILE
```

---

## 11. Summary

The Tool Execution Pipeline introduces **zero breaking changes** to `AgentRunner` or `ToolRegistry`. It layers cross-cutting concerns — observability, caching, timeout enforcement, retry with backoff — into a single composable chain. The architecture is inspired by server-side middleware patterns (Express, Koa, ASP.NET Core) and is designed to be incrementally adoptable: start with just the pipeline, add middleware one at a time, and extend with new middleware as needs arise.
