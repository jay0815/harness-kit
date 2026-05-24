# Phase 1 Review: 双 Agent Loop + Middleware

## Background

harness-kit 是一个 PI Extension，通过结构化 workflow 编排 coding agent，并对 agent 输出做硬事实验证。当前寄生在 PI 的 agent loop 上，PI 是黑盒：compaction 丢失状态、auto-retry 绕过验证、循环终止权在 PI、无法在工具执行前拦截。

**目标**: 构建自有 agent runtime，替代 PI 黑盒，获得完全控制权。

**参考项目**:
- prax-agent: middleware pipeline, synthetic tool call, ChangeTracker
- pi-coding-agent: agent loop 结构, AgentSession API, session 持久化
- hermes-agent: ContextEngine ABC, ToolCallGuardrailController, IterationBudget

## Design Decisions

### 1. 双 Agent 架构

```
Human ←→ Agent A (转述者，轻量)
              │
              ├→ Agent B (执行者，任务驱动，可清理)
              │
              └→ Agent A 内存：只有任务结果
                 沟通记忆：全部在 JSONL
```

- **Agent A**: 与 Human 沟通，每次接收消息后做初步评估（理解意图 + 复杂度/风险），不清楚时先澄清，整理记忆后委托 Agent B
- **Agent B**: 任务驱动执行者，token >= 90% 时摘要交接给新 Agent B，任务完成后清理
- **核心原则**: 做好 > 做快。Agent A 上下文轻量 → 保持智能

### 2. Middleware Pipeline (prax-agent 模式)

Priority-sorted chain，4 个 hook 点：
- `beforeModel` — LLM 调用前，可修改 messages
- `afterModel` — LLM 调用后，可修改 response，支持 synthetic tool calls
- `beforeTool` — 工具执行前，返回 result 则短路
- `afterTool` — 工具执行后，可修改结果

Priority 常量: GUARD=10, CACHE=20, INJECT=50, EXTRACT=90, EVAL=95

### 3. Synthetic Tool Call

QualityGateMiddleware 使用此模式：在 `afterModel` 中注入 sentinel `__quality_gate__` tool_use，循环继续执行；在 `beforeTool` 中拦截 sentinel，返回 feedback 作为 ToolResult。LLM 看到 feedback 后必须再次响应。

### 4. ChangeTracker (Single-writer)

只有 ChangeTracker 写入 `change_tracker` metadata，其他 middleware 只读。
- `codeGen`: code-modifying tool 成功后递增
- `verifiedGen`: verify 通过后设为 codeGen
- `codeGen > verifiedGen` → 有未验证的变更

### 5. Compaction 哲学

不是"压缩摘要"，而是"动态上下文组装"：
- 每轮上下文 = 最新消息 + @ 引用的文件（实时）+ LLM 判断
- 越聚焦 → 上下文越少
- Wiki 双重角色：静态背景（system prompt）+ 动态记忆源（search_memory 工具）

## New Files

### Source Files (8 files)

| File | Lines | Responsibility |
|------|-------|----------------|
| `packages/harness-agent/src/core/types.ts` | ~220 | 类型系统：双 Agent 类型, middleware 接口, IterationBudget, TokenUsage, Priority 常量 |
| `packages/harness-agent/src/core/middleware.ts` | ~70 | MiddlewarePipeline: priority-sorted chain, 4 hook 点的执行器 |
| `packages/harness-agent/src/core/agent-loop.ts` | ~180 | 核心循环: runAgentLoop, 集成 middleware pipeline, IterationBudget 驱动 |
| `packages/harness-agent/src/core/agent-a.ts` | ~150 | Agent A: 初步评估(理解意图+复杂度/风险), 澄清, 记忆整理, 委托 Agent B |
| `packages/harness-agent/src/core/agent-b.ts` | ~160 | Agent B: 任务执行者, token 阈值交接(>=90%), 任务完成清理 |
| `packages/harness-agent/src/core/streaming-tool-executor.ts` | ~130 | 并行/串行工具调度: PARALLEL_SAFE_TOOLS 并行, NEVER_PARALLEL_TOOLS 串行 |
| `packages/harness-agent/src/core/change-tracker.ts` | ~110 | ChangeTracker middleware: codeGen/verifiedGen 追踪, verify 命令检测 |
| `packages/harness-agent/src/core/middlewares.ts` | ~140 | 4 个基础 middleware: VerificationGuidance, ToolCallGuardrail, QualityGate, IntentGate |

