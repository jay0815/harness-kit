# 调试

## 快速诊断清单

1. **检查构建产物**：`pnpm run build` 后确认 `dist/` 目录存在
2. **检查类型**：`pnpm run typecheck` 确认无类型错误
3. **检查 lint**：`pnpm run lint` 确认无 lint 错误
4. **运行测试**：`pnpm run test` 确认测试通过

## 常见调试场景

### Agent 卡在 PENDING 状态

**症状**：agent 运行但不产出结果，状态一直是 PENDING。

**原因**：
- 当前兼容路径：LLM 没有输出 `<HK_RESULT>` 块。
- 目标 scheduler path：LLM 没有调用 `complete_phase`，或者 `complete_phase` 拒绝了当前 phase completion。

**排查**：
- 检查 LLM 输出中是否包含 `<HK_RESULT>` 标签
- 检查是否出现 `complete_phase` 工具调用
- 检查 `.harness-kit/state.json` 中的 `currentPhase`
- 检查 system prompt 是否正确注入
- 尝试切换到更 capable 的模型

### 校验持续失败

**症状**：agent 反复输出 `<HK_RESULT>` 但校验一直 FAIL。

**原因**：
- LLM 编造了不存在的文件引用
- LLM 的行号/内容与实际文件不匹配

**排查**：
- 使用 `--verify warn` 模式查看失败详情
- 检查 `state.metadata["fact_verification"]` 中的校验结果
- scheduler path 下检查 `complete_phase` 的 tool result
- 确认 agent 引用的文件确实存在

### 工具调用参数为空

**症状**：工具执行时报参数缺失。

**原因**：不同 provider 的 toolCall 格式不一致（`input` vs `arguments`）。

**排查**：
- 检查 `tool-utils.ts` 中的 `extractToolArgs` 函数
- 确认 provider 返回的是 `input` 还是 `arguments` 字段

### PI Extension 未加载

**症状**：在 PI 中运行但 harness-kit 功能不生效。

**排查**：
- 确认 `--no-extension` 未设置
- 检查 PI 的 extension 加载日志
- 确认 `@harness-kit/core` 已正确构建

## 调试工具

### 遥测事件

遥测事件写入 JSONL 文件，包含：
- 校验结果
- Guardrail 检测结果
- Phase 转换和 scheduler 决策
- 工具调用

### 测试

```bash
pnpm run test             # 运行所有测试
pnpm run test:e2e         # E2E 测试（需要 tmux）
```

单个包的测试：
```bash
cd packages/harness-agent && pnpm run test
cd packages/core && pnpm run test
```

### 类型检查

```bash
pnpm run typecheck        # 全量类型检查
```

## 日志

Standalone 模式下，输出到 stdout/stderr。PI Extension 模式下，通过 PI 的日志系统。
