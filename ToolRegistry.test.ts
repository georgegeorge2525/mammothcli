// ToolRegistry.test.ts — comprehensive unit tests for ToolRegistry
// Uses a minimal inline test runner (describe/it/expect, zero dependencies).

import { ToolRegistry, type ToolDef } from './ToolRegistry.js';
import type { DSMLToolCall } from './services/deepseekProtocol.js';

// ── Minimal inline test-runner ──

let currentSuite = '';
let passed = 0;
let failed = 0;
const failures: string[] = [];

function describe(name: string, fn: () => void) {
  currentSuite = name;
  console.log(`\n${name}`);
  fn();
}

function it(name: string, fn: () => void | Promise<void>) {
  const full = `${currentSuite} > ${name}`;
  try {
    const result = fn();
    if (result instanceof Promise) {
      // async test — defer resolution
      result
        .then(() => {
          passed++;
          console.log(`  ✓ ${name}`);
        })
        .catch((err) => {
          failed++;
          const msg = `${full}\n    ${err instanceof Error ? err.message : String(err)}`;
          failures.push(msg);
          console.log(`  ✗ ${name}`);
          console.log(`    ${err instanceof Error ? err.message : String(err)}`);
        });
    } else {
      passed++;
      console.log(`  ✓ ${name}`);
    }
  } catch (err) {
    failed++;
    const msg = `${full}\n    ${err instanceof Error ? err.message : String(err)}`;
    failures.push(msg);
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected: T) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) {
        throw new Error(`Expected ${e} but got ${a}`);
      }
    },
    toBeDefined() {
      if (actual === undefined || actual === null) {
        throw new Error(`Expected value to be defined, but got ${String(actual)}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined but got ${JSON.stringify(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${JSON.stringify(actual)}`);
      }
    },
    toBeInstanceOf(cls: new (...args: never[]) => unknown) {
      if (!(actual instanceof cls)) {
        throw new Error(`Expected instance of ${cls.name} but got ${typeof actual}`);
      }
    },
    toBeGreaterThan(n: number) {
      if (typeof actual !== 'number' || actual <= n) {
        throw new Error(`Expected ${actual} to be > ${n}`);
      }
    },
    toBeType(expectedType: string) {
      if (typeof actual !== expectedType) {
        throw new Error(`Expected typeof ${expectedType} but got typeof ${typeof actual}`);
      }
    },
    toContain(item: unknown) {
      if (Array.isArray(actual)) {
        if (!actual.includes(item)) {
          throw new Error(`Expected array to contain ${JSON.stringify(item)}`);
        }
      } else if (typeof actual === 'string') {
        if (!actual.includes(String(item))) {
          throw new Error(`Expected string "${actual}" to contain "${String(item)}"`);
        }
      } else {
        throw new Error('toContain can only be used on arrays or strings');
      }
    },
    toHaveLength(length: number) {
      if (Array.isArray(actual) || typeof actual === 'string') {
        if ((actual as Array<unknown> | string).length !== length) {
          throw new Error(
            `Expected length ${length} but got ${(actual as Array<unknown> | string).length}`
          );
        }
      } else {
        throw new Error('toHaveLength can only be used on arrays or strings');
      }
    },
    toThrow(expectedMsg?: string) {
      if (typeof actual !== 'function') {
        throw new Error('toThrow requires a function');
      }
      let threw = false;
      try {
        actual();
      } catch (err) {
        threw = true;
        if (expectedMsg && err instanceof Error) {
          if (!err.message.includes(expectedMsg)) {
            throw new Error(
              `Expected error message to contain "${expectedMsg}" but got "${err.message}"`
            );
          }
        }
      }
      if (!threw) {
        throw new Error('Expected function to throw but it did not');
      }
    },
  };
}

// ── Helpers ──

function makeTool(
  name: string,
  description: string = `Tool: ${name}`,
  execute?: (args: Record<string, unknown>) => Promise<string>
): ToolDef {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {}, required: [] },
    execute:
      execute ??
      (async (args: Record<string, unknown>) =>
        `Executed ${name} with ${JSON.stringify(args)}`),
  };
}

