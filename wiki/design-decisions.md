# Design Decisions

## 1. `<HK_RESULT>` as the only boundary

**Decision**: Agents must wrap output in `<HK_RESULT>` JSON blocks. No other output format accepted.

**Why**: ANSI parsing is fragile. Output heuristics are unreliable. A structured block is the only way to get machine-parseable data from a terminal-based agent.

**Trade-off**: Requires agent compliance. If the agent ignores the format, we get PENDING forever.

## 2. Hard verify = citation check, not correctness check

**Decision**: `verifyFacts` reads the file, slices the line range, compares exact text. It does NOT judge whether the agent's conclusions are correct.

**Why**: "Did the agent actually read this file?" is a binary, verifiable question. "Is the agent's analysis correct?" is subjective and hard to automate.

**Trade-off**: An agent can cite real text and still draw wrong conclusions. We accept this.

## 3. Fail-stop, no auto-retry

**Decision**: If hard_verify FAILs, the workflow stops. No automatic retry.

**Why**: Auto-retry can mask systematic problems. A human should see the failure and decide what to do.

**Trade-off**: More human intervention required. Acceptable for MVP.

## 4. Single executor + single validator

**Decision**: One executor agent per phase, one optional validator. No multi-agent chat.

**Why**: Multi-agent chat is complex and unproven for this use case. Start simple.

**Trade-off**: No real-time agent-to-agent collaboration. The validator is asynchronous.

## 5. tmux as the IPC layer

**Decision**: Use tmux panes + tmux-bridge for agent communication.

**Why**: Every coding agent runs in a terminal. tmux is the universal terminal multiplexer. It works with any agent that can run in a shell.

**Trade-off**: Requires tmux installation. Read guard adds complexity.
