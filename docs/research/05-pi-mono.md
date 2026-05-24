# PI Framework (pi-mono) 调研

> 来源：github-repo/pi-mono
> 调研者：parallel-agent-5
> 日期：2026-05-02

## 1. PI 是什么

PI 是一个**极简、可扩展的 AI Agent 框架**，由 Mario Zechner 开发，以 mono-repo 形式托管在 GitHub（badlogic/pi-mono）。项目口号是 "Tools for building AI agents"，核心定位是：

- **不做大而全**：明确拒绝内置 MCP、sub-agent、plan mode、permission popup、background bash、to-do 等常见功能
- **极致可扩展**：所有工作流特性都通过 Extensions（TypeScript 扩展）、Skills（Markdown 能力包）、Prompt Templates、Themes 实现
- **适应你的工作流**："Adapt pi to your workflows, not the other way around"

**与同类框架的差异**：

| 维度 | PI | Claude Agent SDK | LangChain | AutoGen |
|------|-----|------------------|-----------|---------|
| 定位 | 极简 harness + 可扩展 | 企业级 Agent SDK | 编排框架 | 多 Agent 对话 |
| 内置功能 | 极少（工具调用+会话） | 丰富（MCP、sub-agent 等） | 丰富（chain、RAG 等） | 丰富（group chat 等） |
| 扩展方式 | Extensions + Skills | 插件/集成 | 组件链 | Agent 注册 |
| 语言 | TypeScript/Node | Python/TS | Python/JS | Python |
| 多 Provider | 20+（OpenAI、Anthropic、Google、Bedrock 等） | Anthropic 为主 | 广泛 | 广泛 |
| 上下文管理 | 自动 compaction + 分支摘要 | 依赖外部 | 手动 | 手动 |

## 2. 项目结构

PI 是 npm workspace mono-repo，包含 5 个 packages：

```
packages/
  ai/           # @mariozechner/pi-ai — 统一多 Provider LLM API
  agent/        # @mariozechner/pi-agent-core — Agent 运行时（工具调用+状态管理）
  coding-agent/ # @mariozechner/pi-coding-agent — 交互式 coding agent CLI + SDK
  tui/          # @mariozechner/pi-tui — 终端 UI 库（差分渲染）
  web-ui/       # @mariozechner/pi-web-ui — Web 组件（AI 聊天界面）
```

**关键目录说明**：

- `packages/ai/src/providers/` — 20+ LLM Provider 实现（Anthropic、OpenAI、Google、Bedrock、Mistral、Groq、OpenRouter 等）
- `packages/ai/src/types.ts` — 统一 Message/Tool/Model/Context 类型定义
- `packages/agent/src/agent.ts` — `Agent` 类核心实现
- `packages/agent/src/agent-loop.ts` — 低级别 agent 循环（`agentLoop` / `agentLoopContinue`）
- `packages/coding-agent/src/core/` — coding agent 的业务逻辑层
  - `tools/` — 7 个内置工具（read/bash/edit/write/grep/find/ls）
  - `extensions/` — 扩展系统（事件订阅、自定义工具、命令、快捷键）
  - `compaction/` — 上下文压缩/分支摘要
  - `skills.ts` — Skill 加载与格式化
  - `sdk.ts` — `createAgentSession()` 工厂函数
- `packages/coding-agent/examples/sdk/` — 13 个 SDK 使用示例
- `packages/coding-agent/examples/extensions/` — 70+ 扩展示例

## 3. 核心抽象

### agent

Agent 是 PI 的核心抽象，由 `Agent` 类（`packages/agent/src/agent.ts`）实现：

```typescript
class Agent {
  state: AgentState        // 系统 prompt、model、tools、messages
  subscribe(listener)      // 订阅生命周期事件
  prompt(message)          // 发送用户消息，启动 agent 循环
  continue()               // 从当前上下文继续（用于重试）
  steer(message)           // 运行时注入 steering 消息
  followUp(message)        // 队列 follow-up 消息
  abort()                  // 取消当前运行
}
```

`AgentState` 包含：`systemPrompt`、`model`、`thinkingLevel`、`tools`、`messages`，以及运行时状态 `isStreaming`、`streamingMessage`、`pendingToolCalls`、`errorMessage`。

