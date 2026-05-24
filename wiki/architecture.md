# Architecture

## Core Loop

```
PI Agent (orchestrator)
  │
  ├─ start_agent(role, executor) → create tmux pane, launch coding agent
  ├─ acp_send(target, task)      → send task with HK_RESULT template
  ├─ acp_read(target)            → poll until COMPLETE / MALFORMED / PENDING
  └─ hard_verify(facts)          → compare claimed text against disk
```

## Data Flow

```
User → PI Agent → [start_agent] → tmux pane (coding agent)
       PI Agent → [acp_send]    → pane receives task
       PI Agent → [acp_read]    → pane returns <HK_RESULT> JSON
       PI Agent → [hard_verify] → verify.ts reads files, compares text
       PI Agent → report to user (PASS/FAIL)
```

## Component Map

| Component | File | Responsibility |
|-----------|------|----------------|
| Extension entry | `src/index.ts` | Register tools, inject system prompt, init telemetry |
| Tool definitions | `src/tools.ts` | 4 PI tools with TypeBox schemas |
| Pane manager | `src/pane.ts` | tmux/bridge subprocess calls |
| Result parser | `src/result-block.ts` | Extract JSON from `<HK_RESULT>` blocks |
| Verifier | `src/verify.ts` | Read file, slice lines, compare text |
| Workflow | `src/workflow.ts` | Hardcoded 3-phase workflow |
| Telemetry | `src/telemetry.ts` | JSONL event recording |
| CLI | `src/cli.ts` | Standalone harness-verify |

## Key Invariant

`<HK_RESULT>` is the ONLY boundary between harness-kit and coding agents. No ANSI parsing, no output heuristics. If the agent doesn't produce this block, it's PENDING forever.
