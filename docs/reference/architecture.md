# 架构

## 核心理念

**Agent = Model + Harness**。模型负责"想"，harness 负责"管"。

harness-kit 拥有自己的 agent runtime，直接调用 LLM + middleware pipeline 管控一切。Claude Code 和 Codex 作为 subagent 通过 CLI 调度（`claude -p`、`codex`），harness 给足上下文、限定范围、让其只执行一件事。

## 系统分层

```
┌─────────────────────────────────────────────────┐
│                   用户层                         │
│  PI Agent / CLI REPL / Workflow YAML             │
├─────────────────────────────────────────────────┤
│                 编排层                            │
│  WorkflowExecutor / AgentLoop / Session          │
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
├─────────────────────────────────────────────────┤
│               基础设施                            │
│  Telemetry / State / Pane Manager                │
└─────────────────────────────────────────────────┘
```

## 执行模式

| 模式 | 入口 | 说明 |
|------|------|------|
| **Standalone CLI** | `harness-agent` CLI | 独立运行，不依赖 PI，middleware 全量生效 |
| **PI Extension** | `@harness-kit/core` | 在 PI 框架内运行，注入 workflow prompt、telemetry、sendUserMessage |

两种模式共享 `<HK_RESULT>` 作为唯一的 agent 输出边界。

## 数据流

### Standalone 模式

```
harness-agent CLI
  │
  ├─ session.start() → 创建 HarnessAgentSession
  ├─ session.prompt() → runAgentLoop
  │    ├─ beforeModel chain (IntentGate, etc.)
  │    ├─ LLM call → stream.result()
  │    ├─ afterModel chain (FactVerification, QualityGate)
  │    ├─ beforeTool chain (ToolCallGuardrail)
  │    ├─ tool execution
  │    └─ afterTool chain (ChangeTracker, VerificationGuidance)
  └─ agent_end → session complete
```

### PI Extension 模式

```
PI Agent (harness-kit extension)
  │
  ├─ before_agent_start → inject workflow system prompt
  ├─ LLM executes phase → outputs <HK_RESULT> block
  ├─ turn_end           → auto-verify facts against disk
  │                        FAIL → pi.sendUserMessage() injects error
  │                        PASS → continue to next phase
  └─ hard_verify (tool)  → LLM can also verify voluntarily
```

### 降级模式数据流

```
User → PI Agent → [system prompt injection] → LLM
       PI Agent ← [LLM outputs <HK_RESULT>]
       PI Agent → [turn_end auto-verify] → verifyFacts()
       PI Agent → [FAIL?] → pi.sendUserMessage(error) → LLM self-corrects
       PI Agent → [PASS?] → continue to next phase
       PI Agent → report to user
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

  - name: review
    executor: llm
    prompt: |
      基于以下结果：
      - lint: {{lint.output}}
```

**执行器类型：**

| 类型 | 说明 | 输出 |
|------|------|------|
| `llm` | LLM 执行，输出 `<HK_RESULT>` | LLM 文本输出 |
| `code` | 代码执行，确定性结果 | stdout/stderr |

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
| Telemetry | `src/telemetry.ts` | JSONL 事件记录 |
