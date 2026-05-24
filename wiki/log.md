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

## [2026-05-25] feat | Phase 2: Session 层 + ExtensionAPI

**Phase 2 完成**，实现与 PI AgentSession 接口兼容的 session 层。

### HarnessAgentSession (`session/harness-session.ts`)
- 封装完整 agent 生命周期：start/prompt/abort/shutdown
- ExtensionAPI adapter 提供事件订阅（on/emit）
- 内部使用 runAgentLoop + MiddlewarePipeline
- 每次 prompt 创建新 pipeline，注册默认 middleware

### Event Bridge (`session/event-bridge.ts`)
- PI 风格事件桥接：AssistantMessage → turn_end/message_start 等事件
- toolCall → tool_use 兼容：`input: block.input ?? block.arguments`

### 测试
- 11 个 inline mock 从 async generator 迁移到 stream.result() 协议
- event-bridge 测试：input/arguments 兼容性
- harness-session 测试：session 生命周期、prompt/abort/shutdown

## [2026-05-25] feat | Phase 3: Standalone CLI

**Phase 3 完成**，harness-agent 可独立运行，不依赖 PI runtime。

### CLI 入口 (`cli.ts`)
- 参数解析（args.ts）：--provider, --model, --workspace, --system-prompt, --max-iterations, --no-extension
- 配置解析（config.ts）：使用 pi-ai 的 getModel/getModels/getProviders/getEnvApiKey
- 交互式 REPL（repl.ts）：SIGINT/SIGTERM 处理、busy 锁、扩展加载
- 输出格式化（output.ts）：turn_start/end、tool_start/end、agent_end

### agent-loop.ts 修复
- collectStream() 改用 stream.result() 消费 AssistantMessageEventStream
- tool result message 改为 role: "toolResult" + toolName + timestamp
- error/abort 时清晰抛出，不静默返回空响应

### 循环依赖解决
- CLI 通过非字面量动态 import("@harness-kit/core") 加载扩展
- core 作为 optional peerDependency，不放 devDependencies

### 测试
- faux-integration.test.ts：3 个集成测试使用 registerFauxProvider()
- args.test.ts：16 个参数解析测试
- config.test.ts：11 个配置解析测试
- output.test.ts：8 个输出格式化测试
- repl.test.ts：5 个 session 集成测试

## [2026-05-25] docs | README 重写

- 重写 README.md：从 PI Extension 描述转为独立 agent runtime 方向
- 新增"为什么从编排外部 agent 转向自己就是 agent"说明
- 更新包结构：@harness-kit/agent（独立 runtime）+ @harness-kit/core（可选 PI Extension）
- 更新 Agent 输出契约、CLI 用法、设计文档链接

## [2026-05-25] design | 事实校验迁移计划

**决定**：将事实校验从 @harness-kit/core 移入 @harness-kit/agent 作为固定能力。

**动机**：
- 独立运行（CLI bare mode）时没有事实校验，agent 可以编造文件引用
- 事实校验是"agent 是否可信"的核心机制，不应是可选扩展
- verify.ts、result-block.ts、types.ts 是纯函数，零外部依赖，天然属于 agent 包

**方案**：
- 新建 FactVerificationMiddleware（afterModel hook，priority 90）
- 从 core 迁移 verify.ts、result-block.ts、verify-types.ts 到 agent 包
- core 改为从 agent 包导入验证函数，保留 PI 特有逻辑（telemetry、sendUserMessage）
- 与 ChangeTracker 集成：PASS 时更新 verifiedGen

**原则**：通过牺牲速度换取准确性。计划落盘为下一阶段实施目标。

## [2026-05-25] design | Agent A 评估机制重设计

**问题**：`assessInput()` 用 `includes("implement")`、`includes("fix")` 做任务分类，复杂度用词数估算。对真实输入太脆弱。

**决定**：评估 agent 改为独立 LLM 调用，上下文隔离。

**核心思考**：
- 单 agent + 好的 system prompt + 工具，天然能做任务评估和执行
- 但评估质量会被主 agent 的上下文污染（沉没成本偏见、已有对话历史干扰）
- 独立评估 agent 的价值：上下文隔离 → 客观性 → 可替换性
- 给评估 agent 工具（read_file、list_files），可以读代码辅助判断复杂度和风险

**方案**：
- assessInput() 改为 LLM 调用，结构化 prompt + JSON 输出
- 评估 agent 有自己的 system prompt（强调风险评估、任务分解）
- 评估 agent 只有只读工具（read_file、list_files）
- 评估 agent 输出：understood、taskOverview、complexity（附理由）、risk（附理由）、needsAgentB、clarificationNeeded

**收益**：关键词匹配 → 语义理解，词数估算 → 代码规模分析，硬编码规则 → prompt 迭代。

计划落盘到 wiki/agent-runtime-plan.md。

## [2026-05-25] design | Subagent 调度设计 + pi-ai 解耦

**Subagent 调度设计**（待细化）：
- "claude -p 作为 subagent" 只有方向没有具体设计
- 待回答：上下文怎么注入、输出协议（<HK_RESULT> 从哪来）、失败处理、多 subagent 协调
- 方案：主 agent 构建 context → 启动 subagent（claude -p / codex）→ 收集输出 → 事实校验 → 失败重试
- 需要定义 subagent 调度协议（system prompt 模板、输出格式、超时配置）

**pi-ai 解耦**（优先级最低）：
- StreamFn、AssistantMessage、Model 等核心类型全部来自 pi-ai
- 消息格式（role: "toolResult"、toolCallId）是 pi-ai 的约定
- 测试 mock 基于 registerFauxProvider
- 当前 pi-ai 工作正常，解耦成本高、收益不明确
- 未来路径：定义自有消息格式 → 通用 stream 协议 → 转换层 → 替换 mock

计划落盘到 wiki/agent-runtime-plan.md。
