# Subagent 调度设计（待定）

## 目标

让 harness-kit 能调度外部编码代理（`claude -p`、`codex`）作为 subagent 执行任务。harness 负责"给足上下文、限定范围、让 subagent 只执行一件事"。

## 待回答的设计问题

### 1. 上下文注入

system prompt 怎么构造才能让 subagent 只做一件事？

- 需要包含：任务描述、约束条件、输出格式要求（`<HK_RESULT>`）、禁止的操作范围
- 项目上下文怎么给？直接塞进 system prompt 会太大，是否需要先让 harness 读取相关文件再注入？
- harness 的 workflow 状态（当前 phase、已完成的 phases）怎么传递？

### 2. 输出协议

subagent 必须输出 `<HK_RESULT>` 块，但 Claude Code 没有原生支持这个格式。

- **方案 A**：在 system prompt 中要求输出 `<HK_RESULT>`，依赖 Claude Code 的指令遵循能力
- **方案 B**：harness 后处理 Claude Code 的输出，尝试提取事实声明
- **方案 C**：注册一个自定义 MCP tool 让 Claude Code 主动调用（如 `report_result`）
- 需要验证哪种方案最可靠

### 3. 失败处理

- subagent 超时（默认多久？可配置？）
- 输出不含 `<HK_RESULT>`（重试？降级？报错？）
- 结果有误（事实校验失败 → 反馈给 subagent 重试？还是回退给主 agent？）
- subagent 进入死循环（iteration budget 由谁控制？harness 还是 subagent 自己？）

### 4. 多 subagent 协调

- 多个 subagent 之间的结果冲突怎么解决？
- 是否需要 Agent A 做结果合并/冲突检测？
- 并行执行 vs 串行执行的选择依据？

## 初步方案（待细化）

```
主 agent (harness)
  │
  ├─ 构建 subagent context
  │    ├── 任务描述（来自评估 agent 的 taskOverview）
  │    ├── 约束条件（文件范围、禁止操作）
  │    ├── 输出格式要求（<HK_RESULT> 模板）
  │    └── 相关文件内容（harness 预读取）
  │
  ├─ 启动 subagent
  │    ├── claude -p --system-prompt "{constructed_prompt}" "{task}"
  │    ├── 或 codex "{task}" --full-auto
  │    └── timeout + iteration budget
  │
  ├─ 收集输出
  │    ├── 提取 <HK_RESULT> 块
  │    ├── 事实校验（FactVerificationMiddleware）
  │    └── 失败 → 反馈 + 重试（最多 N 次）
  │
  └─ 结果处理
       ├── PASS → 继续下一个 phase
       └── FAIL after retries → 报告给用户
```

## 相关文档

- [wiki/agent-runtime-plan.md](../../wiki/agent-runtime-plan.md) — Subagent 调度设计章节
- [wiki/design-decisions.md](../../wiki/design-decisions.md) — 关键决策
