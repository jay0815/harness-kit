# CLAUDE.md — harness-kit

## Project Overview

harness-kit is a PI Extension that orchestrates coding agents (Claude Code, Codex, Kimi, etc.) through structured workflows with hard fact verification. The core idea: **Agent = Model + Harness** — harness-kit IS the harness.

## Tech Stack

- **Language**: TypeScript 6.x, ESM (`"type": "module"`)
- **Runtime**: Node.js >= 20
- **Package Manager**: pnpm (workspace)
- **Build**: tsc (TypeScript compiler)
- **Test**: vitest
- **Lint**: oxlint
- **Framework**: PI (agent framework from `github-repo/pi-mono`)
- **IPC**: tmux + tmux-bridge (ACP protocol)

## Commands

```bash
# From repo root (runs across all packages):
pnpm install          # install dependencies
pnpm run build        # build all packages
pnpm run test         # run all tests
pnpm run lint         # lint all packages
pnpm run typecheck    # type-check all packages

# From packages/harness-kit:
pnpm run build        # tsc
pnpm run test         # vitest run
pnpm run test:watch   # vitest watch mode
pnpm run lint         # oxlint src/
pnpm run typecheck    # tsc --noEmit
pnpm run test:e2e     # E2E test (requires tmux)
```

## Directory Structure

```
harness-kit/
├── CLAUDE.md                  # this file
├── pnpm-workspace.yaml        # workspace config
├── package.json                # root scripts
├── packages/harness-kit/       # main package
│   ├── src/
│   │   ├── index.ts           # PI Extension entry
│   │   ├── tools.ts           # 4 PI tools (start_agent, acp_send, acp_read, hard_verify)
│   │   ├── pane.ts            # tmux pane lifecycle
│   │   ├── result-block.ts    # <HK_RESULT> parser
│   │   ├── verify.ts          # hard fact verification
│   │   ├── workflow.ts        # 3-phase workflow
│   │   ├── telemetry.ts       # JSONL event recording
│   │   ├── telemetry-cli.ts   # telemetry analysis CLI
│   │   ├── cli.ts             # standalone harness-verify CLI
│   │   ├── types.ts           # shared interfaces
│   │   └── *.test.ts          # vitest tests
│   ├── scripts/               # E2E test scripts
│   └── bin/                   # CLI entry points
└── docs/                      # design documents
```

## Key Design Decisions

1. **`<HK_RESULT>` block is the ONLY output boundary** — agents must wrap structured JSON in these tags
2. **Hard verify checks citations against disk** — file path + line range + exact text, NOT correctness of conclusions
3. **Fail-stop** — if verification fails, workflow stops. No auto-retry in MVP
4. **Single executor + single validator** — no multi-agent chat, only harness relay
5. **Human confirm at key nodes** — phases marked `humanConfirm: true` pause for user approval

## PI Framework Integration

PI is the underlying agent framework. harness-kit registers as an Extension via `ExtensionAPI`:

- `pi.registerTool()` — registers the 4 harness-kit tools
- `pi.on("session_start")` — captures workspace dir, inits telemetry
- `pi.on("session_shutdown")` — closes telemetry
- `pi.on("before_agent_start")` — injects workflow instructions into system prompt

PI packages are local file dependencies from `github-repo/pi-mono/`.

## Code Conventions

- **ESM only** — `import`/`export`, no `require()`
- **TypeBox for schemas** — `@sinclair/typebox` for tool parameter definitions
- **Strict TypeScript** — `strict: true` in tsconfig
- **No comments** — code should be self-documenting
- **Synchronous I/O in tools** — `execFileSync`, `readFileSync` (PI tools are async but internals are sync)

## ACP Protocol

Agent Communication Protocol via tmux-bridge:
- `bridge(["read", paneId, "5"])` — read pane output (satisfies read guard)
- `bridge(["type", paneId, text])` — type text into pane
- `bridge(["keys", paneId, "Enter"])` — send key
- **Read guard**: must `read` before `type`/`keys`, and each `type`/`keys` clears the guard
