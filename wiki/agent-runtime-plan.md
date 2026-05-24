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

## Agent A 评估机制重设计

### 现状问题

`agent-a.ts` 的 `assessInput()` 用关键词匹配做任务分类：

```typescript
const isQuestion = lower.includes("?") || lower.startsWith("what") || ...
const isTask = lower.includes("implement") || lower.includes("fix") || ...
const isVague = input.length < 20 || lower === "help" || ...
```

问题：
- **"implement" 在问题句里也会出现** — "How does X implement Y?" 会被误判为任务
- **"fix" 在讨论中也会出现** — "The fix for this is..." 不是要执行修复
- **复杂度用词数估算** — 50 词 = high，20 词 = medium，毫无语义依据
- **风险用关键词估算** — "delete" = high，但 "delete a comment" 风险很低

### 核心思考：为什么需要独立评估 agent

单 agent + 好的 system prompt + 工具，天然能做任务评估和执行。但评估质量会被主 agent 的上下文污染。

**独立评估 agent 的价值不在于"能不能做"，而在于"做得好不好"：**

1. **上下文隔离** — 主 agent 的对话历史（包括之前的工具调用、错误、修正）会影响判断。独立 agent 看到的是干净的原始输入，不会被"我已经试过 X 了"这种上下文干扰
2. **客观性** — 主 agent 可能因为已经投入了多轮交互而倾向于继续（沉没成本）。独立 agent 没有这种偏见
3. **可替换** — 评估逻辑可以独立迭代（换模型、换 prompt、加工具），不影响执行 agent
4. **自主性** — 评估 agent 可以有自己的 system prompt（强调风险评估、任务分解），甚至可以用不同的模型（更便宜、更快的模型做初筛）

### 设计方案

**评估 agent 是一个独立的 LLM 调用，不是关键词匹配。**

```
用户输入
  │
  ▼
评估 agent（独立 LLM 调用，干净上下文）
  ├── system prompt: 强调风险评估、任务分解、复杂度判断
  ├── input: 用户原始消息（无历史上下文）
  ├── tools: read_file（可以读代码辅助判断）、list_files（了解项目结构）
  └── output: 结构化评估 JSON
       ├── understood: boolean
       ├── taskOverview: string（整理后的清晰任务描述）
       ├── complexity: "low" | "medium" | "high"（附理由）
       ├── risk: "low" | "medium" | "high"（附理由）
       ├── needsAgentB: boolean
       ├── clarificationNeeded?: string
       └── reasoning: string（评估推理过程）
  │
  ▼
主 agent（执行者，有完整上下文）
  ├── 收到评估结果 + 整理后的任务描述
  └── 执行任务
```

### 评估 agent 的 system prompt 设计

```
你是一个任务评估 agent。你的唯一职责是理解用户输入，做出结构化评估。

规则：
1. 判断用户是想"问问题"还是"执行任务"
2. 如果是任务，评估复杂度和风险
3. 如果输入模糊，指出需要澄清的具体点
4. 输出严格的 JSON，不要输出其他内容

复杂度评估标准：
- low: 单文件修改、简单查询、格式调整
- medium: 多文件修改、需要理解上下文、涉及测试
- high: 架构变更、跨模块重构、涉及安全/数据

风险评估标准：
- low: 只读操作、添加新代码、文档修改
- medium: 修改现有代码、重构、依赖变更
- high: 删除代码、数据库变更、安全相关、生产环境操作

你可以使用 read_file 和 list_files 工具来辅助判断（例如查看项目结构、了解代码规模）。
```

### 为什么评估 agent 需要工具

纯 LLM 判断复杂度和风险还是不够准确。给评估 agent 读文件的能力，它可以：
- 看到要修改的文件有多大、有多少依赖
- 判断"refactor auth module"是改 1 个文件还是 20 个文件
- 判断"delete the old handler"删除的是 10 行还是 1000 行

这比关键词匹配准确得多。

### 与主 agent 的交互

