# Architecture

## Operating Modes

harness-kit supports two modes, selected by workflow configuration:

| Mode | Executor | LLM | IPC | Use case |
|------|----------|-----|-----|----------|
| **Degraded** (current) | PI itself | kimi-coder / any PI provider | None (in-process) | Single-agent, simple tasks |
| **Full** (future) | External agent (claude-code, codex) | Agent's own LLM | tmux-bridge | Multi-agent, complex tasks |

In degraded mode, PI is both the runtime and the coding agent. harness-kit injects workflow instructions into the system prompt and verifies output automatically.

## Core Loop (Degraded Mode)

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

## Core Loop (Full Mode)

```
PI Agent (orchestrator)
  │
  ├─ start_agent(role, executor) → create tmux pane, launch coding agent
  ├─ acp_send(target, task)      → send task with HK_RESULT template
  ├─ acp_read(target)            → poll until COMPLETE / MALFORMED / PENDING
  └─ hard_verify(facts)          → compare claimed text against disk
```

## Auto-Verify Mechanism

The `turn_end` handler provides harness-level verification that does not depend on the LLM calling `hard_verify`:

```
LLM output → turn_end event
  ├── Extract text content from AssistantMessage
  ├── extractResultBlock() → parse <HK_RESULT> JSON
  ├── verifyFacts() → check each fact against disk
  ├── emit("auto_verify", ...) → telemetry
  └── FAIL → pi.sendUserMessage("[harness-kit auto-verify] FAIL: ...")
              LLM sees error, self-corrects, outputs corrected <HK_RESULT>
```

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

| Component | File | Responsibility |
|-----------|------|----------------|
| Extension entry | `src/index.ts` | Register tools, inject system prompt, auto-verify on turn_end, init telemetry, guardrails integration |
| Tool definitions | `src/tools.ts` | 4 PI tools (start_agent, acp_send, acp_read, hard_verify) |
| Pane manager | `src/pane.ts` | tmux/bridge subprocess calls (full mode only) |
| Result parser | `src/result-block.ts` | Extract JSON from `<HK_RESULT>` blocks |
| Verifier | `src/verify.ts` | Read file, slice lines, compare text |
| Guardrails | `src/guardrails.ts` | Workspace snapshot and out-of-scope file detection |
| Workflow (legacy) | `src/workflow.ts` | Hardcoded 3-phase workflow (design → implement → test) |
| Workflow schema | `src/workflow-schema.ts` | TypeBox schemas for custom workflows |
| Workflow loader | `src/workflow-loader.ts` | YAML loading, validation, template substitution |
| Code executor | `src/code-executor.ts` | Shell command and script execution |
| Workflow executor | `src/workflow-executor.ts` | Phase orchestration, fail-stop, dry-run |
| Telemetry | `src/telemetry.ts` | JSONL event recording |
| CLI | `src/cli.ts` | Standalone harness-verify |

## Key Invariant

`<HK_RESULT>` is the ONLY boundary between harness-kit and coding agents. No ANSI parsing, no output heuristics. If the agent doesn't produce this block, it's PENDING forever.

With auto-verify, even if the LLM produces a malformed or inaccurate `<HK_RESULT>`, the harness catches it and forces correction. The boundary is enforced at two levels:
1. **Prompt level** — system prompt instructs the LLM to output `<HK_RESULT>`
2. **Harness level** — turn_end handler verifies facts automatically
