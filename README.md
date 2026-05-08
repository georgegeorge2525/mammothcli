# Mammoth CLI

**Sovereign AI coding assistant. Runs in your terminal. Works with any LLM provider.**

Mammoth CLI is an interactive terminal UI for AI-assisted software development. It connects to any major LLM provider (DeepSeek, Claude, OpenAI, Groq, Ollama, OpenRouter), gives the model direct filesystem and shell access via tools, and lets you spawn specialized sub-agents for complex multi-step work.

```
$ mammothcli

> Write a function that parses ISO 8601 dates with timezone offsets

Mammoth reads your files, writes the code, runs the tests — all in your terminal.
```

## Features

- **Multi-provider** — DeepSeek, Anthropic Claude, OpenAI, Groq, Ollama, OpenRouter. Switch with `MAMMOTH_PROVIDER`.
- **Full tool suite** — Read, Write, Edit, Bash, Grep, Glob. LLM has direct filesystem and shell access.
- **Sub-agent system** — 9 specialized agent types (explorer, executor, code-reviewer, security-reviewer, debugger, architect, designer, writer, test-engineer). Spawned by the LLM automatically.
- **4-tier memory** — Working → Episodic → Semantic → Procedural. Learns across sessions via SQLite + FTS5.
- **Workflow engine** — State machine with circuit breaker. Autopilot, Ralph (quality-gated), Ultrawork (parallel) modes.
- **Slash commands** — Claude Code-compatible: `/help`, `/model`, `/doctor`, `/compact`, `/cost`, `/sessions`, `/resume`, `/config`, etc.
- **Session persistence** — Auto-saves conversations. Resume from any point.
- **MCP support** — Model Context Protocol for connecting external tool servers.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- An API key for at least one supported provider

## Install

```bash
# Clone
git clone https://github.com/your-org/mammothcli.git
cd mammothcli

# Install dependencies
bun install

# Set your API key
echo 'DEEPSEEK_API_KEY=sk-...' > .env

# Run
bun run start
```

### Global install

```bash
bun install -g .
mammothcli
```

Or place your API key at `~/.mammoth/.env` for global access.

## Provider configuration

Set `MAMMOTH_PROVIDER` to choose your LLM backend:

| Provider | Env var for key | Default model |
|----------|----------------|---------------|
| `deepseek` (default) | `DEEPSEEK_API_KEY` | deepseek-v4-pro |
| `claude` | `ANTHROPIC_API_KEY` | claude-sonnet-4-6 |
| `openai` | `OPENAI_API_KEY` | gpt-4o |
| `groq` | `GROQ_API_KEY` | llama-4-maverick-128k |
| `ollama` | (none — local) | llama3.1 |
| `openrouter` | `OPENROUTER_API_KEY` | openai/gpt-4o |

```bash
# Use Claude
MAMMOTH_PROVIDER=claude ANTHROPIC_API_KEY=sk-ant-... mammothcli

# Use local Ollama
MAMMOTH_PROVIDER=ollama mammothcli
```

## Architecture

```
main-tui.tsx          Ink/React terminal UI
MammothLoop.ts        LLM conversation engine
AgentRunner.ts        Sub-agent spawner
Commands.ts           Slash command handler
ToolRegistry.ts       Tool registration + execution
services/
  providerClient.ts   Multi-provider API client
  apiClient.ts        DeepSeek native client (fast path)
  deepseekProtocol.ts DSML encode/decode
  memoryStore.ts      SQLite-backed memory
  engine.ts           Workflow orchestration
providers/
  deepseekProvider.ts Anthropic-compatible adapter for DeepSeek
  claudeProvider.ts   Native Anthropic Messages API adapter
  openaiProvider.ts   OpenAI Chat Completions adapter
  groqProvider.ts     Groq adapter
  ollamaProvider.ts   Ollama local adapter
  openrouterProvider.ts OpenRouter adapter
memory/               4-tier consolidation system
engine/               Workflow state machine + team orchestration
```

## Slash commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model [name]` | Show/switch model |
| `/clear` | Clear conversation |
| `/status` | Session stats |
| `/sessions` | List saved sessions |
| `/resume <id>` | Resume a session |
| `/cost` | API usage estimate |
| `/memory` | Memory system stats |
| `/consolidate` | Run memory consolidation |
| `/compact [N]` | Trim conversation history |
| `/doctor` | System diagnostics |
| `/config` | Show configuration |
| `/exit` | Quit |

## Agent types

| Agent | Tools | Use case |
|-------|-------|----------|
| `explore` | Read, Grep, Glob | Codebase search, research |
| `executor` | Read, Write, Edit, Grep, Glob, Bash | Implementation |
| `code-reviewer` | Read, Grep, Glob | Code quality review |
| `security-reviewer` | Read, Grep, Glob | Security audit |
| `debugger` | Read, Grep, Glob, Bash | Root cause investigation |
| `architect` | Read, Write, Grep, Glob | Design + architecture docs |
| `designer` | Read, Write, Edit | UI/UX design |
| `writer` | Read, Write, Edit, Grep | Documentation |
| `test-engineer` | Read, Write, Bash | Test generation |

## License

Apache 2.0 — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.
