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

## [2026-05-24] feat | 自定义 workflow 执行框架

- 支持 YAML 格式定义 workflow，TypeBox schema 验证
- 两种 executor 类型：llm（LLM 执行）+ code（代码执行）
- code executor 支持 shell command 和外部脚本（.ts/.js）
- 模板替换：{{phaseName.output}} 引用前序 phase 输出
- Fail-stop 模式：首个 phase 失败即停止
- Dry-run 模式：executeWorkflow({ dryRun: true }) 只验证不执行
- 新增 4 个模块：workflow-schema, workflow-loader, code-executor, workflow-executor
- 40 个新测试，总计 75 个测试全部通过

## [2026-05-24] design | Agent Runtime 重构计划

- 决定构建自有 agent runtime，替代 PI 黑盒
- 研究三个参考项目：prax-agent（middleware）、pi-coding-agent（loop/session）、hermes-agent（compaction/toolset）
- 关键决策：双 Agent 架构（Agent A 转述者 + Agent B 执行者）
- Compaction 哲学：动态上下文组装，不是压缩摘要
- Wiki 双重角色：静态背景（system prompt）+ 动态记忆源（search_memory 工具）
- 计划落盘：wiki/agent-runtime-plan.md

## [2026-05-24] feat | Phase 1: 双 Agent Loop + Middleware

**Phase 1 全部完成**，新增 `packages/harness-agent/` 包。

### Step 1.1: 类型系统 (`core/types.ts`)
- 双 Agent 类型：AgentAState, AgentBState, TaskResult, TaskSummary, AgentAPreliminaryAssessment
- Middleware 类型：AgentMiddleware (4 hooks), RuntimeState, LLMResponse, TokenUsage
- IterationBudget：线程安全的 consume/refund 计数器
- Priority 常量：GUARD=10, CACHE=20, INJECT=50, EXTRACT=90, EVAL=95

### Step 1.2: Agent A + Agent B (`core/agent-a.ts`, `core/agent-b.ts`)
- Agent A：初步评估（理解意图 + 复杂度/风险），不清楚时澄清，整理记忆后委托 Agent B
- Agent B：任务驱动执行者，token >= 90% 时自动交接给新 Agent B
- Agent A 只保留任务结果摘要，细节从 wiki/JSONL 按需读取

### Step 1.3: StreamingToolExecutor (`core/streaming-tool-executor.ts`)
- 并行/串行工具调度
- PARALLEL_SAFE_TOOLS（read_file, grep, glob）用 Promise.all 并行
- NEVER_PARALLEL_TOOLS（write_file, edit_file）串行执行
- 最大并发数可配置（默认 8）

### Step 1.4: ChangeTracker (`core/change-tracker.ts`)
- Single-writer 原则：唯一写入 change_tracker 状态的 middleware
- codeGen: code-modifying tool 成功后递增
- verifiedGen: verify 通过后设为 codeGen
- 辅助函数：hasUnverifiedChanges, getLastVerifyError, isLastVerifyOk

### Step 1.5: 基础 middleware (`core/middlewares.ts`)
- VerificationGuidanceMiddleware (priority 60): 验证后注入引导消息
- ToolCallGuardrailMiddleware (priority 10): per-turn 模式追踪，阻止重复失败
- QualityGateMiddleware (priority 95): synthetic tool call 阻止未验证的完成
- IntentGateMiddleware (priority 50): 强制 LLM 先 verbalize 计划

### 中间件 Pipeline (`core/middleware.ts`)
- MiddlewarePipeline: priority-sorted chain，4 个 hook 点
- runBeforeModel, runAfterModel, runBeforeTool, runAfterTool

### 核心循环 (`core/agent-loop.ts`)
- runAgentLoop: 集成 middleware pipeline 的核心循环
- IterationBudget 驱动，支持 steering/followUp 消息
- 工具执行经过完整的 middleware chain

### 测试用例 (6 个测试文件, 58 个测试)
- `types.test.ts` — IterationBudget (7 tests), 常量 (2 tests)
- `middleware.test.ts` — Pipeline priority ordering, chaining, blocking, unregister, empty pipeline (7 tests)
- `change-tracker.test.ts` — codeGen/verifiedGen tracking, verify commands, helper functions (13 tests)
- `middlewares.test.ts` — VerificationGuidance, ToolCallGuardrail, QualityGate, IntentGate (18 tests)
- `agent-a.test.ts` — 创建, 初步评估, 模糊输入, 问题, 任务 (6 tests)
- `streaming-tool-executor.test.ts` — sequential, parallel, never-parallel, error handling, missing tool (5 tests)
