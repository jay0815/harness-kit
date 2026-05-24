# harness-kit Agent Runtime 重构计划

## Context

harness-kit 当前是 PI Extension，寄生在 PI 的 agent loop 上。PI 是黑盒：compaction 会丢失 harness 状态、auto-retry 绕过验证逻辑、循环终止决策权在 PI、无法在工具执行前做验证。用户决定构建自己的 agent runtime，复刻 pi-coding-agent 大部分代码，但加入 middleware 系统和更好的 compaction 策略。

## 关键决策（已确认）

- **包位置**: harness-kit/packages/ 下新包（如 `packages/harness-agent`）
- **Middleware**: prax-agent 模式 — priority-sorted middleware 链，4 个 hook 点
- **Compaction**: 懒加载 + 工具检索，wiki 存储在项目级 `.harness-kit/wiki/`（详见 Phase 3）
- **Compaction 接口**: hermes-agent 的 `ContextEngine` ABC 模式 — 可插拔的 compaction 策略
- **工具守卫**: 借鉴 hermes-agent 的 `ToolCallGuardrailController` — per-turn 模式追踪

## 参考项目

| 项目 | 借鉴内容 |
|------|----------|
| prax-agent | middleware pipeline、synthetic tool call、ChangeTracker、error recovery |
| pi-coding-agent | Agent loop 结构、AgentSession API、session 持久化、extension 系统 |
| hermes-agent | ContextEngine ABC、MemoryProvider ABC、ToolCallGuardrailController、IterationBudget、toolset composition |

## 架构概览

### 双 Agent 架构

```
Human ←→ Agent A (转述者，轻量，只保留任务结果)
              │
              ├→ Agent B (执行者，任务驱动，可清理)
              │    ├→ 规划任务
              │    ├→ 写代码
              │    └→ 将实施任务交给 Agent A 或工具
              │
              └→ Agent A 内存：只有任务结果
                 沟通记忆：全部在 JSONL
```

**Agent A** (Orchestrator):
- 与 Human 沟通，转述 Agent B 的完整输出
- 内存中只有任务结果，不保留对话过程
- 上下文轻量 → 保持智能

**Agent B** (Executor):
- 执行具体任务（规划、编码、测试）
- 生命周期：任务完成 → 清理。token < 90% → 继续。>= 90% → 摘要交接给新 Agent B
- 核心目标：做好 > 做快。"做得好+时间长 比 做的差+时间短要好，因为人在审查时是会疲劳的"

### 包结构

```
packages/harness-agent/
├── src/
│   ├── core/
│   │   ├── agent-a.ts            ← Agent A: 转述者，轻量，与 Human 沟通
│   │   ├── agent-b.ts            ← Agent B: 执行者，任务驱动，可清理
│   │   ├── agent-loop.ts         ← 核心循环，集成 middleware pipeline
│   │   ├── middleware.ts          ← middleware 接口 + 内置 middleware
│   │   ├── context.ts            ← system prompt 构建（可定制）
│   │   ├── compaction/
│   │   │   ├── context-engine.ts ← ContextEngine ABC（借鉴 hermes-agent）
│   │   │   ├── wiki-engine.ts    ← 默认实现：wiki 懒加载策略
│   │   │   ├── wiki-generator.ts ← 异步 LLM wiki 生成 + 打分评估
│   │   │   ├── search-memory.ts  ← 记忆检索工具（注册为 agent tool）
│   │   │   └── index.ts
│   │   ├── error-recovery.ts     ← 结构化错误分类 + 恢复策略
│   │   ├── streaming-tool-executor.ts ← 并行/串行工具调度
│   │   └── types.ts              ← 共享类型定义
│   ├── session/
│   │   ├── agent-session.ts      ← 替代 PI 的 AgentSession，兼容 UI 接口
│   │   ├── session-manager.ts    ← session 持久化（JSONL + wiki 目录）
│   │   └── state.ts              ← harness-kit 状态管理
│   └── index.ts                  ← 导出
├── package.json
├── tsconfig.json
└── tests/
```

