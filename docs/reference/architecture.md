# 架构

## 核心理念

**Agent = Model + Harness**。模型负责"想"，harness 负责"管"。

harness-kit 拥有自己的 agent runtime，直接调用 LLM + middleware pipeline 管控一切。Claude Code 和 Codex 作为 subagent 通过 CLI 调度（`claude -p`、`codex`），harness 给足上下文、限定范围、让其只执行一件事。

## 系统分层

```
┌─────────────────────────────────────────────────┐
│                   用户层                         │
│  PI TUI / CLI REPL / Workflow YAML               │
├─────────────────────────────────────────────────┤
│                 编排层                            │
│  WorkflowRunner / AgentLoop / Session            │
├─────────────────────────────────────────────────┤
│                管道层                             │
│  Middleware Pipeline (beforeModel/afterModel/    │
│  beforeTool/afterTool)                           │
├─────────────────────────────────────────────────┤
│                校验层                             │
│  FactVerification / ChangeTracker / Guardrails   │
├─────────────────────────────────────────────────┤
│                工具层                             │
│  Tool Execution / Result Parser / Verifier       │
│  SubagentRunner / Pane Manager                   │
├─────────────────────────────────────────────────┤
│               基础设施                            │
│  Telemetry / State / Error Recovery / Compaction │
└─────────────────────────────────────────────────┘
```

## 执行模式

| 模式 | 入口 | 说明 |
|------|------|------|
| **Standalone CLI** | `harness-agent` CLI | 独立运行，不依赖 PI，middleware 全量生效 |
| **PI Extension** | `@harness-kit/core` | 在 PI 框架内运行，目标是 scheduler-driven phase control；保留 telemetry、sendUserMessage 和 legacy fallback |
| **WorkflowRunner** | `packages/core/src/workflow-runner.ts` | 编程式入口，支持 self/code/subagent executor |

三种模式共享 `<HK_RESULT>` / ResultBlock 作为 agent 和 harness 之间的数据边界。

## PI Extension 集成

PI Extension 不替换 PI agent loop。PI 继续负责模型调用、消息历史、tool calling 和 UI；harness-kit 作为控制面负责 phase 边界、校验、状态推进、人工确认和持久化。

当前实现已注册 `complete_phase` / `confirm_phase` 并注入 current-phase scheduler prompt；`turn_end` 自动校验仍作为 legacy fallback 保留。目标形态是 tool-gated scheduler：模型完成当前 phase 后调用 `complete_phase`，由 harness-kit 决定是否推进、等待人工确认或结束 workflow。

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        PI TUI                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 PI Agent Loop                        │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │         harness-kit Extension                │    │    │
│  │  │  ┌───────────────────────────────────────┐  │    │    │
│  │  │  │  session_start → init telemetry/state  │  │    │    │
│  │  │  │  before_agent_start → inject current   │  │    │    │
│  │  │  │  phase instruction                     │  │    │    │
│  │  │  │  complete_phase → verify + schedule    │  │    │    │
│  │  │  │  confirm_phase  → clear human gate     │  │    │    │
│  │  │  │  turn_end → telemetry + fallback       │  │    │    │
│  │  │  │  session_shutdown → close telemetry    │  │    │    │
│  │  │  └───────────────────────────────────────┘  │    │    │
│  │  │  ┌───────────────────────────────────────┐  │    │    │
│  │  │  │  Registered Tools                      │  │    │    │
│  │  │  │  • complete_phase • confirm_phase      │  │    │    │
│  │  │  │  • hard_verify    • start_agent        │  │    │    │
│  │  │  │  • acp_send      • acp_read            │  │    │    │
│  │  │  └───────────────────────────────────────┘  │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│   Xiaomi Mimo API   │
│  (anthropic compat) │
└─────────────────────┘
```

### 数据流

```
User → PI TUI → [current phase instruction] → LLM
       PI TUI ← [LLM calls complete_phase(result)]
       harness scheduler → verifyFacts() + guardrails
       FAIL → tool result / sendUserMessage feedback → same phase
       PASS → save artifact/state → next phase / human gate / complete
       Human gate → confirm_phase(user-approved phase) → next phase / complete
       turn_end → telemetry + legacy fallback only
