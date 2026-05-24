# pi-mono API 参考

## 1. AgentSession API

`AgentSession` 是 pi-coding-agent 的核心编排类，封装了代理状态、事件订阅、会话持久化、模型管理、压缩和扩展集成。

### 构造

```typescript
interface AgentSessionConfig {
  agent: Agent;                          // pi-agent-core 的 Agent 实例
  sessionManager: SessionManager;        // 会话持久化管理器
  settingsManager: SettingsManager;      // 用户设置管理器
  cwd: string;                           // 当前工作目录
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
  resourceLoader: ResourceLoader;        // 技能、提示模板、主题加载器
  customTools?: ToolDefinition[];        // SDK 自定义工具
  modelRegistry: ModelRegistry;          // 模型注册表（API Key 解析）
  initialActiveToolNames?: string[];     // 初始激活工具（默认 [read, bash, edit, write]）
  allowedToolNames?: string[];           // 工具白名单
  baseToolsOverride?: Record<string, AgentTool>; // 覆盖基础工具
}

class AgentSession {
  constructor(config: AgentSessionConfig);
}
```

### 核心方法

#### prompt — 发送用户消息

```typescript
async prompt(text: string, options?: PromptOptions): Promise<void>

interface PromptOptions {
  expandPromptTemplates?: boolean;   // 是否展开文件提示模板（默认 true）
  images?: ImageContent[];           // 图片附件
  streamingBehavior?: "steer" | "followUp"; // 流式时的队列策略
  source?: InputSource;              // 输入来源（interactive/rpc/extension）
}
```

处理流程：
1. 检查扩展命令（`/command`）并立即执行
2. 触发 `input` 扩展事件（可被拦截或转换）
3. 展开技能命令（`/skill:name`）和提示模板
4. 流式时通过 `steer()` 或 `followUp()` 入队
5. 验证模型和 API Key
6. 检查是否需要自动压缩
7. 触发 `before_agent_start` 扩展事件
8. 调用 `agent.prompt()`

#### steer —  steering 消息

```typescript
async steer(text: string, images?: ImageContent[]): Promise<void>
```

在当前助手回合完成后注入消息，用于"引导"正在工作的代理。不支持扩展命令。

#### followUp — 后续消息

```typescript
async followUp(text: string, images?: ImageContent[]): Promise<void>
```

在代理即将停止时注入消息，用于后续跟进。不支持扩展命令。

#### abort — 中止

```typescript
async abort(): Promise<void>
```

中止当前操作并等待代理进入空闲状态。

#### compact — 手动压缩

```typescript
async compact(customInstructions?: string): Promise<CompactionResult>
```

手动压缩会话上下文。会中止当前代理操作，生成历史摘要，丢弃旧消息。

```typescript
interface CompactionResult<T = unknown> {
  summary: string;           // 生成的摘要
  firstKeptEntryId: string;  // 保留的第一条条目 ID
  tokensBefore: number;      // 压缩前的 token 数
  details?: T;               // 扩展特定数据
}
```

### 模型管理

```typescript
async setModel(model: Model<any>): Promise<void>           // 设置模型
async cycleModel(direction?: "forward" | "backward"): Promise<ModelCycleResult | undefined>
setThinkingLevel(level: ThinkingLevel): void               // 设置思考级别
getAvailableThinkingLevels(): ThinkingLevel[]              // 获取可用思考级别
```

### 工具管理

```typescript
getActiveToolNames(): string[]        // 获取当前激活工具名
getAllTools(): ToolInfo[]             // 获取所有工具信息
setActiveToolsByName(toolNames: string[]): void  // 设置激活工具
```

### 事件订阅

```typescript
type AgentSessionEvent =
  | AgentEvent                                    // 核心代理事件
  | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | { type: "compaction_end"; reason: "manual" | "threshold" | "overflow"; result?: CompactionResult; aborted: boolean; willRetry: boolean; errorMessage?: string }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | { type: "session_info_changed"; name: string | undefined }
  | { type: "thinking_level_changed"; level: ThinkingLevel };

subscribe(listener: AgentSessionEventListener): () => void
```

### 会话导航

```typescript
async navigateTree(
  targetId: string,
  options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string }
): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }>
```

在会话树中导航到指定节点。可选生成被放弃分支的摘要。

---

## 2. Agent 类 API