## 实施步骤

### Phase 1: 双 Agent Loop + Middleware（优先级最高）

**目标**: 实现 Agent A (转述者) + Agent B (执行者) 的双 Agent 架构，集成 middleware pipeline

#### Step 1.1: 定义类型系统

从 pi-agent 的 `types.ts` 出发，扩展双 Agent + middleware 相关类型：

- `AgentMessage` — 复用 pi-agent 的类型（Message | CustomAgentMessages）
- `AgentTool` — 复用 pi-agent 的类型
- `AgentContext` — systemPrompt + messages + tools + metadata
- `RuntimeState` — AgentContext + iteration + token usage + metadata dict
- `AgentMiddleware` — 4 个 hook 点的接口
- `AgentAState` — 任务结果列表 + JSONL 引用 + 当前 Agent B 引用
- `AgentBState` — 当前任务 + token 使用量 + taskStatus（pending/running/completed/handoff）
- `TaskSummary` — Agent B token >= 90% 时生成的交接摘要

**Middleware 接口设计**（参考 prax-agent `middleware.py:105-132`）：

```typescript
interface AgentMiddleware {
  priority: number;
  name: string;

  // LLM 调用前 — 可修改 messages、注入上下文
  beforeModel?(state: RuntimeState): Promise<void>;

  // LLM 调用后 — 可修改/替换 response，支持 synthetic tool calls
  afterModel?(state: RuntimeState, response: LLMResponse): Promise<LLMResponse>;

  // 工具执行前 — 返回 ToolResult 则短路，返回 null 则继续执行
  beforeTool?(state: RuntimeState, toolCall: AgentToolCall, tool: AgentTool): Promise<AgentToolResult | null>;

  // 工具执行后 — 可修改结果
  afterTool?(state: RuntimeState, toolCall: AgentToolCall, tool: AgentTool, result: AgentToolResult): Promise<AgentToolResult>;
}

// Priority 常量
const PRIORITY_GUARD = 10;    // 安全/循环检测
const PRIORITY_CACHE = 20;    // 缓存
const PRIORITY_INJECT = 50;   // 上下文注入
const PRIORITY_EXTRACT = 90;  // 信息提取
const PRIORITY_EVAL = 95;     // 评估/质量门
```

**关键文件参考**:
- prax-agent `middleware.py` — middleware 基类和 priority 常量
- pi-agent `types.ts` — AgentMessage、AgentTool、AgentContext 类型

#### Step 1.2: 实现 Agent A + Agent B Loop

**Agent A Loop** (转述者，轻量):
```
while (true) {
  1. 接收 Human 消息
  2. 概述 + 初步评估：
     - 理解 Human 想干什么（任务概述）
     - 初步评估：复杂度、风险、是否需要 Agent B
  3. 如果不清楚 Human 意图 → 向 Human 澄清，不唤起 Agent B
  4. 澄清后，整理为明确内容，替换为本次有效问答（Agent B 永远收到清晰任务）
  5. 整理记忆：忽略细节（从 wiki/JSONL 按需读取），只保留关键信息
  6. 委托给 Agent B 执行任务
  5. 转述 Agent B 的完整输出给 Human
  6. 保存任务结果到内存，对话到 JSONL
  7. 等待下一条消息
}
```
Agent A 的上下文：只有任务结果摘要 + 最近几轮对话。不保留 Agent B 的执行细节。

**Agent B Loop** (执行者，任务驱动):
```
while (taskStatus !== "completed") {
  1. 构建上下文（从 Agent A 获取任务 + 实时拉取相关文件/wiki）
  2. Budget guard — IterationBudget.consume()
  3. before_model chain — middleware
  4. LLM 调用
  5. after_model chain — middleware
  6. 如果有 tool calls → 执行工具
  7. 如果 token 使用量 >= 90% 且任务未完成:
     a. 生成任务摘要
     b. 清理当前 Agent B
     c. 创建新 Agent B，传入摘要，继续任务
  8. 任务完成 → 清理 Agent B，返回结果给 Agent A
}
```