**关键设计**：AgentMessage 是可扩展的联合类型，支持通过 TypeScript declaration merging 添加自定义消息类型（如 `bashExecution`、`custom`、`compactionSummary`），再通过 `convertToLlm` 函数桥接到 LLM 可理解的标准消息。

### tool / kit / skill

**Tool**：基于 TypeBox schema 定义，核心接口：

```typescript
interface AgentTool<TParameters extends TSchema, TDetails> extends Tool<TParameters> {
  name: string;
  label: string;           // UI 显示名
  description: string;
  parameters: TParameters; // TypeBox schema
  executionMode?: "sequential" | "parallel";
  execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>;
}
```

**Skill**：遵循 [Agent Skills 标准](https://agentskills.io/)，是目录中包含 `SKILL.md` 的能力包。Skill 通过 frontmatter（name/description）描述，内容是指令和脚本。系统 prompt 中只包含 skill 列表（XML 格式），模型按需通过 `read` 工具加载完整内容——**渐进式披露**设计。

**Kit**：PI 没有显式的 "kit" 抽象，但 `coding-agent` 的 `createCodingTools()`、`createReadOnlyTools()` 等工厂函数组合了相关工具，可视为 kit 的等价物。

### workflow / state / context

PI **没有内置 workflow 引擎**。workflow 通过以下机制组合：

- **Agent loop**：`prompt()` -> LLM 响应 -> 工具执行 -> 自动 follow-up -> ... -> `agent_end`
- **Steering/Follow-up**：运行时消息队列，支持中断和追加
- **Extensions**：通过事件钩子拦截任意生命周期点
- **Session branching/forking**：会话树导航，支持分支摘要

**Context 管理**：

```
AgentMessage[] → transformContext() → AgentMessage[] → convertToLlm() → Message[] → LLM
```

- `transformContext`：可选，用于 pruning、compaction、注入外部上下文
- `convertToLlm`：必须，将 AgentMessage 过滤/转换为 LLM 可理解的消息

## 4. 核心 API

### 创建 agent

最小代码示例（直接使用 agent-core）：

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model: getModel("anthropic", "claude-sonnet-4-20250514"),
  },
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Hello!");
```

通过 coding-agent SDK：

```typescript
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});
await session.prompt("What files are here?");
```

### 注册工具

直接设置 agent state：

```typescript
agent.state.tools = [readFileTool, bashTool];
```

或通过 Extension API：

```typescript
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "Does something useful",
  parameters: Type.Object({ input: Type.String() }),
  execute: async (toolCallId, params, signal, onUpdate) => ({
    content: [{ type: "text", text: "result" }],
    details: {},
  }),
});
```

### 多步流程

PI 没有显式的 "workflow" DSL。多步流程通过以下方式实现：

1. **自动工具循环**：Agent 自动处理 LLM 响应中的 tool calls，执行工具后将结果回传给 LLM，循环直到没有 tool calls
2. **Steering**：`agent.steer({ role: "user", content: "Stop! Do this instead." })` 在运行时注入消息
3. **Follow-up**：`agent.followUp()` 在当前工作完成后追加消息
4. **Extensions**：通过 `beforeToolCall`/`afterToolCall` 钩子拦截和修改行为
5. **自定义 loop**：使用低级别 `agentLoop()` / `agentLoopContinue()` 直接控制

### 上下文管理

- **System prompt**：每次 LLM 调用都附带
- **Messages**：`agent.state.messages` 维护完整对话历史
- **transformContext**：在每次 LLM 调用前执行，用于 pruning/compaction
- **convertToLlm**：将 AgentMessage（含自定义类型）转换为标准 LLM Message
- **Session persistence**：`SessionManager` 将对话持久化为 JSONL 文件

## 5. 已支持的能力

### 内置工具

Coding agent 提供 7 个内置工具：

| 工具 | 功能 |
|------|------|
| `read` | 读取文件内容（支持行范围、图片） |
| `bash` | 执行 shell 命令（支持超时、工作目录） |
| `edit` | 编辑文件（基于 diff 的精确修改） |
| `write` | 写入/创建文件 |
| `grep` | 文本搜索（基于 rg） |
| `find` | 文件查找（基于 fd） |
| `ls` | 目录列表 |

工具可通过 `tools: ["read", "bash"]` 选项选择性启用，也支持 read-only 模式。

### 可扩展性

- **自定义工具**：通过 Extension API `pi.registerTool()` 注册
- **自定义 Provider**：通过 `pi.registerProvider()` 注册（支持自定义 baseUrl、OAuth、stream handler）
- **Extensions**：TypeScript 模块，可订阅 20+ 事件类型、注册命令/快捷键/CLI flag
- **Skills**：Markdown 能力包，渐进式加载
- **Prompt Templates**：文件化 prompt 模板

### MCP 支持

**PI 明确不支持内置 MCP**。README 中写道："No MCP. Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support."

MCP 可通过 Extension 自行实现，但框架本身不提供。

## 6. 上下文管理 / 状态机制

### Messages 管理

- `AgentMessage` 是可扩展联合类型（`user | assistant | toolResult | custom types`）
- 通过 declaration merging 扩展自定义消息类型
- `convertToLlm` 负责在 LLM 调用前过滤和转换

### Context Compaction（上下文压缩）

PI 有成熟的自动 compaction 机制：

- **触发条件**：`contextTokens > contextWindow - reserveTokens`（默认 reserve 16k）
- **过程**：
  1. 从最新消息反向遍历，保留最近 20k tokens
  2. 对旧消息调用 LLM 生成结构化摘要
  3. 将摘要保存为 `CompactionEntry`
  4. 重新加载会话，摘要 + 保留消息构成新上下文
- **手动触发**：`/compact [instructions]`
- **扩展钩子**：`session_before_compact` 事件允许扩展自定义 compaction 逻辑

### 持久化 / Checkpoint

- **Session persistence**：对话保存为 JSONL 文件（`SessionEntry` 序列化）
- **Session branching**：支持 fork 会话树，分支间通过 `BranchSummaryEntry` 传递上下文
- **Session switching**：可切换、恢复、导入/导出会话
- **Custom entries**：扩展可通过 `appendEntry()` 持久化自定义状态

## 7. workflow / step 概念

PI **没有内置 workflow/step 抽象**。其执行模型是：

```
prompt() → agent_start → turn_start → message_start (user) → message_end
         → message_start (assistant) → message_update... → message_end
         → [tool_execution_start → tool_execution_end]...
         → turn_end
         → [steering/follow-up check]
         → [next turn or agent_end]
