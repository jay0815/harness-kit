# AGENTS.md — harness-kit

## What is this

harness-kit is a PI Extension that orchestrates coding agents through structured workflows with hard fact verification.

## Quick Start

```bash
pnpm install
pnpm run build
# Load as PI extension:
pi --extension ./dist/index.js
```

## Architecture

```
PI Agent (harness-kit extension)
  ├── start_agent  → create tmux pane + launch coding agent
  ├── acp_send     → send task to agent pane
  ├── acp_read     → read <HK_RESULT> block from pane
  └── hard_verify  → check facts against disk
```

## Key Files

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Extension entry, system prompt injection |
| `src/tools.ts` | 4 PI tool definitions |
| `src/pane.ts` | Tmux pane lifecycle |
| `src/result-block.ts` | Parse `<HK_RESULT>` JSON blocks |
| `src/verify.ts` | Hard fact verification |
| `src/workflow.ts` | Hardcoded 3-phase workflow |
| `src/cli.ts` | Standalone `harness-verify` CLI |
| `src/telemetry.ts` | JSONL event recording |
| `src/telemetry-cli.ts` | Telemetry analysis CLI |

## Agent Output Contract

Coding agents driven by harness-kit MUST output results in this exact format:

```
<HK_RESULT>
{
  "currentWork": "description of what was done",
  "facts": [
    {
      "file": "relative/path.ts",
      "startLine": 1,
      "endLine": 5,
      "exactText": "exact text as it appears in the file"
    }
  ],
  "reasoning": "optional notes"
}
</HK_RESULT>
```

## Testing

```bash
pnpm run test          # vitest unit tests
pnpm run test:watch    # vitest watch mode
pnpm run lint          # oxlint
pnpm run typecheck     # tsc --noEmit
pnpm run test:e2e      # E2E (requires tmux)
```

## Design Decisions

- **MVP is intentionally narrow**: one executor + one validator, 3 phases, no auto-retry
- **Result blocks are the only boundary**: no ANSI parsing, no output heuristics
- **Hard verify checks citations only**: it confirms the agent read what it claims, not that conclusions are correct
- **Failure stops the workflow**: no auto-recovery in MVP