```

### Phase Scheduler

目标 scheduler 是一个小型状态机，不接管 PI 的每次思考和工具选择：

```
idle
  -> running_phase
  -> verifying_phase
  -> awaiting_human
  -> phase_completed
  -> workflow_completed

任意状态
  -> phase_failed_retryable
  -> failed
  -> aborted
```

核心规则：

- PI agent 可以执行当前 phase，但不能自行推进 phase。
- phase 完成必须通过 `complete_phase` 提交结构化 ResultBlock。
- scheduler 校验 phase 名称、facts、guardrails，再原子保存 artifact/state。
- 带 `humanConfirm` 的 phase 完成后进入 `awaiting_human`，必须由 `confirm_phase` 清除 gate 后才能继续。
- 校验失败停留在当前 phase，并把失败详情反馈给模型。
- `turn_end` 保留为 telemetry 和 legacy fallback，避免旧用法立即失效。

### 启动命令

```bash
pi --provider xiaomi --model mimo-v2.5-pro --extension packages/core/dist/index.js
```

### 配置

**~/.pi/agent/auth.json** — API key：
```json
{
  "xiaomi": { "type": "api_key", "key": "your-token-plan-key" }
}
```

**~/.pi/agent/models.json** — 端点覆盖（中国区）：
```json
{
  "providers": {
    "xiaomi": {
      "baseUrl": "https://token-plan-cn.xiaomimimo.com/anthropic"
    }
  }
}
```

## Standalone 模式数据流

```
harness-agent CLI
  │
  ├─ session.start() → 创建 HarnessAgentSession
  ├─ session.prompt() → runAgentLoop
  │    ├─ beforeModel chain (IntentGate, Compaction, etc.)
  │    ├─ LLM call → stream.result()
  │    ├─ afterModel chain (FactVerification, QualityGate)
  │    ├─ beforeTool chain (ToolCallGuardrail, ErrorRecovery)
  │    ├─ tool execution
  │    └─ afterTool chain (ChangeTracker, VerificationGuidance)
  └─ agent_end → session complete
```

## Subagent 调度

### 架构图

```
┌─────────────────────────────────────────────────────┐
│                  主 Agent (harness)                   │
│  ┌─────────────────────────────────────────────┐    │
│  │  spawn_subagent tool                         │    │
│  │  ├─ 构建 system prompt                       │    │
│  │  ├─ 启动子进程                                │    │
│  │  │   claude -p --settings ... "task"         │    │
│  │  │   codex exec "task"                       │    │
│  │  └─ 返回 subagent ID                         │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │  collect_result tool                         │    │
│  │  ├─ 读取 {os.tmpdir()}/hk-result-{id}.json  │    │
│  │  ├─ 验证 schema                              │    │
│  │  └─ 返回结构化 ResultBlock                    │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│  claude -p      │         │  codex exec     │
│  (subagent)     │         │  (subagent)     │
│                 │         │                 │
│  写入结果文件    │         │  写入结果文件    │
│  /tmp/hk-*.json │         │  /tmp/hk-*.json │
└─────────────────┘         └─────────────────┘
```

### 结果文件协议

Subagent 完成任务后写入 `{os.tmpdir()}/hk-result-{id}.json`：

```json
{
  "summary": "任务完成摘要",
  "currentWork": "当前完成的工作",
  "facts": [
    {
      "file": "relative/path.ts",
      "startLine": 10,
      "endLine": 20,
      "exactText": "exact text from file"
    }
  ],
  "reasoning": "可选的推理过程"
}
```

## 核心不变量

### `<HK_RESULT>` 边界

`<HK_RESULT>` 是 harness-kit 与编码代理之间的数据边界。目标 scheduler path 中，ResultBlock 通过 `complete_phase` 工具提交；legacy path 仍可在 `turn_end` 中从自然语言输出提取 `<HK_RESULT>`。

边界在两个层级强制执行：
1. **Tool 层** — `complete_phase` 是 phase 推进的唯一推荐入口
2. **Harness 层** — scheduler 校验事实、guardrails 和状态转换
3. **Fallback 层** — `turn_end` handler 保留自动校验和兼容反馈

### 自动校验机制

事实校验是 agent 的固定能力，通过 `FactVerificationMiddleware` 在 `afterModel` 钩子中自动执行：

```
LLM response → afterModel hook (FactVerificationMiddleware, priority 90)
  ├── Extract text content from response
  ├── extractResultBlock() → parse <HK_RESULT> JSON
  ├── verifyFacts() → check each fact against disk
  ├── Store result in state.metadata["fact_verification"]
  ├── Update ChangeTracker (verifiedGen / lastVerifyOk)
  └── FAIL → Inject user message with failure details
              LLM sees error in next turn, self-corrects
