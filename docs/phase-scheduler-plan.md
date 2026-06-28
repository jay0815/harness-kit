# Phase Scheduler Plan

## 目标

PI Extension 模式下，PI 继续负责模型调用、消息历史、tool calling 和 UI；harness-kit 负责 workflow 控制面：

- 当前 phase 的单一事实源
- phase 完成申请、校验、失败反馈和重试
- human confirmation gate
- artifact/state 持久化和恢复
- telemetry 和 guardrail 事件

目标是把 PI Extension 从 prompt-driven workflow 改成 scheduler-driven workflow。模型可以执行当前 phase，但不能自行宣布进入下一 phase。

## 目标形态

```
PI agent loop
  -> LLM works on current phase
  -> LLM calls complete_phase({ phaseName, result })
  -> harness scheduler validates phaseName == currentPhase
  -> verifyFacts(result.facts)
  -> detectOutOfScope(beforeSnapshot, afterSnapshot, declaredFiles)
  -> persist artifact and state atomically
  -> return next phase instruction, human gate, or workflow complete
```

`<HK_RESULT>` 仍然是 agent 和 harness 之间的数据契约，但 phase 推进由 `complete_phase` 工具门控，不再依赖自然语言输出后由 `turn_end` 猜测完成状态。

`turn_end` 会保留为 telemetry 和 legacy fallback，直到 scheduler path 覆盖所有使用场景。

## 状态机

```
idle
  -> running_phase
  -> verifying_phase
  -> awaiting_human
  -> phase_completed
  -> workflow_completed

任意状态
  -> phase_failed_retryable
  -> failed
  -> aborted
```

状态落盘到 `.harness-kit/state.json`。重启后以磁盘状态为准恢复 current phase 和已完成 artifact。

## 迭代计划

### Iteration 0: 文档和契约

目标：明确目标架构、非目标和分阶段验收标准。

可验证结果：
- README 和 docs 说明 PI Extension 的目标是 phase scheduler/state machine。
- 架构文档区分 scheduler path 和 legacy `turn_end` fallback。
- 本计划文档列出每个后续迭代的验收目标。

### Iteration 1: Scheduler Core

目标：抽出不依赖 PI 的 phase scheduler 核心，集中处理 phase 状态转换。

范围：
- 新增 scheduler helper 或 class，输入 workflow、state、workspace snapshot。
- 支持 `startCurrentPhase`、`submitPhaseResult`、`failCurrentPhase`、`resumeFromDisk`。
- 保持现有 `state.ts` 原子保存语义。

可验证结果：
- 单元测试覆盖 phase 顺序、错误 phase 拒绝、完成推进、workflow complete。
- 单元测试覆盖 saveState 失败时内存状态回滚。
- 不改变 PI Extension 运行行为。

### Iteration 2: `complete_phase` 工具

目标：新增 PI tool-gated phase completion。

范围：
- 注册 `complete_phase` tool。
- 参数包含当前 phase 名称和 ResultBlock。
- 工具内部执行 schema 校验、fact verification、guardrail 检测、artifact/state 保存。
- 工具返回下一 phase 指令、human confirmation 提示或 workflow complete。

可验证结果：
- `complete_phase` 正确推进 phase 并保存 artifact。
- 错误 phase name 被拒绝，currentPhase 不变化。
- facts 校验失败时返回失败详情，currentPhase 不变化。
- out-of-scope 文件变更会阻止或标记 phase 失败，行为由测试固定。
- 保存失败时不跳 phase。

### Iteration 3: Prompt Injection 改造

目标：让 PI agent 只执行当前 phase，并通过 `complete_phase` 申请完成。

范围：
- `before_agent_start` 只注入 scheduler 规则、当前 phase、已完成 phase 摘要。
- 移除“自己按所有 phase 顺序继续”的开放式提示。
- 明确禁止模型自然语言宣布 phase 完成。

可验证结果：
- prompt 包含 current phase，不要求模型自行选择下一 phase。
- prompt 明确要求调用 `complete_phase`。
- recovery prompt 从 `.harness-kit/state.json` 恢复当前 phase。

### Iteration 4: `turn_end` 降级为 fallback

目标：避免 tool-gated path 和 legacy auto-advance 双重推进。

范围：
- `turn_end` 保留 telemetry、HK_RESULT 解析和 legacy fallback。
- 如果当前 turn 已通过 `complete_phase` 处理，`turn_end` 不再推进 phase。
- metadata path 只作为兼容路径，不作为推荐完成入口。

可验证结果：
- 同一 phase 不能因 `complete_phase` + `turn_end` 被推进两次。
- legacy `<HK_RESULT>` 输出仍可被校验并给出反馈。
- telemetry 中能区分 `source: "complete_phase"` 和 `source: "turn_end_fallback"`。

### Iteration 5: Human Confirmation Gate

目标：把 `humanConfirm` 从提示词变成 scheduler 状态。

范围：
- 带 `humanConfirm` 的 phase 完成后，scheduler 进入 `awaiting_human`。
- 用户确认后再 dispatch 下一 phase。
- 用户拒绝或修改指令时保持状态可恢复。

可验证结果：
- `humanConfirm: true` 不会自动进入下一 phase。
- 确认后才发送下一 phase 指令。
- 重启后仍处于 awaiting human 状态。

### Iteration 6: E2E 和清理

目标：收敛 legacy 行为和文档，完成端到端验证。

范围：
- 增加 PI Extension 或 mock ExtensionAPI E2E。
- 更新 debugging/troubleshooting 文档。
- 根据覆盖率决定是否移除旧的 prompt-driven auto-advance。

可验证结果：
- 一个三阶段 workflow 可通过 `complete_phase` 完整跑完。
- verify fail 会要求当前 phase 修正，不会跳 phase。
- session 重启后从正确 phase 恢复。

## 非目标

- 不重写 PI agent loop。
- 不在第一阶段接管每一个 PI tool call 的权限判断。
- 不把 scheduler 做成通用多 agent framework。
- 不取消 standalone CLI 的 middleware pipeline。

## 设计原则

- harness 管 phase，PI 管 turn/tool loop。
- phase 推进必须由 harness 决定。
- 磁盘状态是恢复时的单一事实源。
- 失败反馈统一回到当前 phase，不隐式进入下一 phase。
- legacy `turn_end` fallback 只用于兼容和观测，目标路径是 `complete_phase`。