**IterationBudget**（借鉴 hermes-agent）:
- 线程安全的 consume/refund 计数器
- 每个 turn 消耗一次
- 超出 budget → 强制终止循环

**ToolCallGuardrailController**（借鉴 hermes-agent，替代简单 LoopDetectionMiddleware）:
- 追踪 per-turn 模式：同一错误重复、同一工具反复失败、幂等工具无进展
- 可配置 warn/block 阈值
- 比简单 LoopDetection 更精细

**Agent B 清理策略**:
- 任务完成 → 清理
- token < 90% → 继续执行
- token >= 90% → 摘要交接给新 Agent B
- 核心目标：做好 > 做快

**关键设计 — Synthetic Tool Calls**（参考 prax-agent `middleware.py:699-860`）：
- middleware 在 `afterModel` 中注入 sentinel tool_use（如 `__completion_check__`）
- 循环看到 `has_tool_calls == true`，继续执行
- 同一个 middleware 在 `beforeTool` 中拦截 sentinel，返回 feedback 作为 ToolResult
- LLM 看到 feedback，必须再次响应

这实现了 harness-kit 的核心需求：验证失败后强制 LLM 重试，不需要修改 agent loop 本身。

**关键文件参考**:
- prax-agent `agent_loop.py:155-246` — 循环结构
- pi-agent `agent-loop.ts:155-246` — 并行工具执行
- pi-agent `agent.ts:158-543` — Agent 类的 state 管理

#### Step 1.3: 实现 StreamingToolExecutor

参考 prax-agent `streaming_tool_executor.py` 和 pi-agent `agent-loop.ts` 的并行执行：

- `isConcurrencySafe = true` 的工具（Read, Grep, Glob）用 `Promise.all` 并行
- 其他工具串行队列
- 每个工具调用独立经过 middleware chain

#### Step 1.4: 实现 ChangeTracker middleware

参考 prax-agent `middleware.py:273-315`：

```typescript
class ChangeTracker implements AgentMiddleware {
  priority = PRIORITY_GUARD; // 5, 最先执行
  name = "ChangeTracker";

  // 每次 code-modifying tool 成功后 code_gen++
  // 每次 verify 通过后 verified_gen = code_gen
  // 其他 middleware 读取 code_gen > verified_gen 判断是否有未验证的变更
}
```

**Single-writer 原则**: 只有 ChangeTracker 写入共享状态，其他 middleware 只读。

#### Step 1.5: 实现基础 middleware

- `VerificationGuidanceMiddleware` — 验证失败/成功时注入引导消息
- `ToolCallGuardrailMiddleware` — 包装 hermes-agent 的 ToolCallGuardrailController，per-turn 模式追踪（替代简单 LoopDetection）
- `QualityGateMiddleware` — 用 synthetic tool call 阻止未验证的完成
- `IntentGateMiddleware` — 强制 LLM 先 verbalize 计划

### Phase 2: Session 层（UI 兼容）

**目标**: 实现与 PI AgentSession 接口兼容的 session 层，让 PI UI 层零修改即可使用

#### Step 2.1: 实现 HarnessAgentSession

API 兼容 PI 的 AgentSession，但内部使用我们自己的 agent loop：

```typescript
class HarnessAgentSession {
  // Agent loop control — 委托给我们的 Agent 类
  prompt(text, options?): Promise<void>
  steer(text, images?): Promise<void>
  followUp(text, images?): Promise<void>
  abort(): Promise<void>

  // State accessors
  get isStreaming(): boolean
  get model(): Model
  get messages(): AgentMessage[]
  // ...

  // Events — 兼容 AgentSessionEvent 类型
  subscribe(listener): () => void

  // Extension binding — 兼容 PI 的 ExtensionBindings
  bindExtensions(bindings): Promise<void>

  // Compaction — 使用我们的新策略
  compact(customInstructions?): Promise<CompactionResult>
}
```

