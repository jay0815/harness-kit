# 文件地图

按职责分类的源码文件索引。

## @harness-kit/agent

### CLI 层

| 文件 | 职责 |
|------|------|
| `src/cli.ts` | CLI 入口 |
| `src/cli/args.ts` | 参数解析，定义 `ParsedArgs` 类型 |
| `src/cli/args.test.ts` | 参数解析测试 |
| `src/cli/config.ts` | 配置解析，创建 `streamFn`，组装 `HarnessAgentSessionConfig` |
| `src/cli/config.test.ts` | 配置解析测试 |
| `src/cli/repl.ts` | 交互式 prompt loop |
| `src/cli/repl.test.ts` | REPL 测试 |
| `src/cli/output.ts` | 终端输出格式化 |
| `src/cli/output.test.ts` | 输出格式化测试 |

### 核心层

| 文件 | 职责 |
|------|------|
| `src/core/agent-loop.ts` | 多轮 LLM 调用 + 工具执行循环，集成 middleware pipeline |
| `src/core/agent-loop.test.ts` | Agent loop 测试 |
| `src/core/agent-a.ts` | Agent 变体 A |
| `src/core/agent-a.test.ts` | Agent A 测试 |
| `src/core/agent-b.ts` | Agent 变体 B |
| `src/core/middleware.ts` | priority-sorted middleware chain，4 个 hook 点（beforeModel/afterModel/beforeTool/afterTool） |
| `src/core/middleware.test.ts` | Middleware 测试 |
| `src/core/middlewares.ts` | 内置中间件：VerificationGuidance, ToolCallGuardrail, QualityGate, IntentGate |
| `src/core/middlewares.test.ts` | 内置中间件测试 |
| `src/core/change-tracker.ts` | 追踪 codeGen/verifiedGen，single-writer 原则 |
| `src/core/change-tracker.test.ts` | ChangeTracker 测试 |
| `src/core/fact-verification.ts` | afterModel 钩子，自动校验 `<HK_RESULT>` 中的事实声明 |
| `src/core/fact-verification.test.ts` | 事实校验测试 |
| `src/core/result-block.ts` | 从 `<HK_RESULT>` 块提取 JSON |
| `src/core/result-block.test.ts` | Result block 解析测试 |
| `src/core/verify.ts` | 读取文件、切片行号、逐字比对 |
| `src/core/verify.test.ts` | 校验逻辑测试 |
| `src/core/verify-types.ts` | 校验相关类型定义 |
| `src/core/evaluator.ts` | 评估器 |
| `src/core/evaluator.test.ts` | 评估器测试 |
| `src/core/streaming-tool-executor.ts` | 流式工具执行 |
| `src/core/streaming-tool-executor.test.ts` | 流式工具执行测试 |
| `src/core/tool-utils.ts` | 工具调用参数提取（`input ?? arguments` 防御逻辑） |
| `src/core/types.ts` | 核心类型定义（Model, StreamFn 等） |
| `src/core/types.test.ts` | 类型测试 |
| `src/core/test-utils.ts` | 测试辅助工具 |
| `src/core/compaction/` | 上下文压缩模块 |

### Session 层

| 文件 | 职责 |
|------|------|
| `src/session/harness-session.ts` | HarnessAgentSession 封装完整生命周期 |
| `src/session/harness-session.test.ts` | Session 测试 |
| `src/session/event-bridge.ts` | PI 风格事件桥接（`bridgeContentBlocks`） |
| `src/session/event-bridge.test.ts` | 事件桥接测试 |
| `src/session/extension-api-adapter.ts` | Extension API 适配器 |
| `src/session/extension-api-adapter.test.ts` | 适配器测试 |
| `src/session/tool-adapter.ts` | 工具适配器 |
| `src/session/tool-adapter.test.ts` | 工具适配器测试 |
| `src/session/session-persistence.ts` | Session 持久化 |
| `src/session/session-persistence.test.ts` | 持久化测试 |
| `src/session/types.ts` | Session 类型定义 |
| `src/session/index.ts` | Session 模块导出 |

## @harness-kit/core

| 文件 | 职责 |
|------|------|
| `src/index.ts` | Extension entry — 注册工具、注入 workflow prompt、turn_end 自动验证 + telemetry |
| `src/index.test.ts` | Extension 测试 |
| `src/tools.ts` | 4 PI tools (start_agent, acp_send, acp_read, hard_verify) |
| `src/pane.ts` | tmux/bridge subprocess 调用 |
| `src/guardrails.ts` | Workspace 快照和越权文件检测 |
| `src/guardrails.test.ts` | Guardrails 测试 |
| `src/state.ts` | 状态管理 |
| `src/state.test.ts` | 状态管理测试 |
| `src/workflow-schema.ts` | TypeBox schemas for custom workflows |
| `src/workflow-schema.test.ts` | Schema 测试 |
| `src/workflow-loader.ts` | YAML 加载、验证、模板替换 |
| `src/workflow-loader.test.ts` | Loader 测试 |
| `src/workflow-executor.ts` | Phase 编排、fail-stop、dry-run |
| `src/workflow-executor.test.ts` | Executor 测试 |
| `src/code-executor.ts` | Shell command 和脚本执行 |
| `src/code-executor.test.ts` | Code executor 测试 |
| `src/workflow.ts` | 工作流核心逻辑 |
| `src/workflow.test.ts` | 工作流测试 |
| `src/telemetry.ts` | JSONL 事件记录 |
| `src/telemetry.test.ts` | 遥测测试 |
| `src/telemetry-cli.ts` | 遥测 CLI 工具 |
| `src/types.ts` | Core 类型定义 |

## @harness-kit/kimi-coder

| 文件 | 职责 |
|------|------|
| `extensions/` | Kimi 编码代理扩展 |

## 根目录

| 文件 | 职责 |
|------|------|
| `package.json` | 根配置，定义 monorepo scripts |
| `tsconfig.json` | 根 TypeScript 配置 |
| `.oxlintrc.json` | oxlint 配置 |
| `.oxfmtrc.json` | oxfmt 配置 |
| `wiki/` | 知识库 |
| `docs/` | 文档 |