评估 agent 的输出是结构化 JSON，主 agent 收到后：
- `understood: false` → 向用户澄清
- `needsAgentB: false` → 直接回答（简单问题）
- `needsAgentB: true` → 用 `taskOverview` 作为任务描述，委托执行

主 agent 不需要重新理解用户意图，评估 agent 已经整理好了。

### 实施步骤

1. 重写 `assessInput()` — 改为 LLM 调用，用结构化 prompt + JSON 输出
2. 评估 agent 的 system prompt — 强调风险评估、任务分解
3. 给评估 agent 注入工具 — read_file、list_files（只读）
4. 更新测试 — 用 registerFauxProvider 测试评估逻辑
5. 移除关键词匹配代码

### 收益

| 维度 | 关键词匹配 | LLM 评估 |
|------|-----------|----------|
| 准确率 | 低（误判多） | 高（理解语义） |
| 复杂度判断 | 词数估算 | 代码规模 + 依赖分析 |
| 风险判断 | 关键词匹配 | 语义理解 + 文件检查 |
| 可维护性 | 硬编码规则 | prompt 迭代 |
| 可扩展性 | 加规则 | 加工具 |

---

## Subagent 调度设计

### 现状

"claude -p 作为 subagent" 是确定的方向，但只有方向没有具体设计。harness-kit 的核心价值之一是"给足上下文、限定范围、让 subagent 只执行一件事"，这需要一套完整的调度协议。

### 待回答的问题

**上下文注入**：
- system prompt 怎么构造才能让 Claude Code 只做一件事？需要包含：任务描述、约束条件、输出格式要求（`<HK_RESULT>`）、禁止的操作范围
- 项目上下文怎么给？直接塞进 system prompt 会太大，是否需要先让 harness 读取相关文件再注入？
- harness 的 workflow 状态（当前 phase、已完成的 phases）怎么传递？

**输出协议**：
- subagent 必须输出 `<HK_RESULT>` 块，但 Claude Code 没有原生支持这个格式
- 方案 A：在 system prompt 中要求输出 `<HK_RESULT>`，依赖 Claude Code 的指令遵循能力
- 方案 B：harness 后处理 Claude Code 的输出，尝试提取事实声明
- 方案 C：注册一个自定义 MCP tool 让 Claude Code 主动调用（如 `report_result`）
- 需要验证哪种方案最可靠

**失败处理**：
- subagent 超时（默认多久？可配置？）
- 输出不含 `<HK_RESULT>`（重试？降级？报错？）
- 结果有误（事实校验失败 → 反馈给 subagent 重试？还是回退给主 agent？）
- subagent 进入死循环（iteration budget 由谁控制？harness 还是 subagent 自己？）

**多 subagent 协调**：
- 多个 subagent 之间的结果冲突怎么解决？
- 是否需要 Agent A 做结果合并/冲突检测？
- 并行执行 vs 串行执行的选择依据？

### 设计方案（待细化）

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

### 实施步骤

1. 定义 subagent 调度协议（system prompt 模板、输出格式、超时配置）
2. 实现 SubagentRunner — 封装 `claude -p` / `codex` CLI 调用
3. 实现输出解析 — 从 subagent 输出中提取 `<HK_RESULT>`
4. 实现失败重试 — 超时、格式错误、事实校验失败的重试策略
5. 集成到 Agent A — 作为 Agent B 的替代执行方式
6. 测试 — 用 mock subagent 测试调度协议

---

## pi-ai 解耦（优先级最低）

### 现状

agent runtime 深度依赖 `@mariozechner/pi-ai`：
- `StreamFn` 类型签名直接继承自 `streamSimple`
- `AssistantMessage` 结构（`ToolCall.arguments` vs `input`）渗透到 agent-loop、event-bridge、所有测试 mock
- `Model`、`Message`、`Tool`、`ToolResultMessage` 等核心类型全部来自 pi-ai
- CLI config 使用 `getModel`、`getModels`、`getProviders`、`getEnvApiKey`、`streamSimple`

### 问题