**关键文件参考**:
- pi-agent `agent-session.ts` — AgentSession 的完整 API
- PI interactive-mode.ts — UI 层实际使用了哪些 API（上面探索报告已列出）

#### Step 2.2: 实现 SessionManager

复用 PI 的 JSONL append-only 格式，但修改 compaction entry 的结构：

- 保持 `CompactionEntry` 的 tree 结构（id/parentId）
- 增加我们的 compaction 元数据（切片策略、wiki 引用等）
- `buildSessionContext()` 适配我们的 compaction 格式

#### Step 2.3: 实现 Extension 兼容层

确保 PI 的 ExtensionAPI 事件都能正确触发：

- `session_start` / `session_shutdown`
- `before_agent_start` / `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
- `tool_call` / `tool_result`
- `context` — 允许 extension 修改 messages
- `before_provider_request` / `after_provider_response`

### Phase 3: Compaction — 动态上下文组装

**核心理念**: LLM 智能够，缺的是与现实交互的工具。Compaction 不是"压缩摘要"，而是"动态组装最相关的上下文"。

**上下文组装公式** (适用于任何轮次):
```
每轮上下文 = 最新消息 + @ 引用的文件（实时记忆+实时代码）+ LLM 判断
             ↓              ↓                        ↓
         用户意图      实时拉取，不是缓存           动态决定需要什么
```

**关键洞察**:
1. **越聚焦 → 上下文越少** — 不需要压缩，因为相关的东西本来就不多
2. **多轮探索 → 多维度向量趋紧目标** — 每轮交互都在缩小搜索空间
3. **实时 > 缓存** — @ 引用的文件是实时读取的，不是 compaction 时生成的摘要

**Compaction 的真正作用**: 当上下文快满时，把不再相关的内容移出去，腾出空间给实时拉取的高相关内容。不是"把旧对话塞进摘要"。

**Wiki 的双重角色**:
- **静态背景**: 简短 wiki summary (~500 tokens) 始终在 system prompt 里，提供项目级背景知识
- **动态记忆源**: 详细 wiki 内容通过 `search_memory` 工具按需拉取，LLM 需要时实时检索

**为什么不用"全部塞进摘要"的方式**:
1. **LLM 注意力衰减**: 长摘要中间部分的关注度显著降低，任务会偏离预期
2. **截断问题**: 信息越多，截断越严重，关键细节容易丢失
3. **无法实时更新**: 静态摘要无法反映 wiki 的实时演进
4. **成本**: 大上下文 = 高 token 成本，且模型上下文扩展本身困难且昂贵

#### Step 3.1: ContextEngine 接口 + 动态组装

**ContextEngine ABC**（借鉴 hermes-agent `context_engine.py`）:
```typescript
abstract class ContextEngine {
  abstract onSessionStart(): void;
  abstract updateFromResponse(usage: TokenUsage): void;
  abstract shouldCompress(promptTokens: number): boolean;
  abstract assembleContext(messages: AgentMessage[], currentTokens: number): Promise<AgentMessage[]>;
  abstract onSessionEnd(): void;
}
```
默认实现是 WikiContextEngine，但策略可插拔替换。

**触发**: `shouldCompress()` 返回 true 时（token 快满，默认 75% context window）

**动态组装逻辑** (每轮都适用):
```
上下文 = system info + wiki summary (静态背景, ~500 tokens) + 最近 2-3 轮 + @ 引用的实时内容
                ↑                         ↑                        ↑              ↑
          项目/workflow 状态        项目级背景知识            原样保留        实时拉取