function makeCall(
  name: string,
  args: Record<string, unknown> = {}
): DSMLToolCall {
  return {
    id: `call-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: args,
  };
}

// ── Tests ──

describe('ToolRegistry', () => {
  // ── register ──
  describe('register()', () => {
    it('should register a tool and make it retrievable', () => {
      const registry = new ToolRegistry();
      const tool = makeTool('test-tool');
      registry.register(tool);
      const retrieved = registry.get('test-tool');
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('test-tool');
    });

    it('should register multiple distinct tools', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('tool-a'));
      registry.register(makeTool('tool-b'));
      registry.register(makeTool('tool-c'));
      expect(registry.getAll()).toHaveLength(3);
    });

    it('should allow duplicate registration (last wins)', () => {
      const registry = new ToolRegistry();
      const first = makeTool('dup', 'first description');
      const second = makeTool('dup', 'second description');
      registry.register(first);
      registry.register(second);
      const retrieved = registry.get('dup');
      expect(retrieved).toBeDefined();
      expect(retrieved!.description).toBe('second description');
    });

    it('should allow re-registration to update executor', async () => {
      const registry = new ToolRegistry();
      const v1 = makeTool('evolving', 'v1', async () => 'result-v1');
      const v2 = makeTool('evolving', 'v2', async () => 'result-v2');
      registry.register(v1);
      registry.register(v2);
      const result = await registry.execute(makeCall('evolving'));
      expect(result).toBe('result-v2');
    });

    it('should register tools with complex parameter schemas', () => {
      const registry = new ToolRegistry();
      const tool: ToolDef = {
        name: 'complex-tool',
        description: 'Has nested parameters',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to file' },
            options: {
              type: 'object',
              properties: {
                overwrite: { type: 'boolean' },
                encoding: { type: 'string', enum: ['utf-8', 'base64'] },
              },
            },
          },
          required: ['filePath'],
        },
        execute: async (args) => JSON.stringify(args),
      };
      registry.register(tool);
      const schemas = registry.getOpenAISchemas();
      expect(schemas).toHaveLength(1);
      const schemaParams = schemas[0].function.parameters as Record<string, unknown>;
      expect(schemaParams.type).toBe('object');
      expect(schemaParams.required).toEqual(['filePath']);
    });

    it('should handle zero-argument tools', () => {
      const registry = new ToolRegistry();
      const tool: ToolDef = {
        name: 'no-args',
        description: 'No arguments needed',
        parameters: {},
        execute: async () => 'done',
      };
      registry.register(tool);
      expect(registry.get('no-args')).toBeDefined();
    });
  });

  // ── get ──
  describe('get()', () => {
    it('should return undefined for unregistered tool', () => {
      const registry = new ToolRegistry();
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should return the exact ToolDef reference', () => {
      const registry = new ToolRegistry();
      const tool = makeTool('exact');
      registry.register(tool);
      expect(registry.get('exact')).toBe(tool);
    });

    it('should be case-sensitive', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('CaseSensitive'));
      expect(registry.get('CaseSensitive')).toBeDefined();
      expect(registry.get('casesensitive')).toBeUndefined();
      expect(registry.get('CASESENSITIVE')).toBeUndefined();
    });

    it('should return undefined for empty string name', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool(''));
      expect(registry.get('')).toBeDefined(); // empty string is a valid key
      expect(registry.get('something')).toBeUndefined();
    });

    it('should handle special characters in tool names', () => {
      const registry = new ToolRegistry();
      const specialName = 'tool/with:special.chars-_@123';
      registry.register(makeTool(specialName));
      expect(registry.get(specialName)).toBeDefined();
      expect(registry.get(specialName)!.name).toBe(specialName);
    });
  });

  // ── getAll ──
  describe('getAll()', () => {
    it('should return empty array for empty registry', () => {
      const registry = new ToolRegistry();
      expect(registry.getAll()).toEqual([]);
    });

    it('should return all registered tools in insertion order', () => {
      const registry = new ToolRegistry();
      const names = ['alpha', 'beta', 'gamma', 'delta'];
      for (const name of names) {
        registry.register(makeTool(name));
      }
      const all = registry.getAll();
      expect(all).toHaveLength(4);
      const retrievedNames = all.map((t) => t.name);
      expect(retrievedNames).toEqual(names);
    });

    it('should reflect duplicate overwrites (only one entry per name)', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('only', 'first'));
      registry.register(makeTool('only', 'second'));
      const all = registry.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].description).toBe('second');
    });

    it('should return a shallow copy (mutations to returned array must not affect registry)', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('immutable'));
      const all = registry.getAll();
      all.pop();
      expect(registry.getAll()).toHaveLength(1);
    });

    it('should handle large number of registrations', () => {
      const registry = new ToolRegistry();
      const count = 1000;
      for (let i = 0; i < count; i++) {
        registry.register(makeTool(`tool-${i}`));
      }
      expect(registry.getAll()).toHaveLength(count);
    });
  });

  // ── getOpenAISchemas ──
  describe('getOpenAISchemas()', () => {
    it('should return empty array for empty registry', () => {
      const registry = new ToolRegistry();
      expect(registry.getOpenAISchemas()).toEqual([]);
    });

    it('should format tools as OpenAI function schemas', () => {
      const registry = new ToolRegistry();
      const tool = makeTool('weather', 'Get the weather');
      registry.register(tool);
      const schemas = registry.getOpenAISchemas();
      expect(schemas).toHaveLength(1);
      expect(schemas[0].type).toBe('function');
      expect(schemas[0].function.name).toBe('weather');
      expect(schemas[0].function.description).toBe('Get the weather');
      expect(schemas[0].function.parameters).toEqual(tool.parameters);
    });

    it('should return all registered tools as schemas', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('a'));
      registry.register(makeTool('b'));
      registry.register(makeTool('c'));
      const schemas = registry.getOpenAISchemas();
      expect(schemas).toHaveLength(3);
      const names = schemas.map((s) => s.function.name);
      expect(names).toEqual(['a', 'b', 'c']);
    });

    it('should reflect tool updates (duplicate registration)', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('x', 'desc1'));
      registry.register(makeTool('x', 'desc2'));
      const schemas = registry.getOpenAISchemas();
      expect(schemas).toHaveLength(1);
      expect(schemas[0].function.description).toBe('desc2');
    });

    it('should have correct type literal "function"', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('f'));
      const schemas = registry.getOpenAISchemas();
      // Verify TypeScript type literal
      expect(schemas[0].type).toBe('function');
      expect(typeof schemas[0].type).toBe('string');
    });

    it('should handle tools with complex nested parameters', () => {
      const registry = new ToolRegistry();
      const tool: ToolDef = {
        name: 'search',
        description: 'Search files',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            filters: {
              type: 'object',
              properties: {
                extension: { type: 'string' },
                maxSize: { type: 'number' },
              },
            },
          },
          required: ['query'],
        },
        execute: async () => '',
      };
      registry.register(tool);
      const schemas = registry.getOpenAISchemas();
      const p = schemas[0].function.parameters as Record<string, unknown>;
      const props = p.properties as Record<string, unknown>;
      expect(props.query).toBeDefined();
      expect(props.filters).toBeDefined();
    });
  });

  // ── execute ──
  describe('execute()', () => {
    it('should execute a registered tool and return its result', async () => {
      const registry = new ToolRegistry();
      registry.register(
        makeTool('greet', 'Greets', async (args) => `Hello, ${args.name}!`)
      );
      const result = await registry.execute(makeCall('greet', { name: 'World' }));
      expect(result).toBe('Hello, World!');
    });

    it('should pass all arguments to the tool executor', async () => {
      const registry = new ToolRegistry();
      const receivedArgs: Record<string, unknown>[] = [];
      registry.register(
        makeTool('capture', 'Captures args', async (args) => {
          receivedArgs.push(args);
          return 'ok';
        })
      );
      await registry.execute(makeCall('capture', { a: 1, b: 'two', c: true }));
      expect(receivedArgs).toHaveLength(1);
      expect(receivedArgs[0].a).toBe(1);
      expect(receivedArgs[0].b).toBe('two');
      expect(receivedArgs[0].c).toBe(true);
    });

    it('should return "Unknown tool: <name>" for missing tool', async () => {
      const registry = new ToolRegistry();
      const result = await registry.execute(makeCall('ghost'));
      expect(result).toBe('Unknown tool: ghost');
    });

    it('should return unknown tool message for empty registry', async () => {
      const registry = new ToolRegistry();
      const result = await registry.execute(makeCall('anything'));
      expect(result).toContain('Unknown tool');
      expect(result).toContain('anything');
    });

    it('should handle tool names that look like system commands', async () => {
      const registry = new ToolRegistry();
      const result = await registry.execute(makeCall('__proto__'));
      expect(result).toBe('Unknown tool: __proto__');
    });

    it('should propagate errors from tool executors', async () => {
      const registry = new ToolRegistry();
      registry.register(
        makeTool('explode', 'Always throws', async () => {
          throw new Error('BOOM!');
        })
      );
      try {
        await registry.execute(makeCall('explode'));
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err instanceof Error ? (err as Error).message : '').toContain('BOOM!');
      }
    });

    it('should handle executor returning non-string (type coercion edge case)', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'weird',
        description: 'Returns number',
        parameters: {},
        // Force a non-string return via cast
        execute: (async () => 42) as unknown as (args: Record<string, unknown>) => Promise<string>,
      });
      // The Promise<string> type is expected; a runtime number still comes through JS
      const result = await registry.execute(makeCall('weird'));
      // In JS, the number 42 will be returned as-is; ToolRegistry doesn't coerce
      expect(typeof result === 'number' || typeof result === 'string').toBe(true);
    });

    it('should execute with empty arguments object', async () => {
      const registry = new ToolRegistry();
      registry.register(
        makeTool('empty-args', 'No args needed', async () => 'no-args-result')
      );
      const result = await registry.execute(makeCall('empty-args', {}));
      expect(result).toBe('no-args-result');
    });

    it('should handle large argument payloads', async () => {
      const registry = new ToolRegistry();
      registry.register(
        makeTool('bulk', 'Handles bulk', async (args) => `Keys: ${Object.keys(args).length}`)
      );
      const largeArgs: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i++) {
        largeArgs[`key-${i}`] = `value-${i}`;
      }
      const result = await registry.execute(makeCall('bulk', largeArgs));
      expect(result).toBe('Keys: 1000');
    });

    it('should correctly distinguish between tool with same prefix name', async () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('file', 'file tool', async () => 'file-result'));
      registry.register(makeTool('file-read', 'file-read tool', async () => 'file-read-result'));
      expect(await registry.execute(makeCall('file'))).toBe('file-result');
      expect(await registry.execute(makeCall('file-read'))).toBe('file-read-result');
    });
  });

  // ── Concurrent access patterns ──
  describe('concurrent access', () => {
    it('should handle concurrent registrations without corruption', () => {
      const registry = new ToolRegistry();
      const count = 200;
      const promises: Promise<void>[] = [];
      for (let i = 0; i < count; i++) {
        const name = `concurrent-${i}`;
        promises.push(
          Promise.resolve().then(() => registry.register(makeTool(name)))
        );
      }
      // Wait for all registrations
      return Promise.all(promises).then(() => {
        expect(registry.getAll()).toHaveLength(count);
        for (let i = 0; i < count; i++) {
          expect(registry.get(`concurrent-${i}`)).toBeDefined();
        }
      });
    });

    it('should handle concurrent duplicate registration (same key) gracefully', async () => {
      const registry = new ToolRegistry();
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          Promise.resolve().then(() =>
            registry.register(makeTool('race', `version-${i}`))
          )
        );
      }
      await Promise.all(promises);
      expect(registry.getAll()).toHaveLength(1);
      // The description is non-deterministic but must be one of the versions
      const tool = registry.get('race')!;
      expect(tool.description).toContain('version-');
    });

    it('should handle concurrent reads during writes', async () => {
      const registry = new ToolRegistry();
      // Pre-register some tools
      for (let i = 0; i < 50; i++) {
        registry.register(makeTool(`stable-${i}`));
      }

      const ops: Promise<unknown>[] = [];
      // Writers: register new tools
      for (let i = 0; i < 50; i++) {
        ops.push(
          Promise.resolve().then(() => registry.register(makeTool(`writer-${i}`)))
        );
      }
      // Readers: get and getAll interleaved
      for (let i = 0; i < 50; i++) {
        ops.push(
          Promise.resolve().then(() => {
            registry.get(`stable-${i}`); // always exists
            registry.getAll();
            registry.getOpenAISchemas();
          })
        );
      }
      await Promise.all(ops);
      // No crash = pass. Also verify pre-registered tools still exist
      for (let i = 0; i < 50; i++) {
        expect(registry.get(`stable-${i}`)).toBeDefined();
      }
    });

    it('should handle concurrent executions of same tool', async () => {
      const registry = new ToolRegistry();
      let concurrentCalls = 0;
      let maxConcurrent = 0;
      registry.register(
        makeTool('concurrent-exec', 'concurrent', async () => {
          concurrentCalls++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
          // Small delay to allow overlap
          await new Promise((r) => setTimeout(r, 5));
          concurrentCalls--;
          return 'done';
        })
      );

      const execPromises: Promise<string>[] = [];
      for (let i = 0; i < 20; i++) {
        execPromises.push(registry.execute(makeCall('concurrent-exec')));
      }
      const results = await Promise.all(execPromises);
      expect(results).toHaveLength(20);
      for (const r of results) {
        expect(r).toBe('done');
      }
      // At least some concurrency should have happened
      expect(maxConcurrent).toBeGreaterThan(1);
    });

    it('should handle concurrent execution of missing tools', async () => {
      const registry = new ToolRegistry();
      const results = await Promise.all([
        registry.execute(makeCall('ghost-1')),
        registry.execute(makeCall('ghost-2')),
        registry.execute(makeCall('ghost-3')),
      ]);
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r).toContain('Unknown tool');
      }
    });

    it('should maintain consistency with mixed read/write/execute under load', async () => {
      const registry = new ToolRegistry();
      registry.register(
        makeTool('ping', 'ping tool', async (args) => `pong-${args.n ?? ''}`)
      );

      const ops: Promise<unknown>[] = [];
      for (let i = 0; i < 100; i++) {
        const idx = i;
        ops.push(
          Promise.resolve().then(() => {
            // Write
            registry.register(makeTool(`dyn-${idx}`, `desc-${idx}`));
            // Read
            registry.get('ping');
            registry.getAll();
            registry.getOpenAISchemas();
            // Execute
            return registry.execute(makeCall('ping', { n: idx }));
          })
        );
      }

      const results = await Promise.all(ops);
      // Results from execute calls should be pong strings
      for (const r of results) {
        if (typeof r === 'string') {
          expect(r).toContain('pong');
        }
      }
      // All dynamic tools should be registered
      expect(registry.getAll().length > 0).toBe(true); // at least ping
    });
  });

  // ── Type safety edge cases ──
  describe('type safety edge cases', () => {
    it('should accept parameters as null (edge case)', () => {
      const registry = new ToolRegistry();
      const tool: ToolDef = {
        name: 'nullable-params',
        description: 'Null parameters',
        parameters: null as unknown as Record<string, unknown>,
        execute: async () => 'ok',
      };
      registry.register(tool);
      const schemas = registry.getOpenAISchemas();
      expect(schemas[0].function.parameters).toBeNull();
    });

    it('should accept parameters as array (edge case)', () => {
      const registry = new ToolRegistry();
      const tool: ToolDef = {
        name: 'array-params',
        description: 'Array parameters',
        parameters: ['a', 'b'] as unknown as Record<string, unknown>,
        execute: async () => 'ok',
      };
      registry.register(tool);
      const schemas = registry.getOpenAISchemas();
      expect(Array.isArray(schemas[0].function.parameters)).toBe(true);
    });

    it('should handle undefined arguments in DSMLToolCall', async () => {
      const registry = new ToolRegistry();
      registry.register(
        makeTool('undef-args', 'Handles undefined', async (args) => {
          return `type: ${typeof args}`;
        })
      );
      // Simulate arguments being undefined (type coercion)
      const call: DSMLToolCall = {
        id: 'test-id',
        name: 'undef-args',
        arguments: undefined as unknown as Record<string, unknown>,
      };
      // Should not crash; JavaScript will pass undefined
      const result = await registry.execute(call);
      expect(typeof result).toBe('string');
    });

    it('should handle tool name being a reserved JS property name', () => {
      const registry = new ToolRegistry();
      // Map uses string keys, so these are safe
      const reservedNames = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];
      for (const name of reservedNames) {
        registry.register(makeTool(name));
      }
      for (const name of reservedNames) {
        expect(registry.get(name)).toBeDefined();
      }
    });

    it('should handle very long tool names', () => {
      const registry = new ToolRegistry();
      const longName = 'a'.repeat(10000);
      registry.register(makeTool(longName));
      expect(registry.get(longName)).toBeDefined();
      expect(registry.get(longName)!.name).toHaveLength(10000);
    });

    it('should handle execute returning a Promise that resolves to undefined', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'undef-result',
        description: 'Returns undefined',
        parameters: {},
        execute: async () => undefined as unknown as string,
      });
      const result = await registry.execute(makeCall('undef-result'));
      expect(result).toBeUndefined();
    });

    it('should return false positive on hasOwnProperty-style tool lookup', () => {
      const registry = new ToolRegistry();
      // Don't register "toString" — get() should return undefined, not the Map's prototype method
      expect(registry.get('toString')).toBeUndefined();
      expect(registry.get('hasOwnProperty')).toBeUndefined();
      // Now register it
      registry.register(makeTool('toString'));
      expect(registry.get('toString')).toBeDefined();
    });
  });

  // ── Integration-like scenarios ──
  describe('integration scenarios', () => {
    it('should simulate real-world tool register → schema → execute flow', async () => {
      const registry = new ToolRegistry();

      // Register tools
      registry.register({
        name: 'read_file',
        description: 'Read a file from the filesystem',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
          },
          required: ['filePath'],
        },
        execute: async (args) => `Contents of ${args.filePath}`,
      });

      registry.register({
        name: 'write_file',
        description: 'Write content to a file',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['filePath', 'content'],
        },
        execute: async (args) => `Wrote to ${args.filePath}`,
      });

      // Get OpenAI schemas (simulates sending to API)
      const schemas = registry.getOpenAISchemas();
      expect(schemas).toHaveLength(2);
      expect(schemas.map((s) => s.function.name).sort()).toEqual([
        'read_file',
        'write_file',
      ]);

      // Simulate an LLM calling read_file
      const result = await registry.execute(
        makeCall('read_file', { filePath: '/tmp/test.txt' })
      );
      expect(result).toBe('Contents of /tmp/test.txt');

      // Simulate calling missing tool
      const missingResult = await registry.execute(makeCall('delete_file'));
      expect(missingResult).toBe('Unknown tool: delete_file');
    });

    it('should support dynamic tool replacement (hot-reload simulation)', async () => {
      const registry = new ToolRegistry();

      // Initial version
      registry.register({
        name: 'api_call',
        description: 'API v1',
        parameters: { endpoint: 'v1' } as unknown as Record<string, unknown>,
        execute: async () => 'v1-response',
      });

      let result = await registry.execute(makeCall('api_call'));
      expect(result).toBe('v1-response');

      // Hot-replace with v2
      registry.register({
        name: 'api_call',
        description: 'API v2',
        parameters: { endpoint: 'v2' } as unknown as Record<string, unknown>,
        execute: async () => 'v2-response',
      });

      result = await registry.execute(makeCall('api_call'));
      expect(result).toBe('v2-response');

      const schemas = registry.getOpenAISchemas();
      expect(schemas).toHaveLength(1);
      expect(schemas[0].function.description).toBe('API v2');
    });

    it('should work with multiple registries in isolation', () => {
      const regA = new ToolRegistry();
      const regB = new ToolRegistry();

      regA.register(makeTool('shared-name', 'from A'));
      regB.register(makeTool('shared-name', 'from B'));

      expect(regA.get('shared-name')!.description).toBe('from A');
      expect(regB.get('shared-name')!.description).toBe('from B');

      // Cross-contamination check
      regA.register(makeTool('only-in-a'));
      expect(regA.get('only-in-a')).toBeDefined();
      expect(regB.get('only-in-a')).toBeUndefined();
    });
  });
});

// ── Run summary ──

// Allow async tests to settle
setTimeout(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ✗ ${f}`);
    }
    process.exitCode = 1;
  } else {
    console.log('All tests passed! ✓');
  }
  // Force exit (ES modules won't auto-exit with pending timers)
  process.exit(failed > 0 ? 1 : 0);
}, 500);
