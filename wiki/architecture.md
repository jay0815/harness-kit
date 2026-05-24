# Architecture

## 核心理念

**Agent = Model + Harness**。模型负责"想"，harness 负责"管"。

harness-kit 拥有自己的 agent runtime，直接调用 LLM + middleware pipeline 管控一切。Claude Code 和 Codex 作为 subagent 通过 CLI 调度（`claude -p`、`codex`），harness 给足上下文、限定范围、让其只执行一件事。

## 运行模式

| 模式 | 入口 | 说明 |
|------|------|------|
| **Standalone CLI**（主路径） | `harness-agent` CLI | 独立运行，不依赖 PI，middleware 全量生效 |
| **PI Extension**（可选） | `@harness-kit/core` | 在 PI 框架内运行时，注入 workflow prompt、telemetry、sendUserMessage |

## Core Loop (Standalone)

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

## Core Loop (PI Extension)

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

## Auto-Verify Mechanism

事实校验是 agent 的固定能力，通过 FactVerificationMiddleware 在 afterModel 钩子中自动执行：

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

This makes harness-kit **defensive by default** — it works even with LLMs that have low instruction compliance.

## Guardrails: Out-of-Scope Detection

harness-kit tracks file changes during each phase to detect undeclared modifications:

```
Phase start → snapshotWorkspace() → before snapshot
Phase end   → snapshotWorkspace() → after snapshot
            → detectOutOfScope(before, after, declaredFiles)
            → emit("guardrail", "out_of_scope", { files }) if any
```

**Purpose**: Catch when an LLM modifies files not declared in its `<HK_RESULT>` facts. This prevents "silent" changes that could break other parts of the codebase.

**Implementation**:
- `snapshotWorkspace()` — traverses workspace, skips `.git/`, `.harness-kit/`, `node_modules/`, records SHA256 hashes
- `detectOutOfScope()` — compares before/after snapshots, filters out declared files, returns undeclared changes
- Telemetry event `"guardrail:out_of_scope"` — lists files modified but not declared in facts

**Behavior**: Informational only — does not block phase completion. Logs undeclared changes for review.

## Custom Workflow Execution

harness-kit supports user-defined workflows via YAML configuration:

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
    
  - name: custom-check
    executor: code
    script: "./scripts/check.ts"
    args: ["--strict"]
    
  - name: review
    executor: llm
    prompt: |
      基于以下结果：
      - lint: {{lint.output}}
      - check: {{custom-check.output}}
```

**Executor Types:**

| Type | Description | Output |
|------|-------------|--------|
| `llm` | LLM 执行，输出 `<HK_RESULT>` | LLM 文本输出 |
| `code` | 代码执行，确定性结果 | stdout/stderr |

**Code Execution Modes:**

- `command`: Shell command（支持 pipes、redirects）
- `script`: 外部脚本（.ts/.js），必须 `export default async function`

**Key Features:**

- **Fail-stop**: 第一个 phase 失败即停止
- **Template substitution**: `{{phaseName.output}}` 引用前面 phase 的输出
- **Dry-run**: `executeWorkflow({ dryRun: true })` 只验证结构不执行
- **Inter-phase data flow**: 前序 phase 输出自动注入后续 phase context

## Data Flow (Degraded Mode)

```
User → PI Agent → [system prompt injection] → LLM
       PI Agent ← [LLM outputs <HK_RESULT>]
       PI Agent → [turn_end auto-verify] → verifyFacts()
       PI Agent → [FAIL?] → pi.sendUserMessage(error) → LLM self-corrects
       PI Agent → [PASS?] → continue to next phase
       PI Agent → report to user
```

## Component Map

### @harness-kit/agent（独立 agent runtime）

| Component | File | Responsibility |
|-----------|------|----------------|
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

| Component | File | Responsibility |
|-----------|------|----------------|
| Extension entry | `src/index.ts` | 注册工具、注入 workflow prompt、turn_end 自动验证 + telemetry |
| Tool definitions | `src/tools.ts` | 4 PI tools (start_agent, acp_send, acp_read, hard_verify) |
| Pane manager | `src/pane.ts` | tmux/bridge subprocess 调用 |
| Guardrails | `src/guardrails.ts` | Workspace 快照和越权文件检测 |
| Workflow schema | `src/workflow-schema.ts` | TypeBox schemas for custom workflows |
| Workflow loader | `src/workflow-loader.ts` | YAML 加载、验证、模板替换 |
| Code executor | `src/code-executor.ts` | Shell command 和脚本执行 |
| Workflow executor | `src/workflow-executor.ts` | Phase 编排、fail-stop、dry-run |
| Telemetry | `src/telemetry.ts` | JSONL 事件记录 |

## Key Invariant

`<HK_RESULT>` is the ONLY boundary between harness-kit and coding agents. No ANSI parsing, no output heuristics. If the agent doesn't produce this block, it's PENDING forever.

With auto-verify, even if the LLM produces a malformed or inaccurate `<HK_RESULT>`, the harness catches it and forces correction. The boundary is enforced at two levels:
1. **Prompt level** — system prompt instructs the LLM to output `<HK_RESULT>`
2. **Harness level** — turn_end handler verifies facts automatically