```

- **system info**: 项目上下文、harness workflow 状态、当前阶段
- **wiki summary**: 静态背景（~500 tokens），提供项目级知识概览
- **最近 2-3 轮**: 完整保留，包括 tool calls 和 tool results
- **@ 引用**: LLM 通过 `search_memory`、`read_file` 等工具实时拉取相关内容

**Compaction 动作**: 当 `shouldCompress()` 为 true 时，移除不再相关的内容（旧轮次），腾出空间给实时拉取的高相关内容。同时异步生成/更新 wiki。

#### Step 3.2: Wiki 生成（异步 LLM）

compaction 触发后，**不阻塞 agent**，在后台异步执行：

1. 把要压缩的旧对话序列化（参考 PI 的 `serializeConversation()`）
2. 调用 LLM 生成结构化 wiki：
   ```
   ## 项目目标
   ## 已完成的工作
   ## 关键决策
   ## 文件变更记录（哪些文件被修改、为什么）
   ## 遇到的问题和解决方案
   ## 未完成的任务
   ```
3. Wiki 存储到 `.harness-kit/wiki/{timestamp}.json`
4. 同时更新 wiki summary（~500 tokens），注入 system prompt 作为静态背景

**Wiki 双重角色**:
- **静态背景**: wiki summary 始终在 system prompt，提供项目级概览
- **动态记忆源**: 完整 wiki 通过 `search_memory` 工具按需检索

**与 PI 的关键差异**:
- PI: 同步阻塞，agent 停止，LLM 总结后继续
- 我们: 异步后台，agent 继续工作，wiki 完成后无感替换

#### Step 3.3: 打分评估 + 重试

wiki 生成后，用另一个 LLM 调用评估质量：

```typescript
interface CompactionScore {
  completeness: number;  // 0-1, 关键信息是否保留
  accuracy: number;      // 0-1, 信息是否准确
  conciseness: number;   // 0-1, 是否足够简洁
  overall: number;       // 加权平均
}
```

- `overall >= 0.7` → 接受，替换上下文
- `overall < 0.7` → 重新生成，附带评分反馈
- 最多重试 2 次

#### Step 3.4: 记忆检索工具

wiki 存储在项目级 `.harness-kit/wiki/` 目录下，注册为 LLM 可调用的工具：

```typescript
// 注册为 agent tool
{
  name: "search_memory",
  description: "搜索当前 session 的历史记忆。当你需要查找之前讨论过的内容、做过的工作、遇到的问题时使用。",
  parameters: {
    query: "搜索关键词",
    scope: "wiki | conversation | all"  // 可选
  }
}
```

**存储结构**:
```
项目根目录/
├── .harness-kit/
│   ├── wiki/                    ← 项目级 wiki，所有 session 共享
│   │   ├── 001.json             ← 第一次 compaction 生成的 wiki
│   │   ├── 002.json             ← 第二次 compaction 生成的 wiki
│   │   └── latest.json          ← 最新 wiki 的 symlink
│   ├── sessions/
│   │   └── {sessionId}/
│   │       ├── session.jsonl    ← 完整对话（append-only，永不删除）
│   │       └── artifacts/
│   │           ├── 0-design.json
│   │           └── 1-implement.json
│   └── knowledge/               ← 跨会话高置信度知识（Step 3.5）
```

**为什么 wiki 在项目级而非 session 级**: 多个 session 共享同一份 wiki 知识。新 session 启动时，system prompt 自动注入 wiki summary 指针，所有 session 都能感知到项目历史知识。`search_memory` 工具读取项目级 wiki 目录。

**信息不丢失**: 完整对话始终在各 session 的 `session.jsonl`，wiki 是项目级知识索引。模型通过 `search_memory` 工具可以找到任何历史信息。

#### Step 3.5: 跨会话记忆（可选，后续扩展）

wiki 格式化后可以跨 session 复用：
- 高置信度的项目事实持久化到 `.harness-kit/knowledge/`
- 新 session 启动时注入 relevant knowledge
- 参考 prax-agent 的 `MemoryBackend` 置信度评分机制

### Phase 4: Error Recovery + Planning（借鉴 prax-agent）

#### Step 4.1: 结构化错误恢复

参考 prax-agent `error_recovery.py`：

```typescript
// 7 种错误类型
enum ErrorType {
  TOOL_ERROR, MODEL_ERROR, TIMEOUT, PERMISSION_DENIED,
  RESOURCE_EXHAUSTED, PARSE_ERROR, UNKNOWN
}

