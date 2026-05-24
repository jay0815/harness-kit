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

---

## Reference: take-root architecture patterns

take-root (`github-repo/take-root`) shares the same structural direction: CLI → phase orchestrator → runtime → agents. Key differences and borrowable patterns.

### Patterns worth adopting

| Pattern | take-root implementation | harness-kit gap | Priority |
|---------|------------------------|-----------------|----------|
| Artifact-driven state | `.take_root/state.json` + `reconcile_state_from_disk()` reconstructs state from disk artifacts, not memory | No state persistence; PI session中断则丢失所有进度 | P0 |
| Guardrails snapshot | `snapshot_workspace()` 做 SHA256 快照, `out_of_scope_changes()` 检测越权写入 | hard_verify 只验证声明的事实，不检测未声明的写入 | P1 |
| Convergence detection | round loop + frontmatter `status: "converged"` 检测 | 单轮执行，无多轮迭代 | P2 |
| Error hierarchy | 7 种异常类型映射不同 exit code | 错误处理分散在 tool return content 里 | P3 |
| Boot message contract | `format_boot_message()` 结构化上下文 + size guard (warn 8K, abort 32K) | system prompt append 式注入，无 size guard | P3 |

### Patterns not needed

| Pattern | Why |
|---------|-----|
| Persona markdown 系统 | harness-kit 走 PI Extension，persona 由 PI 管理 |
| subprocess runtime | tmux pane IPC 比 subprocess 更灵活（agent 保持活跃） |
| VCS round commits | PI session 内 workflow，不需要自建 git 管理 |

### Key architectural difference

take-root 的 state reconciliation 是核心韧性机制：`reconcile_state_from_disk()` 从 artifact 文件重建整个 workflow 状态。`state.json` 丢了没关系，只要 artifact 在就能恢复。malformed artifact 直接删除，防止脏状态传播。

harness-kit 应该借鉴这个思路：把 `<HK_RESULT>` 解析产物持久化到 `.harness-kit/` 目录，session 恢复时从磁盘重建进度。
