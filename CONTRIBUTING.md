# Contributing to Mammoth CLI

Thanks for contributing. Mammoth CLI is an open-source AI coding assistant — PRs, issues, and ideas are welcome.

## Getting started

```bash
git clone https://github.com/your-org/mammothcli.git
cd mammothcli
bun install
cp .env.example .env   # add your API key
bun run start
```

## Project structure

- `main-tui.tsx` — entry point, TUI bootstrap, tool registration
- `MammothLoop.ts` — LLM conversation engine
- `AgentRunner.ts` — sub-agent spawner
- `services/` — API clients, protocol codecs, memory, engine
- `providers/` — per-provider adapters (all implement `ProviderAdapter`)
- `memory/` — 4-tier memory consolidation (SQLite + FTS5)
- `engine/` — workflow state machine, team orchestration

## Type checking

```bash
bun run typecheck
```

Zero type errors required before merge.

## Adding a new provider

1. Create `providers/yourProvider.ts` implementing `ProviderAdapter`
2. Add to `ProviderName` in `providers/types.ts`
3. Register in `providers/providerFactory.ts`
4. Add env vars to `.env` and README

## Commit style

- Present tense, imperative: "fix EISDIR crash on Read tool"
- Keep first line under 72 chars
- Reference issues with `#123`

## Testing

```bash
bun test                              # when tests are added
bun run start                         # interactive smoke test
```

Test manually by spawning each agent type and verifying output.

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