```

Standalone 模式下，FactVerificationMiddleware 自动注册，无需手动调用。
PI Extension 目标模式下，`complete_phase` 承担主校验和推进职责；core 的 `turn_end` 钩子保留 telemetry emit、sendUserMessage 和 legacy fallback。

### Guardrails：越权检测

harness-kit 在每个 phase 期间追踪文件变更，检测未声明的修改：

```
Phase start → snapshotWorkspace() → before snapshot
Phase end   → snapshotWorkspace() → after snapshot
            → detectOutOfScope(before, after, declaredFiles)
            → emit("guardrail", "out_of_scope", { files }) if any
```

- `snapshotWorkspace()` — 遍历 workspace，跳过 `.git/`、`.harness-kit/`、`node_modules/`，记录 SHA256 哈希
- `detectOutOfScope()` — 比较快照，过滤已声明文件，返回未声明变更
- 当前兼容路径中主要用于 telemetry；scheduler path 中应成为 phase 完成门禁的一部分

### Error Recovery

结构化错误分类 + 恢复策略：

```
Tool error → classifyError() → ErrorType
           → decideRecovery() → RecoveryAction
           → RETRY_SAME / SWITCH_TOOL / WAIT_AND_RETRY / ABORT
```

| 错误类型 | 首次 | 持续 | 极端 |
|----------|------|------|------|
| TOOL_ERROR | RETRY_SAME | SWITCH_TOOL | 黑名单 |
| TIMEOUT | WAIT_AND_RETRY | 指数退避 | — |
| RESOURCE_EXHAUSTED | WAIT_AND_RETRY | 长退避 | — |
| PERMISSION_DENIED | ABORT | — | — |
| PARSE_ERROR | REDUCE_SCOPE | — | — |
| UNKNOWN | RETRY_SAME | SWITCH_TOOL | ABORT(5次) |

### Compaction

动态上下文组装，当 token 使用量达到 75% 时触发：

```
Token usage >= 75% → CompactionMiddleware.beforeModel
  ├── 保留最近 N 轮消息
  ├── 移除旧消息
  ├── 注入压缩摘要
  └── 异步生成 wiki（后台 LLM 调用）
```

- `ContextEngine` 抽象类 — 可插拔的 compaction 策略
- `WikiContextEngine` — 默认实现，wiki 双重角色（静态背景 + 动态记忆源）
- `searchMemory` 工具 — LLM 可按需检索历史记忆

## 自定义工作流

支持通过 YAML 配置定义工作流：

```yaml
workflow: code-review
description: "代码审查流程"
phases:
  - name: analyze
    executor: llm
    prompt: "分析代码架构"

  - name: lint
    executor: code
    command: "pnpm run lint"

  - name: subagent-review
    executor: subagent
    subagentType: claude
    subagentSettings: /path/to/settings.json
    prompt: "审查代码质量"
    subagentConstraints:
      - "只读取，不修改"
