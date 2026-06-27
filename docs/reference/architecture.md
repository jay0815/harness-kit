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
| **PI Extension** | `@harness-kit/core` | 在 PI 框架内运行，注入 workflow prompt、telemetry、sendUserMessage |
| **WorkflowRunner** | `packages/core/src/workflow-runner.ts` | 编程式入口，支持 self/code/subagent executor |

三种模式共享 `<HK_RESULT>` 作为唯一的 agent 输出边界。

## PI Extension 集成

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
│  │  │  │  before_agent_start → inject workflow  │  │    │    │
│  │  │  │  turn_end → auto-verify <HK_RESULT>   │  │    │    │
│  │  │  │  session_shutdown → close telemetry    │  │    │    │
│  │  │  └───────────────────────────────────────┘  │    │    │
│  │  │  ┌───────────────────────────────────────┐  │    │    │
│  │  │  │  Registered Tools                      │  │    │    │
│  │  │  │  • hard_verify    • start_agent        │  │    │    │
│  │  │  │  • acp_send       • acp_read           │  │    │    │
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
User → PI TUI → [system prompt injection] → LLM
       PI TUI ← [LLM outputs <HK_RESULT>]
       PI TUI → [turn_end auto-verify] → verifyFacts()
       PI TUI → [FAIL?] → pi.sendUserMessage(error) → LLM self-corrects
       PI TUI → [PASS?] → continue to next phase
       PI TUI → report to user
```

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

`<HK_RESULT>` 是 harness-kit 与编码代理之间的**唯一边界**。不解析 ANSI，不使用输出启发式。如果 agent 不产生此块，状态永远是 PENDING。

边界在两个层级强制执行：
1. **Prompt 层** — system prompt 指示 LLM 输出 `<HK_RESULT>`
2. **Harness 层** — turn_end handler 自动校验事实

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
PI Extension 模式下，core 的 turn_end 钩子额外提供 telemetry emit 和 sendUserMessage。

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
- 仅信息性 — 不阻塞 phase 完成

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
| Extension entry | `src/index.ts` | 注册工具、注入 workflow prompt、turn_end 自动验证 + telemetry |
| Tool definitions | `src/tools.ts` | 4 PI tools (start_agent, acp_send, acp_read, hard_verify) |
| Pane manager | `src/pane.ts` | tmux/bridge subprocess 调用 |
| Guardrails | `src/guardrails.ts` | Workspace 快照和越权文件检测 |
| Workflow schema | `src/workflow-schema.ts` | TypeBox schemas for custom workflows |
| Workflow loader | `src/workflow-loader.ts` | YAML 加载、验证、模板替换 |
| Code executor | `src/code-executor.ts` | Shell command 和脚本执行 |
| Workflow executor | `src/workflow-executor.ts` | Phase 编排、fail-stop、dry-run |
| Workflow runner | `src/workflow-runner.ts` | 编程式入口，整合 session + extension + workflow |
| Telemetry | `src/telemetry.ts` | JSONL 事件记录 |