// 7 种恢复策略
enum RecoveryAction {
  RETRY_SAME, SWITCH_TOOL, UPGRADE_MODEL, REDUCE_SCOPE,
  SKIP_ITEM, WAIT_AND_RETRY, ABORT
}

// 分类 → 策略映射 + 指数退避 + 工具黑名单
```

#### Step 4.2: LLM 驱动的任务规划（可选）

参考 prax-agent `planning.py`：

- 用 LLM 把任务分解为 3-8 个有依赖关系的子任务
- `depends_on` 边缘 → 拓扑排序 → 执行顺序
- 失败时降级到静态模板

### Phase 5: 迁移 + 测试

#### Step 5.1: 迁移 harness-kit extension

- `packages/core/src/index.ts` 改为使用 `HarnessAgentSession` 而非 PI 的 `AgentSession`
- 保留 `<HK_RESULT>` 验证逻辑
- 保留 guardrails 快照逻辑
- 保留 workflow 推进逻辑

#### Step 5.2: 测试

- 复用 pi-coding-agent 的测试用例（UI 兼容性）
- 新增 middleware pipeline 测试
- 新增 synthetic tool call 测试
- 新增 compaction 测试
- 新增 error recovery 测试

## 关键文件清单

### 从 pi-mono 复制/修改的文件
- `packages/agent/src/agent.ts` → 改造为我们的 Agent 类
- `packages/agent/src/agent-loop.ts` → 集成 middleware pipeline
- `packages/agent/src/types.ts` → 扩展 middleware 类型
- `packages/coding-agent/src/core/agent-session.ts` → 改造为 HarnessAgentSession
- `packages/coding-agent/src/core/session-manager.ts` → 适配新 compaction
- `packages/coding-agent/src/core/compaction/` → 重写
- `packages/coding-agent/src/core/tools/` → 复用工具实现
- `packages/coding-agent/src/core/extensions/` → 复用 extension 系统

### 从 prax-agent 借鉴的模式
- `src/prax/core/middleware.py` — middleware 接口 + priority 系统
- `src/prax/core/agent_loop.py` — synthetic tool call 模式
- `src/prax/core/error_recovery.py` — 错误分类 + 恢复策略
- `src/prax/core/streaming_tool_executor.py` — 并行/串行调度

### 从 hermes-agent 借鉴的模式
- `agent/context_engine.py` — ContextEngine ABC（可插拔 compaction 策略）
- `agent/tool_guardrails.py` — ToolCallGuardrailController（per-turn 模式追踪）
- `agent/memory_provider.py` — MemoryProvider ABC（记忆提供者接口）
- `run_agent.py` — IterationBudget（线程安全的迭代预算）
- `agent/tool_executor.py` — 并行/串行工具调度 + ThreadPoolExecutor
- `hermes_cli/plugins.py` — PluginContext facade（插件注册模式）

## 验证方式

1. **UI 兼容性**: PI 的 interactive-mode.ts 零修改即可使用新 session
2. **双 Agent 架构**:
   - Agent A 上下文保持轻量（只有任务结果）
   - Agent B 任务完成后正确清理
   - Agent B token >= 90% 时正确交接给新 Agent B
   - Agent A 转述 Agent B 的完整输出
3. **Middleware**: 验证 synthetic tool call 可以强制 LLM 重试
4. **ChangeTracker**: 验证 code_gen/verified_gen 追踪正确
5. **Compaction**:
   - 动态组装上下文（最新消息 + @ 引用 + LLM 判断）
   - wiki 双重角色：静态背景 + 动态记忆源
   - 异步：wiki 生成不阻塞 agent
   - 检索：`search_memory` 工具可以找到历史信息
   - 不丢失：完整对话在 session.jsonl，永不删除
6. **Error Recovery**: 验证错误分类和恢复策略正确触发
7. **现有测试**: `pnpm run test` 全部通过
