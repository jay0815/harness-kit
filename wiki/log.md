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

## [2026-05-24] feat | 降级方案：PI-as-agent 模式

- 重写 system prompt：orchestrator → coding agent
- workflow.ts executor 改为 "self"
- 真实环境验证：PI + kimi-coder 完成 design/implement/test 三阶段
- humanConfirm 机制验证通过
- telemetry 记录 4 次 hard_verify 调用（含 2 次自我纠错）

## [2026-05-24] feat | turn_end 自动验证

- 添加 turn_end handler：LLM 输出后自动拦截 HK_RESULT
- verifyFacts 验证失败时 pi.sendUserMessage 注入错误信息
- 不依赖 LLM 主动调用 hard_verify，对所有 LLM 有效
- telemetry 新增 auto_verify 事件类型

## [2026-05-24] feat | Guardrails 越权写入检测

- 新增 guardrails.ts：workspace 快照与越权文件检测
- snapshotWorkspace()：遍历 workspace，跳过 .git/.harness-kit/node_modules，记录 SHA256
- detectOutOfScope()：对比 phase 前后快照，检测未声明的文件变更
- 集成到 index.ts：phase 完成时自动检测越权变更
- telemetry 新增 guardrail:out_of_scope 事件类型
- 8 个单元测试全部通过