`Agent` 是 pi-agent-core 提供的有状态包装器，围绕底层 `runAgentLoop` 构建。

### 构造

```typescript
interface AgentOptions {
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  beforeToolCall?: BeforeToolCallHandler;
  afterToolCall?: AfterToolCallHandler;
  steeringMode?: QueueMode;      // "all" | "one-at-a-time"
  followUpMode?: QueueMode;
  sessionId?: string;
  thinkingBudgets?: ThinkingBudgets;
  transport?: Transport;
  maxRetryDelayMs?: number;
  toolExecution?: ToolExecutionMode;  // "sequential" | "parallel"
}

class Agent {
  constructor(options?: AgentOptions);
}
```

### 核心方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `prompt` | `prompt(message: AgentMessage \| AgentMessage[]): Promise<void>` | 启动新提示 |
| `prompt` | `prompt(input: string, images?: ImageContent[]): Promise<void>` | 字符串快捷方式 |
| `continue` | `continue(): Promise<void>` | 从当前上下文继续 |
| `steer` | `steer(message: AgentMessage): void` | 入队 steering 消息 |
| `followUp` | `followUp(message: AgentMessage): void` | 入队 follow-up 消息 |
| `abort` | `abort(): void` | 中止当前运行 |
| `waitForIdle` | `waitForIdle(): Promise<void>` | 等待当前运行完成 |
| `reset` | `reset(): void` | 重置状态 |
| `subscribe` | `subscribe(listener): () => void` | 订阅事件 |

### 状态访问

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

### 队列模式

```typescript
type QueueMode = "all" | "one-at-a-time";
```

- `"all"`：一次性排空所有队列消息
- `"one-at-a-time"`：每次只处理一条消息（默认）

---

## 3. Agent Loop API

底层函数，直接操作事件流。

```typescript
// 启动新循环（带提示消息）
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]>;

// 继续现有上下文
export function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]>;

// 底层异步实现
export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]>;

export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]>;
```

### AgentLoopConfig

```typescript
interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
  toolExecution?: ToolExecutionMode;
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}
```

---

## 4. ExtensionAPI

扩展通过 `ExtensionAPI`（通常命名为 `pi`）与系统交互。

### 事件订阅

```typescript
pi.on("session_start", handler);
pi.on("agent_start", handler);
pi.on("agent_end", handler);
pi.on("turn_start", handler);
pi.on("turn_end", handler);
pi.on("message_start", handler);
pi.on("message_update", handler);
pi.on("message_end", handler);
pi.on("tool_execution_start", handler);
pi.on("tool_execution_end", handler);
pi.on("tool_call", handler);        // 可拦截工具调用
pi.on("tool_result", handler);      // 可修改工具结果
pi.on("input", handler);            // 可拦截用户输入
pi.on("context", handler);          // 可修改 LLM 上下文
pi.on("before_provider_request", handler);  // 可修改请求 payload
pi.on("after_provider_response", handler);  // 响应后处理
pi.on("model_select", handler);
pi.on("thinking_level_select", handler);
pi.on("user_bash", handler);
pi.on("session_before_compact", handler);   // 可取消或替代压缩
pi.on("session_compact", handler);
pi.on("session_before_tree", handler);      // 可取消或替代分支摘要
pi.on("session_tree", handler);
```

### 工具注册

```typescript
pi.registerTool<TParams extends TSchema, TDetails, TState>({
  name: string;           // LLM 调用名
  label: string;          // UI 显示名
  description: string;    // LLM 描述
  parameters: TParams;    // TypeBox 参数模式
  promptSnippet?: string; // 系统提示中的工具摘要
  promptGuidelines?: string[]; // 系统提示中的指导原则
  renderShell?: "default" | "self"; // 渲染框架控制
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: "sequential" | "parallel";
  execute: (toolCallId, params, signal, onUpdate, ctx) => Promise<AgentToolResult<TDetails>>;
  renderCall?: (args, theme, context) => Component;      // 自定义调用渲染
  renderResult?: (result, options, theme, context) => Component; // 自定义结果渲染
});
```

### 命令/快捷键/Flag 注册