如果以后要支持不走 pi-ai 的 provider（比如直接调 Anthropic SDK、OpenAI SDK），改动面会很大。当前的抽象层不够：
- `StreamFn` 是 pi-ai 的 `streamSimple` 的直接映射，不是通用抽象
- 消息格式（`role: "toolResult"`、`toolCallId`、`toolName`）是 pi-ai 的约定
- 测试 mock 都基于 pi-ai 的 `registerFauxProvider`

### 为什么优先级最低

- pi-ai 目前工作正常，支持 anthropic、openai、deepseek 等主流 provider
- 直接调 SDK 的收益不明确（pi-ai 已经封装了多 provider）
- 解耦成本高：需要定义通用消息格式、抽象 stream 协议、重写所有测试
- 当前阶段（事实校验、subagent 调度、评估 agent）更有价值

### 未来解耦路径（仅记录，不实施）

1. 定义 harness-kit 自有的消息格式（`HarnessMessage`、`HarnessToolCall`、`HarnessToolResult`）
2. 定义通用 stream 协议（`StreamAdapter` 接口，pi-ai 作为第一个实现）
3. 在 agent-loop 和 middleware 之间加转换层
4. 逐步替换测试 mock

---

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

### Phase 4: 事实校验迁移（verify → agent）

**目标**: 将事实校验从 `@harness-kit/core` 移入 `@harness-kit/agent` 作为固定能力。通过牺牲速度换取准确性。

**动机**: verify.ts、result-block.ts 是纯函数，零外部依赖。放在 core 中意味着 standalone 模式没有事实校验，agent 可以编造文件引用。

#### Step 4.1: 迁移验证函数

从 core 包移入 agent 包：
- `verify.ts` → `packages/harness-agent/src/core/verify.ts`
- `result-block.ts` → `packages/harness-agent/src/core/result-block.ts`
- Fact/ResultBlock/VerifyReport/VerifyCheck 接口 → `packages/harness-agent/src/core/verify-types.ts`

#### Step 4.2: 创建 FactVerificationMiddleware

`packages/harness-agent/src/core/fact-verification.ts`

- afterModel 钩子（priority = PRIORITY_EXTRACT = 90）
- 从 LLM response 中提取文本，调用 extractResultBlock()
- 有 HK_RESULT 时调用 verifyFacts()
- FAIL 时注入 user message 到 context.messages
- PASS/FAIL 时更新 ChangeTracker metadata

#### Step 4.3: 注册为默认 middleware

在 HarnessAgentSession.start() 中注册 FactVerificationMiddleware，与 ChangeTracker、ToolCallGuardrail 等并列。

#### Step 4.4: 更新 core 包

- core 的 verify.ts/result-block.ts 改为从 `@harness-kit/agent` re-export
- core 的 index.ts 使用 agent 包的验证函数
- core 的 turn_end 钩子保留 PI 特有逻辑（telemetry、sendUserMessage）

#### Step 4.5: 迁移测试

- verify.test.ts、result-block.test.ts 从 core 迁移到 agent
- 新建 fact-verification.test.ts（middleware 单元测试）

### Phase 5: Error Recovery + Planning（借鉴 prax-agent）

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

### Phase 6: 迁移 + 测试

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
5. **事实校验（Phase 4）**:
   - standalone CLI 模式自动校验 `<HK_RESULT>` 中的事实
   - PASS 时更新 ChangeTracker verifiedGen
   - FAIL 时注入 user message，LLM 下一轮看到并修正
   - core 包从 agent 包导入验证函数，PI 模式 telemetry 不受影响
6. **Compaction**:
   - 动态组装上下文（最新消息 + @ 引用 + LLM 判断）
   - wiki 双重角色：静态背景 + 动态记忆源
   - 异步：wiki 生成不阻塞 agent
   - 检索：`search_memory` 工具可以找到历史信息
   - 不丢失：完整对话在 session.jsonl，永不删除
7. **Error Recovery**: 验证错误分类和恢复策略正确触发
8. **现有测试**: `pnpm run test` 全部通过
