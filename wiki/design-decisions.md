# Design Decisions

## 1. `<HK_RESULT>` as the only boundary

**Decision**: Agents must wrap output in `<HK_RESULT>` JSON blocks. No other output format accepted.

**Why**: ANSI parsing is fragile. Output heuristics are unreliable. A structured block is the only way to get machine-parseable data from a terminal-based agent.

**Trade-off**: Requires agent compliance. If the agent ignores the format, we get PENDING forever.

## 2. Hard verify = citation check, not correctness check

**Decision**: `verifyFacts` reads the file, slices the line range, compares exact text. It does NOT judge whether the agent's conclusions are correct.

**Why**: "Did the agent actually read this file?" is a binary, verifiable question. "Is the agent's analysis correct?" is subjective and hard to automate.

**Trade-off**: An agent can cite real text and still draw wrong conclusions. We accept this.

## 3. Auto-correct on failure (was: fail-stop)

**Decision**: If hard_verify FAILs, the harness injects error details into the conversation via `pi.sendUserMessage()`, giving the LLM a chance to self-correct. If the LLM still doesn't correct after injection, the workflow stops.

**Why**: Pure fail-stop requires human intervention for every error. Auto-correct handles the common case (LLM got a line number wrong) while still escalating to humans for persistent failures.

**Trade-off**: An LLM could get stuck in a correction loop. Telemetry tracks all verify attempts to detect this.

## 4. PI self-execution (degraded mode)

**Decision**: In degraded mode, PI itself executes all phases. The tmux pane tools (start_agent, acp_send, acp_read) are retained for full mode but unused.

**Why**: Eliminates tmux IPC complexity. PI + kimi-coder can handle most tasks. Multi-agent orchestration via tmux is reserved for complex tasks that need different LLMs per phase.

**Trade-off**: Single LLM for all phases. No specialization (e.g., one agent for design, another for implementation).

## 5. tmux IPC (optional, full mode only)

**Decision**: tmux-bridge is the IPC layer for full mode (driving external agents). Not required in degraded mode.

**Why**: Every coding agent runs in a terminal. tmux is the universal terminal multiplexer. But in degraded mode, PI is the agent, so no IPC is needed.

**Trade-off**: Full mode requires tmux installation. Read guard adds complexity.

## 6. Auto-verify by default

**Decision**: The `turn_end` handler automatically intercepts LLM output, extracts `<HK_RESULT>` blocks, and verifies facts against disk. The LLM does not need to call `hard_verify` — the harness does it.

**Why**: Different LLMs have different instruction compliance levels. A smart LLM might call `hard_verify` voluntarily; a less capable one might skip it. The harness should be defensive — verify by default, not by request.

**Trade-off**: Extra `verifyFacts` call on every turn that produces a `<HK_RESULT>`. Negligible cost (file reads + string comparison) compared to the safety benefit.

## 7. Guardrails: snapshot-based out-of-scope detection

**Decision**: Before each phase, take a SHA256 snapshot of the workspace. After the phase completes, take another snapshot and compare. Files modified but not declared in `<HK_RESULT>` facts are reported as "out-of-scope" via telemetry.

**Why**: Auto-verify checks declared facts, but doesn't catch undeclared changes. An LLM might modify files it didn't mention in its `<HK_RESULT>`. The guardrails snapshot catches these silent modifications.

**Trade-off**: Extra `snapshotWorkspace()` call on phase completion. Traverses the workspace directory tree, but skips `.git/`, `.harness-kit/`, `node_modules/`. Informational only — does not block phase completion.

## 8. Fact verification as core agent capability (not optional extension)

**Decision**: `verifyFacts` 和 `extractResultBlock` 从 `@harness-kit/core` 移入 `@harness-kit/agent`，作为 FactVerificationMiddleware 自动注册到 agent pipeline 中。任何运行模式（standalone CLI 或 PI Extension）都自动生效。`<HK_RESULT>` 缺失视为 verification failure，不是静默跳过。

**Why**: 事实校验是"agent 是否可信"的核心机制。放在 core 中意味着 standalone 模式没有校验，agent 可以编造文件引用。verify.ts、result-block.ts 是纯函数（零外部依赖），天然属于 agent 包。通过牺牲速度换取准确性。

