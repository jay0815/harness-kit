# Activity Log

## [2026-05-02] init | Project created

- Initial commit with full MVP implementation
- 8 source files, 12 unit tests
- Hardcoded 3-phase workflow (design → implement → test)
- 4 PI tools: start_agent, acp_send, acp_read, hard_verify

## [2026-05-02] docs | README + AGENTS.md

- Comprehensive README with architecture diagram
- AGENTS.md for coding agent developer guide

## [2026-05-03] feat | Telemetry module

- JSONL event recording (telemetry.ts)
- Tool-level instrumentation in tools.ts (try/finally pattern)
- Telemetry CLI with summary/timeline/errors modes
- Mock agent script (--pass/--fail modes)
- E2E test script (direct tool invocation, no PI)
- 5 new unit tests (17 total)

## [2026-05-03] fix | tmux-bridge read guard

- Discovered: type/keys both clear_read, need read before each interaction
- Fixed startAgentInPane to read before keys

## [2026-05-03] fix | PI dependency

- PI mono repo cloned, local dependencies now resolve
- Replaced process.on("beforeExit") with PI session_shutdown event

## [2026-05-24] chore | Tooling migration

- npm → pnpm workspace
- node:test → vitest
- Added oxlint, TypeScript 6.0
- Created CLAUDE.md (LLM wiki schema)
- All 17 tests passing

## [2026-05-24] docs | LLM Wiki architecture

- Karpathy's LLM Wiki pattern: raw sources (docs/) → wiki pages (wiki/) → schema (CLAUDE.md)
- 8 wiki pages: index, architecture, tech-stack, acp-protocol, pi-integration, design-decisions, conventions, log
- CLAUDE.md rewritten as lean schema (95→40 lines)
- Added principles: Linus's three questions, fact-based thinking, no sycophancy

## [2026-05-24] design | take-root architecture analysis

- Read take-root codebase: cli → phases → runtimes → agents
- Identified borrowable patterns: artifact-driven state, guardrails snapshot, convergence detection
- Noted key difference: take-root uses subprocess runtime, harness-kit uses tmux IPC
- Updated design-decisions.md with reference comparison table