### Test Files (6 files, 58 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `types.test.ts` | 9 | IterationBudget consume/refund/boundary, 常量值 |
| `middleware.test.ts` | 7 | Pipeline priority ordering, response chaining, blocking, unregister, empty |
| `change-tracker.test.ts` | 13 | codeGen 递增, verifiedGen 更新, verify 命令检测(Bash/tsc), helper 函数 |
| `middlewares.test.ts` | 18 | VerificationGuidance 注入, Guardrail 阈值阻断/重置, QualityGate sentinel, IntentGate 注入/重置 |
| `agent-a.test.ts` | 6 | 创建, 模糊输入澄清, 问题/任务分流, 任务结果保存 |
| `streaming-tool-executor.test.ts` | 5 | sequential 顺序, parallel 并发, never-parallel 串行, 错误处理, 缺失工具 |

## Review Focus Areas

1. **Type Safety**: `types.ts` 中的类型是否完整？是否有 `any` 滥用？
2. **Middleware Correctness**: `middleware.ts` 的 priority 排序和 chain 执行是否正确？短路逻辑是否正确？
3. **Agent Loop Edge Cases**: `agent-loop.ts` 中断信号处理、空工具列表、stream 异常是否处理？
4. **Agent B Handoff**: `agent-b.ts` 中 token 阈值检测和 TaskSummary 生成是否合理？
5. **ChangeTracker Single-writer**: 是否真的只有 ChangeTracker 写入 metadata？其他 middleware 是否有越权写入？
6. **Synthetic Tool Call**: QualityGateMiddleware 的 sentinel 注入和拦截是否形成死循环？sentFeedback flag 是否可靠？
7. **StreamingToolExecutor**: 并行分组逻辑是否正确？chunk 执行是否有竞态？
8. **Test Quality**: 测试是否覆盖了关键路径？是否有遗漏的 edge case？

## Key Code Snippets

### Middleware Pipeline (middleware.ts)

```typescript
export class MiddlewarePipeline {
  private middlewares: AgentMiddleware[] = [];

  register(middleware: AgentMiddleware): void {
    this.middlewares.push(middleware);
    this.middlewares.sort((a, b) => a.priority - b.priority);
  }

  async runBeforeTool(
    state: RuntimeState,
    toolCall: AgentToolCall,
    tool: AgentTool | undefined,
  ): Promise<AgentToolResult<any> | null> {
    for (const mw of this.middlewares) {
      if (mw.beforeTool) {
        const result = await mw.beforeTool(state, toolCall, tool);
        if (result !== null) return result; // First block wins
      }
    }
    return null;
  }
}
```

### Agent B Token Handoff (agent-b.ts)

```typescript
const threshold = this.config.tokenThreshold ?? AGENT_B_TOKEN_THRESHOLD;
const usageRatio = result.tokenUsage.totalTokens / result.tokenUsage.contextWindow;

if (usageRatio >= threshold) {
  const taskSummary = this.generateTaskSummary(result.tokenUsage);
  this.state.taskStatus = "handoff";
  return {
    summary: `Task in progress, handoff needed at ${Math.round(usageRatio * 100)}% token usage`,
    status: "handoff",
    output: result.messages.map((m) => this.messageToText(m)).join("\n"),
    taskSummary,
  };
}
```

### QualityGate Synthetic Tool Call (middlewares.ts)

```typescript
async afterModel(state: RuntimeState, response: LLMResponse): Promise<LLMResponse> {
  if (!hasUnverifiedChanges(state)) return response;
  if (this.sentFeedback) return response; // Prevent loop

  const hasToolCalls = response.content.some((c: any) => c.type === "toolCall");
  if (hasToolCalls) return response; // Model still working

  // Inject sentinel
  this.sentFeedback = true;
  response.content.push({
    type: "toolCall" as const,
    id: `quality_gate_${Date.now()}`,
    name: "__quality_gate__",
    input: { message: "You have unverified code changes. Run verification before finishing." },
  } as any);
  return response;
}
```

### ChangeTracker Single-writer (change-tracker.ts)

```typescript
async afterTool(state, toolCall, _tool, result): Promise<AgentToolResult<any>> {
  const isCode = CODE_MODIFYING_TOOLS.has(toolCall.name);
  const isVerify = this.isVerifyAttempt(toolCall);

  if (!isCode && !isVerify) return result; // Skip irrelevant tools
  if (result.isError) return result;        // Skip errors

  const tracker = getTracker(state);        // Only writer

  if (isCode) tracker.codeGen++;
  if (isVerify) {
    tracker.verifiedGen = tracker.codeGen;
    tracker.lastVerifyOk = true;
    tracker.lastVerifyError = null;
  }
  return result;
}
```

## Build & Test

```bash
cd packages/harness-agent
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest run — 58 tests
```