```

一个 **turn** = 一次 LLM 调用 + 该响应触发的所有工具执行。

**失败/重试**：
- 工具失败：throw error，agent 自动将错误作为 tool result 回传
- 运行失败：`continue()` 从当前上下文重试
- `shouldStopAfterTurn`：可在每 turn 后决定是否优雅停止

**分支**：通过 session forking 实现，不是 workflow 分支。

## 8. 多 agent 协同支持

### Sub-agent

**PI 明确不支持内置 sub-agent**。README："No sub-agents. There's many ways to do this. Spawn pi instances via tmux, or build your own with extensions."

### ACP / Agent Communication Protocol

PI **没有 ACP 概念**。Agent 之间没有内置通信机制。

### 可能的协同方式

- **多进程**：通过 tmux 或 RPC 模式启动多个 pi 实例
- **Extension 模拟**：在一个 agent 中通过 Extension 注册多个 "角色" 工具
- **EventBus**：扩展间通过共享 event bus 通信（`pi.events`）
- **Session forking**：一个会话可 fork 出分支，但分支间不自动通信

## 9. 跨场景适用性验证

### 用户说法验证

用户说 "PI 不只是 coding"——这个说法**部分成立，但需要澄清**：

1. **`pi-agent-core`（底层）确实是通用的**：`Agent` 类只依赖 `systemPrompt`、`model`、`tools`、`messages`，没有任何 coding 特定逻辑。理论上可支撑任何 agent 场景。

2. **`pi-coding-agent`（上层）是 coding 专用的**：
   - 系统 prompt 硬编码为 "You are an expert coding assistant operating inside pi, a coding agent harness"
   - 默认工具全是文件/代码操作（read/bash/edit/write/grep/find/ls）
   - `buildSystemPrompt()` 函数内置 coding 相关 guidelines
   - 工具定义、skill 发现、session 格式都围绕代码工作流设计

3. **非 coding 用例需要重新包装**：
   - 需要替换 `buildSystemPrompt()` 中的 coding 特定 prompt
   - 需要替换/补充非 coding 工具
   - 需要重新设计 skill 发现逻辑

### 现有非 coding 用例

SDK examples 中**没有**非 coding 示例，全部围绕文件操作和代码任务。但扩展示例中有一些接近非 coding 的场景：

- `brave-search/` skill — Web 搜索
- `browser-automation/` skill — 浏览器自动化
- `google-apis/` skill — Google API 调用
- `transcription/` skill — 语音转录

这些仍属于"工具型"任务，而非"内容创作"或"数据分析"等纯认知型任务。

## 10. 与 harness-kit 目标的契合度

| 目标 | PI 已支持 | 需在外面包一层 | 备注 |
|---|---|---|---|
| workflow 稳定执行 | 部分 | 是 | Agent loop 稳定，但无显式 workflow DSL、无 step 重试/分支/超时控制 |
| ACP / 多 agent 协同 | 否 | 是 | 明确不支持 sub-agent，无 ACP，需完全自建 |
| 事实确认 | 否 | 是 | 无内置事实确认/验证机制，需通过 Extension 实现 |

**天然优势**：

1. **极简核心**：`pi-agent-core` 只有 ~500 行（Agent 类）+ ~400 行（agent-loop），易于理解和扩展
2. **统一 LLM API**：`pi-ai` 支持 20+ provider，模型切换、跨 provider handoff 开箱即用
3. **可扩展架构**：Extension 系统覆盖 20+ 生命周期事件，几乎可在任意点插入自定义逻辑
4. **上下文管理**：compaction、branching、session persistence 机制成熟
5. **TypeScript 生态**：与 harness-kit 技术栈一致

**缺口（harness-kit 需要补的层）**：

1. **Workflow 层**：PI 只有 turn 级别的 loop，没有 step/phase/task 级别的 workflow 抽象。需要构建 workflow DSL 或编程模型。
2. **ACP 层**：PI 没有 agent 间通信协议。需要设计并实现 ACP（消息格式、状态传递、发现机制）。
3. **事实确认层**：PI 没有内置的 fact-checking、self-verification、grounding 机制。需要添加。
4. **非 coding 适配**：需要抽象掉 coding-agent 中的 coding-specific 假设（系统 prompt、默认工具、skill 格式）。
5. **MCP 桥接**：如果 harness-kit 需要 MCP 支持，需要自建 bridge（PI 明确不内置）。

## 11. 风险与限制

### 性能瓶颈 / 上下文窗口策略

- **Compaction 依赖 LLM 调用**：自动 compaction 需要额外调用 LLM 生成摘要，增加延迟和成本
- **Token 估算**：使用启发式估算（非精确 tokenizer），可能在边界情况误判
- **Context 上限**：由底层模型决定，PI 通过 compaction 缓解但无法突破物理限制

### 文档完整度

- **优点**：每个 package 有独立 README，coding-agent 有 20+ 篇 docs，13 个 SDK 示例
- **缺点**：
  - `pi-agent-core` 的 README 较简洁，高级用法（如自定义 convertToLlm）需要读源码
  - Extension API 文档分散在 types.ts 和示例中，没有完整 API 参考
  - 无架构设计文档，理解整体需要读多文件

### 维护活跃度

- **非常活跃**：最新 commit 为 2026-05-02（当天），版本 v0.72.0
- 发布节奏快（patch/minor 频繁），有 CI/CD、changelog、贡献者管理流程
- 但新 issue/PR 默认自动关闭，社区门槛较高

### License

- **MIT License** — 可自由使用、修改、商用

## 12. 一句话总结

PI 是一个**极简但高度可扩展的 TypeScript Agent 框架**，底层 `pi-agent-core` 通用且干净，但上层 `pi-coding-agent` 深度绑定 coding 场景；harness-kit 若基于 PI 构建，可直接复用其 LLM 统一层和 Extension 事件系统，但需要在其之上**新建 workflow 引擎、ACP 通信层和事实确认机制**——PI 提供了坚实的地基，但上层建筑需要自行搭建。