**Trade-off**: core 的 turn_end 钩子仍会执行一次校验（用于 PI 特有的 telemetry 和 sendUserMessage）。两层校验有微量重复开销，但保证了 PI 模式下的 observability 不受影响。

## 9. Verification modes separate from extensions

**Decision**: `--verify strict|warn|off` 独立于 `--no-extension`。校验是核心能力，不是扩展的附庸。

**Why**: `--no-extension` 的语义是"不加载 PI Extension"，不应该同时关闭事实校验。如果用户想关闭校验，需要明确使用 `--verify off`。

**Trade-off**: 增加了一个 CLI 参数，但语义更清晰。

## 10. Verification retry budget independent of maxIterations

**Decision**: verification retry 有独立 budget（`maxVerificationRetries`），不从 `maxIterations` 中扣除。

**Why**: `maxIterations` 控制 agent loop 总轮数。如果工具调用轮次和校验修正轮次共享 budget，行为难以解释——agent 做了 8 次工具调用后，只剩 2 次校验修正机会。

**Trade-off**: 增加了一个配置项，但职责分离更清晰。

## 9. Custom workflow with dual executor types

**Decision**: Support user-defined workflows via YAML configuration with two executor types: `llm` and `code`. Code executor supports both shell commands and external scripts. Inter-phase data flow via `{{phaseName.output}}` template substitution.

**Why**: Hardcoded 3-phase workflow (design → implement → test) is too rigid. Users need to define custom workflows with deterministic steps (lint, test, build) alongside LLM phases. Code execution provides hard guarantees that LLM cannot.

**Trade-off**: Added complexity in workflow loader and executor. YAML schema validation via TypeBox prevents malformed workflows. Dry-run mode enables testing without execution.

---

## Reference: take-root architecture patterns

take-root (`github-repo/take-root`) shares the same structural direction: CLI → phase orchestrator → runtime → agents. Key differences and borrowable patterns.

### Patterns worth adopting

| Pattern | take-root implementation | harness-kit gap | Priority |
|---------|------------------------|-----------------|----------|
| Artifact-driven state | `.take_root/state.json` + `reconcile_state_from_disk()` reconstructs state from disk artifacts, not memory | ✅ 已实现：state.ts + reconcileFromDisk() | P0 ✓ |
| Guardrails snapshot | `snapshot_workspace()` 做 SHA256 快照, `out_of_scope_changes()` 检测越权写入 | ✅ 已实现：guardrails.ts + detectOutOfScope() | P1 ✓ |
| Convergence detection | round loop + frontmatter `status: "converged"` 检测 | 单轮执行，无多轮迭代（类似 CC/Codex goals 模式） | P2 |
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

harness-kit 已实现：
- **P0 状态持久化**：state.ts + reconcileFromDisk()，从 artifact 重建进度
- **P1 Guardrails 快照**：guardrails.ts + detectOutOfScope()，检测越权写入
- **Auto-verify**：turn_end 自动拦截验证，不依赖 LLM 自觉

下一步：P2 多轮迭代 + 收敛检测（goals 模式）

## 11. ToolCall `input` vs `arguments` 运行时不一致

**Decision**: PI SDK 的 `ToolCall` 类型只有 `arguments: Record<string, any>`，没有 `input` 字段。`bridgeContentBlocks`（处理 SDK 内部 assistant message content）已改为直接用 `block.arguments`。Tool 执行层（`tool-utils.ts`、`agent-loop.ts`）保留 `input ?? arguments` 防御逻辑。

**Why**: 两处处理的数据来源不同：

| 位置 | 数据来源 | 是否需要防御 |
|------|----------|-------------|
| `bridgeContentBlocks` (event-bridge.ts) | PI SDK 内部流转的 assistant message | 不需要，SDK 保证 `ToolCall.arguments` |
| `extractToolArgs` (tool-utils.ts:9) | LLM 响应解析后的 toolCall content block | 需要，部分 provider 运行时返回 `input` |
| content block 映射 (agent-loop.ts:278) | 同上 | 需要，同上 |

**Trade-off**: `bridgeContentBlocks` 的类型精确化消除了 `Record<string, unknown>` 断言，但 tool 执行层的防御逻辑作为独立技术债保留。

**消除条件**: 上游 PI SDK 在 `ToolCall` 上补 `input?: Record<string, any>`，或本地改为统一类型守卫函数处理 `input`/`arguments` 映射。