```typescript
pi.registerCommand(name, {
  description?: string;
  getArgumentCompletions?: (prefix) => AutocompleteItem[] | null;
  handler: (args, ctx: ExtensionCommandContext) => Promise<void>;
});

pi.registerShortcut(shortcut: KeyId, {
  description?: string;
  handler: (ctx: ExtensionContext) => Promise<void> | void;
});

pi.registerFlag(name, {
  description?: string;
  type: "boolean" | "string";
  default?: boolean | string;
});

pi.getFlag(name): boolean | string | undefined;
```

### Provider 注册

```typescript
pi.registerProvider(name: string, config: ProviderConfig);
pi.unregisterProvider(name: string);
```

### 消息操作

```typescript
pi.sendMessage(message, { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" });
pi.sendUserMessage(content, { deliverAs?: "steer" | "followUp" });
pi.appendEntry(customType, data);  // 持久化扩展状态（不发送给 LLM）
```

### 会话控制（仅 ExtensionCommandContext）

```typescript
ctx.newSession(options);     // 创建新会话
ctx.fork(entryId, options);  // 从指定条目分叉
ctx.navigateTree(targetId, options); // 树导航
ctx.switchSession(sessionPath, options); // 切换会话文件
ctx.reload();                // 重载扩展
```

---

## 5. pi-ai 流式 API

### 核心函数

```typescript
// 完整流式接口（支持 Provider 特定选项）
export function stream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): AssistantMessageEventStream;

// 简化流式接口（统一选项）
export function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream;

// 非流式完成
export async function complete<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): Promise<AssistantMessage>;

export async function completeSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage>;
```

### 上下文结构

```typescript
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}
```

### 流式选项

```typescript
interface SimpleStreamOptions extends StreamOptions {
  reasoning?: ThinkingLevel;        // "minimal" | "low" | "medium" | "high" | "xhigh"
  thinkingBudgets?: ThinkingBudgets; // 各级别 token 预算
}

interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  transport?: "sse" | "websocket" | "websocket-cached" | "auto";
  cacheRetention?: "none" | "short" | "long";
  sessionId?: string;
  onPayload?: (payload, model) => unknown | undefined;
  onResponse?: (response, model) => void;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  metadata?: Record<string, unknown>;
}
```

### 事件流协议

```typescript
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

### EventStream 类

```typescript
class EventStream<T, R = T> implements AsyncIterable<T> {
  push(event: T): void;
  end(result?: R): void;
  result(): Promise<R>;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {}
```

---

## 6. AgentTool<TSchema> 与 TypeBox

工具定义使用 TypeBox 进行运行时类型验证。

```typescript
import { Type, type Static } from "typebox";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
});

export type BashToolInput = Static<typeof bashSchema>;

const bashTool: AgentTool<typeof bashSchema> = {
  name: "bash",
  description: "Execute bash commands",
  label: "Bash",
  parameters: bashSchema,
  execute: async (toolCallId, params, signal, onUpdate) => {
    // params.command 已类型安全验证
    const result = await runCommand(params.command);
    return {
      content: [{ type: "text", text: result.output }],
      details: { exitCode: result.exitCode },
    };
  },
};
```

### AgentTool 接口

```typescript
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
  executionMode?: "sequential" | "parallel";
}

interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  terminate?: boolean;  // 为 true 时提示代理停止
}

type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;
```

---

## 7. 会话树条目类型

```typescript
// 基础接口
type SessionEntry =
  | SessionMessageEntry      // 标准消息
  | ThinkingLevelChangeEntry // 思考级别变更
  | ModelChangeEntry         // 模型变更
  | CompactionEntry          // 压缩条目
  | BranchSummaryEntry       // 分支摘要
  | CustomEntry              // 扩展自定义数据
  | CustomMessageEntry       // 扩展自定义消息
  | LabelEntry               // 书签标记
  | SessionInfoEntry;        // 会话信息

// 消息条目
interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

// 压缩条目
interface CompactionEntry<T = unknown> extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;  // true = 扩展生成
}

// 分支摘要条目
interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
}

// 扩展自定义条目（不参与 LLM 上下文）
interface CustomEntry<T = unknown> extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}

// 扩展自定义消息（参与 LLM 上下文）
interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: T;
  display: boolean;
}
```

### 树结构基础

```typescript
interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;  // null = 根节点
  timestamp: string;
}
```

通过 `parentId` 链接形成树结构。`SessionManager` 维护当前 `leafId`，所有操作基于从根到叶子的路径。
