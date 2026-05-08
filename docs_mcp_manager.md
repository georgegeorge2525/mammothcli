# MCPManager Documentation

**File:** `MCPManager.ts`  
**Version:** 3.0.0 (Mammoth TUI)  
**Last Updated:** 2025  

---

## Table of Contents

1. [Purpose](#purpose)
2. [Architecture Overview](#architecture-overview)
3. [Configuration](#configuration)
4. [How Tools Connect](#how-tools-connect)
5. [API Reference](#api-reference)
6. [Error Handling](#error-handling)
7. [Code Usage Examples](#code-usage-examples)
8. [Integration with ToolRegistry](#integration-with-toolregistry)
9. [Lifecycle Management](#lifecycle-management)

---

## Purpose

`MCPManager` is the **Model Context Protocol (MCP) integration layer** for the Mammoth TUI application. It enables Mammoth to:

- Load MCP server configuration from a JSON file (`.mammoth/mcp.json`).
- Spawn external MCP-compatible server processes over **stdio**.
- Discover tools exposed by those servers using JSON-RPC 2.0.
- Convert MCP tool definitions into Mammoth's internal `ToolDef` format for use by the `ToolRegistry`.
- Provide a clean shutdown mechanism for all managed server processes.

MCP (Model Context Protocol) is an open protocol that standardizes how applications provide context and tools to LLMs. MCPManager allows Mammoth to extend its tooling capabilities by connecting to any MCP-compliant server.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                    Mammoth TUI                    │
│                                                   │
│  ┌─────────────┐       ┌───────────────────────┐ │
│  │ ToolRegistry │◄──────│      MCPManager       │ │
│  │             │       │                       │ │
│  │ register()  │       │ loadConfig()          │ │
│  │ execute()   │       │ startServer()         │ │
│  │ get()       │       │ getToolDefs()         │ │
│  └─────────────┘       │ shutdown()            │ │
│                        └─────────┬─────────────┘ │
└──────────────────────────────────┼───────────────┘
                                   │
                     ┌─────────────▼─────────────┐
                     │     MCP Server Process     │
                     │  (stdio: stdin/stdout)     │
                     │                            │
                     │  JSON-RPC 2.0 protocol     │
                     │  - initialize              │
                     │  - tools/list              │
                     │  - tools/call              │
                     └────────────────────────────┘
```

### Key Design Decisions

1. **Process-per-server**: Each MCP server configuration spawns a separate child process. Processes communicate exclusively via **stdin/stdout** (stdio transport).

2. **JSON-RPC 2.0**: All MCP messages follow the JSON-RPC 2.0 specification. Each request includes `jsonrpc`, `id`, `method`, and `params`. Responses include `jsonrpc`, `id`, and `result` or `error`.

3. **Namespace Prefixing**: MCP tools are registered in the ToolRegistry with the prefix `mcp__<serverName>__<toolName>` to avoid naming collisions with built-in Mammoth tools.

4. **Lazy Initialization**: Servers are not started until `startServer()` is explicitly called, allowing deferred startup.

5. **Singleton Manager**: A single `MCPManager` instance manages all MCP connections via the `servers` Map.

---

## Configuration

### Config File Location

MCP server configuration is loaded from **`.mammoth/mcp.json`** relative to the current working directory. An alternative path can be passed to `loadConfig(configPath?)`.

### Config File Schema

```jsonc
{
  "mcpServers": [
    {
      "name": "my-server",            // Unique identifier for the server
      "command": "node",              // Executable command
      "args": ["server.js", "--port", "8080"],  // Command-line arguments (optional)
      "env": {                        // Environment variables (optional)
        "MY_API_KEY": "sk-...",
        "NODE_ENV": "production"
      },
      "enabled": true                 // Whether to auto-enable (default: true)
    }
  ]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | ✅ Yes | — | Unique name to identify this MCP server |
| `command` | `string` | ✅ Yes | — | Executable to spawn |
| `args` | `string[]` | ❌ No | `[]` | Arguments passed to the command |
| `env` | `Record<string, string>` | ❌ No | `{}` | Extra environment variables (merged with `process.env`) |
| `enabled` | `boolean` | ❌ No | `true` | If `false`, the server is skipped during loading |

### Backward Compatibility

The `loadConfig()` method supports two formats:
- `data.mcpServers` (preferred, MCP standard)
- `data.servers` (legacy fallback)

---

## How Tools Connect

### Connection Flow

```
1. loadConfig()
   │
   ▼
2. startServer(name)
   │
   ├─ Spawns child process (stdio pipes)
   │
   ├─ Sends JSON-RPC "initialize" request
   │     └─ { jsonrpc: "2.0", id: 1, method: "initialize",
   │          params: { protocolVersion: "2024-11-05", ... } }
   │
   ├─ Sends JSON-RPC "tools/list" request
   │     └─ { jsonrpc: "2.0", id: 2, method: "tools/list" }
   │
   ├─ Receives tool definitions
   │     └─ { jsonrpc: "2.0", id: 2, result: { tools: [...] } }
   │
   ├─ Stores tools in server.tools[]
   │
   └─ Server is now "ready"
       │
       ▼
3. getToolDefs()
   │
   └─ Converts MCPTool[] → ToolDef[] (with mcp__ prefix)
       │
       ▼
4. ToolRegistry.register(toolDef)
```

### Tool Calling Flow

When a tool registered via MCP is executed:

```
ToolRegistry.execute({ name: "mcp__server__tool", arguments: {...} })
        │
        ▼
MCPManager.getToolDefs() execute callback
        │
        ├─ Sends JSON-RPC "tools/call" request
        │     └─ { jsonrpc: "2.0", id: <timestamp>, method: "tools/call",
        │          params: { name: "tool", arguments: {...} } }
        │
        ├─ Waits for response (30s timeout)
        │
        └─ Returns JSON-stringified result
```

### Protocol Details

- **Transport**: stdio (stdin for requests, stdout for responses)
- **Protocol**: JSON-RPC 2.0
- **Supported Methods**:
  - `initialize` — Handshake with protocol version negotiation
  - `tools/list` — Discover available tools
  - `tools/call` — Invoke a specific tool
- **Buffer Handling**: Incoming data is buffered and split by newlines. Partial JSON chunks are accumulated until complete lines arrive.

---

## API Reference

### Class: `MCPManager`

#### Internal State

```typescript
private servers: Map<string, {
  config: MCPServerConfig
  process?: ChildProcess
  tools: MCPTool[]
}>
```

Each entry tracks:
- The original configuration used to spawn the server
- The running child process (if started)
- The list of tools discovered from that server

---

#### `loadConfig(configPath?: string): MCPServerConfig[]`

Loads MCP server configurations from a JSON file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `configPath` | `string` (optional) | `cwd/.mammoth/mcp.json` | Custom path to config file |

**Returns:** Array of `MCPServerConfig` objects that were loaded.

**Behavior:**
- Reads and parses the JSON file
- Looks for `mcpServers` or `servers` keys
- Skips servers where `enabled` is explicitly `false`
- Stores each server in the internal `servers` Map
- Silently returns an empty array if the file doesn't exist or is invalid

---

#### `startServer(name: string): Promise<MCPTool[]>`

Starts an MCP server process and discovers its tools.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | The name of the server (must match a loaded config) |

**Returns:** Promise resolving to an array of `MCPTool` objects.

**Throws:**
- `Error("MCP server not found: ${name}")` if the server is not in the config

**Behavior:**
- If the server is already running, returns cached tools immediately
- Spawns the child process with configured command, args, and environment
- Sends an `initialize` JSON-RPC request with protocol version `2024-11-05`
- Sends a `tools/list` request to discover tools
- Stores the process reference and tool list
- On failure, kills the spawned process and re-throws the error

---

#### `getToolDefs(): ToolDef[]`

Converts all discovered MCP tools into Mammoth's `ToolDef` format for registration.

**Returns:** Array of `ToolDef` objects.

**Naming Convention:**
```
Tool name:  mcp__<serverName>__<toolName>
Description: [MCP:<serverName>] <tool description>
```

**Execute Callback:**
Each generated `ToolDef` includes an `execute` function that:
1. Checks if the server process is still running
2. Sends a `tools/call` JSON-RPC request with the tool name and arguments
3. Waits for a response (30-second timeout)
4. Returns `JSON.stringify(result)` on success
5. Returns `"MCP server not running"` if the process died
6. Returns `"MCP tool timeout"` if no response within 30 seconds

---

#### `shutdown(): void`

Gracefully terminates all running MCP server processes.

**Behavior:**
- Iterates over all configured servers
- Calls `process.kill()` on any that have a running process
- Does **not** clear the config or tool cache (servers can be restarted)

---

### Interfaces

#### `MCPServerConfig`

```typescript
export interface MCPServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}
```

#### `MCPTool` (internal)

```typescript
interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}
```

#### `ToolDef` (from ToolRegistry)

```typescript
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<string>
}
```

---

## Error Handling

### Scenario Matrix

| Scenario | Handling |
|----------|----------|
| Config file not found | Silently returns `[]` |
| Invalid JSON in config | `JSON.parse` throws → caught by try/catch → returns `[]` |
| Server name not found in `startServer()` | Throws `Error("MCP server not found: ...")` |
| Server process fails to spawn | `spawn()` throws → propagates to caller |
| Initialization request fails | Catches error → kills process → re-throws |
| `tools/list` returns no tools | Returns empty array (no tools discovered) |
| Server process dies before tool call | Execute callback returns `"MCP server not running"` |
| JSON-RPC error response | Rejects with `Error(msg.error.message)` |
| Request timeout (initialize/list) | 10-second timeout → kills process → throws |
| Request timeout (tool call) | 30-second timeout → resolves with `"MCP tool timeout"` |
| Partial JSON in buffer | Waits for more data (buffering logic) |

### Timeout Values

| Operation | Timeout |
|-----------|---------|
| Server initialization / tool discovery | **10 seconds** |
| Tool execution (`tools/call`) | **30 seconds** |

---

## Code Usage Examples

### Basic Setup

```typescript
import { MCPManager } from './MCPManager.js'
import { ToolRegistry } from './ToolRegistry.js'

const mcpManager = new MCPManager()
const registry = new ToolRegistry()

// 1. Load configuration
mcpManager.loadConfig()
// Reads from ./.mammoth/mcp.json by default

// 2. Start a server and discover tools
const tools = await mcpManager.startServer('my-server')
console.log(`Discovered ${tools.length} tools`)

// 3. Convert to ToolDef and register
const toolDefs = mcpManager.getToolDefs()
for (const def of toolDefs) {
  registry.register(def)
}

// 4. Use the tool
const result = await registry.execute({
  name: 'mcp__my-server__fetch',
  arguments: { url: 'https://example.com' },
})
console.log(result)

// 5. Clean up
mcpManager.shutdown()
```

### Custom Config Path

```typescript
const mcpManager = new MCPManager()
mcpManager.loadConfig('/home/user/.config/mammoth/mcp-servers.json')
```

### Starting Multiple Servers

```typescript
const mcpManager = new MCPManager()
mcpManager.loadConfig()

const serverNames = ['database-server', 'file-server', 'search-server']
for (const name of serverNames) {
  try {
    const tools = await mcpManager.startServer(name)
    console.log(`Server "${name}" started with ${tools.length} tools`)
  } catch (err) {
    console.error(`Failed to start "${name}":`, err)
  }
}

const allDefs = mcpManager.getToolDefs()
// allDefs contains tools from all successfully started servers
```

### Error Handling Pattern

```typescript
const mcpManager = new MCPManager()
mcpManager.loadConfig()

try {
  const tools = await mcpManager.startServer('my-server')
  const defs = mcpManager.getToolDefs()
  for (const def of defs) {
    const result = await def.execute({ someArg: 'value' })
    if (result === 'MCP server not running') {
      // Handle dead process — maybe restart
      console.error('Server died! Attempting restart...')
      await mcpManager.startServer('my-server')
    }
  }
} catch (err) {
  console.error('MCP operation failed:', err)
  mcpManager.shutdown()
}
```

### Integration with an Application Lifecycle

```typescript
class App {
  private mcpManager = new MCPManager()
  private registry = new ToolRegistry()

  async initialize(): Promise<void> {
    this.mcpManager.loadConfig()
    // Start all enabled servers
    const configs = this.mcpManager.loadConfig()
    for (const cfg of configs) {
      await this.mcpManager.startServer(cfg.name)
    }
    // Register all MCP tools
    for (const def of this.mcpManager.getToolDefs()) {
      this.registry.register(def)
    }
  }

  async shutdown(): Promise<void> {
    this.mcpManager.shutdown()
    console.log('All MCP servers terminated')
  }
}
```

---

## Integration with ToolRegistry

`MCPManager` and `ToolRegistry` work together as follows:

1. **MCPManager** handles the low-level protocol and process management.
2. **ToolRegistry** provides a unified tool execution interface for the rest of the Mammoth application.
3. `getToolDefs()` produces `ToolDef` objects that can be directly passed to `ToolRegistry.register()`.
4. Tool names are prefixed with `mcp__<serverName>__` to ensure uniqueness.

```
ToolRegistry
├── Built-in Mammoth tools (e.g., "read", "write", "edit")
├── MCP tools (prefixed: "mcp__server__tool")
└── (Future extensions)
```

---

## Lifecycle Management

```
                  ┌──────────────────┐
                  │   Configuration   │
                  │   (mcp.json)     │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │   loadConfig()   │
                  │  (parses JSON)   │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
           ┌──────│  startServer()   │──────┐
           │      │ (spawns process) │      │
           │      └────────┬─────────┘      │
           │               │                │
           ▼               ▼                ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ Server A   │  │ Server B   │  │ Server C   │
    │ (running)  │  │ (running)  │  │ (running)  │
    └────────────┘  └────────────┘  └────────────┘
           │               │                │
           ▼               ▼                ▼
    ┌──────────────────────────────────────────┐
    │           getToolDefs()                  │
    │   (converts to ToolDef[] with prefix)    │
    └────────────────┬─────────────────────────┘
                     │
                     ▼
    ┌──────────────────────────────────────────┐
    │         ToolRegistry.register()          │
    └──────────────────────────────────────────┘
                     │
                     ▼
    ┌──────────────────────────────────────────┐
    │              shutdown()                   │
    │   (kills all child processes)            │
    └──────────────────────────────────────────┘
```

---

## Testing Considerations

1. **Mock the child process**: For unit tests, mock `spawn()` from `node:child_process` to avoid actual process creation.
2. **Simulate stdio**: Use mock streams to send/receive JSON-RPC messages.
3. **Test timeouts**: Verify that the 10s initialize timeout and 30s tool call timeout work correctly.
4. **Test buffer splitting**: Send fragmented JSON chunks to verify buffering logic.
5. **Test server death**: Kill a process mid-operation to verify the `"MCP server not running"` fallback.
6. **Test config variations**: Test with `mcpServers` key, `servers` key, malformed JSON, missing file, disabled servers.

---

## Limitations & Future Considerations

- **No auto-restart**: If a server process dies, it must be manually restarted via `startServer()`.
- **No stderr handling**: Standard error from child processes is not captured or logged.
- **stdio only**: This implementation uses stdio transport; MCP also supports SSE (Server-Sent Events) which is not implemented here.
- **No notification support**: MCP notifications (one-way messages) are not implemented.
- **Process cleanup**: Relies on `process.kill()` which sends SIGTERM; some servers may require SIGKILL or a graceful shutdown protocol.
- **Single client**: Only one JSON-RPC request is tracked at a time per server (sequential request IDs).

---

*End of MCPManager Documentation*