```

**执行器类型：**

| 类型 | 说明 | 输出 |
|------|------|------|
| `self` | LLM 执行，输出 `<HK_RESULT>` | LLM 文本输出 |
| `code` | 代码执行，确定性结果 | stdout/stderr |
| `subagent` | 外部代理执行（claude/codex/script） | JSON 结果文件 |

**特性：**
- **Fail-stop** — 第一个 phase 失败即停止
- **模板替换** — `{{phaseName.output}}` 引用前面 phase 的输出
- **Dry-run** — `executeWorkflow({ dryRun: true })` 只验证结构不执行
- **Phase 间数据流** — 前序 phase 输出自动注入后续 phase context

## 组件地图

### @harness-kit/agent（独立 agent runtime）

| 组件 | 文件 | 职责 |
|------|------|------|
| Agent loop | `core/agent-loop.ts` | 多轮 LLM 调用 + 工具执行循环，集成 middleware pipeline |
| Middleware pipeline | `core/middleware.ts` | priority-sorted middleware chain，4 个 hook 点 |
| ChangeTracker | `core/change-tracker.ts` | 追踪 codeGen/verifiedGen，single-writer 原则 |
| FactVerification | `core/fact-verification.ts` | afterModel 钩子，自动校验 `<HK_RESULT>` 中的事实声明 |
| Result parser | `core/result-block.ts` | 从 `<HK_RESULT>` 块提取 JSON |
| Verifier | `core/verify.ts` | 读取文件、切片行号、逐字比对 |
| Middlewares | `core/middlewares.ts` | VerificationGuidance, ToolCallGuardrail, QualityGate, IntentGate |
| Error Recovery | `core/error-recovery/` | 错误分类 + 恢复策略 + 指数退避 |
| Compaction | `core/compaction/` | ContextEngine, WikiContextEngine, WikiGenerator |
| Subagent | `core/subagent/` | SubagentRunner, 文件协议, spawn/collect 工具 |
| Session | `session/harness-session.ts` | HarnessAgentSession 封装完整生命周期 |
| Event bridge | `session/event-bridge.ts` | PI 风格事件桥接 |
| CLI entry | `cli.ts` | 独立 CLI 入口 |
| CLI args | `cli/args.ts` | 参数解析 |
| CLI config | `cli/config.ts` | 配置解析 + streamFn 创建 |
| CLI REPL | `cli/repl.ts` | 交互式 prompt loop |
| CLI output | `cli/output.ts` | 终端输出格式化 |

### @harness-kit/core（可选 PI Extension）

| 组件 | 文件 | 职责 |
|------|------|------|
| Extension entry | `src/index.ts` | 注册工具、注入 current-phase scheduler prompt、turn_end fallback + telemetry |
| Tool definitions | `src/tools.ts`, `src/phase-tool.ts` | PI tools: complete_phase, start_agent, acp_send, acp_read, hard_verify |
| Pane manager | `src/pane.ts` | tmux/bridge subprocess 调用 |
| Guardrails | `src/guardrails.ts` | Workspace 快照和越权文件检测 |
| Phase scheduler | `src/phase-scheduler.ts` | Scheduler core，管理 currentPhase、phase completion 和恢复 |
| Workflow schema | `src/workflow-schema.ts` | TypeBox schemas for custom workflows |
| Workflow loader | `src/workflow-loader.ts` | YAML 加载、验证、模板替换 |
| Code executor | `src/code-executor.ts` | Shell command 和脚本执行 |
| Workflow executor | `src/workflow-executor.ts` | Phase 编排、fail-stop、dry-run |
| Workflow runner | `src/workflow-runner.ts` | 编程式入口，整合 session + extension + workflow |
| Telemetry | `src/telemetry.ts` | JSONL 事件记录 |
