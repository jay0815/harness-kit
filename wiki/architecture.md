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
| Extension entry | `src/index.ts` | Register tools, inject system prompt, auto-verify on turn_end, init telemetry |
| Tool definitions | `src/tools.ts` | 4 PI tools (start_agent, acp_send, acp_read, hard_verify) |
| Pane manager | `src/pane.ts` | tmux/bridge subprocess calls (full mode only) |
| Result parser | `src/result-block.ts` | Extract JSON from `<HK_RESULT>` blocks |
| Verifier | `src/verify.ts` | Read file, slice lines, compare text |
| Workflow | `src/workflow.ts` | Hardcoded 3-phase workflow (design → implement → test) |
| Telemetry | `src/telemetry.ts` | JSONL event recording |
| CLI | `src/cli.ts` | Standalone harness-verify |

## Key Invariant

`<HK_RESULT>` is the ONLY boundary between harness-kit and coding agents. No ANSI parsing, no output heuristics. If the agent doesn't produce this block, it's PENDING forever.

With auto-verify, even if the LLM produces a malformed or inaccurate `<HK_RESULT>`, the harness catches it and forces correction. The boundary is enforced at two levels:
1. **Prompt level** — system prompt instructs the LLM to output `<HK_RESULT>`
2. **Harness level** — turn_end handler verifies facts automatically
