# Pi Agent Harness API 文档

## ExtensionAPI 接口

ExtensionAPI 是扩展与 Pi 框架交互的主要接口，通过 `pi` 对象暴露给扩展工厂函数。

### 事件订阅

```typescript
interface ExtensionAPI {
  // 资源发现
  on("resources_discover", handler): void;

  // 会话生命周期
  on("session_start", handler): void;
  on("session_before_switch", handler): void;
  on("session_before_fork", handler): void;
  on("session_shutdown", handler): void;

  // 压缩与导航
  on("session_before_compact", handler): void;
  on("session_compact", handler): void;
  on("session_before_tree", handler): void;
  on("session_tree", handler): void;

  // Agent 生命周期
  on("before_agent_start", handler): void;
  on("agent_start", handler): void;
  on("agent_end", handler): void;
  on("turn_start", handler): void;
  on("turn_end", handler): void;

  // 消息流
  on("message_start", handler): void;
  on("message_update", handler): void;
  on("message_end", handler): void;

  // 工具执行
  on("tool_execution_start", handler): void;
  on("tool_execution_update", handler): void;
  on("tool_execution_end", handler): void;
  on("tool_call", handler): void;     // 可拦截/阻塞
  on("tool_result", handler): void;   // 可修改结果

  // Provider 钩子
  on("context", handler): void;                    // 修改上下文消息
  on("before_provider_request", handler): void;    // 修改请求选项
  on("after_provider_response", handler): void;    // 响应后处理

  // 模型与思考
  on("model_select", handler): void;
  on("thinking_level_select", handler): void;

  // 用户输入
  on("user_bash", handler): void;
  on("input", handler): void;
}
```

### 工具注册

```typescript
interface ExtensionAPI {
  registerTool<TParams extends TSchema, TDetails, TState>(
    tool: ToolDefinition<TParams, TDetails, TState>
  ): void;
}

interface ToolDefinition<TParams, TDetails, TState> {
  name: string;           // LLM 调用名
  label: string;          // UI 显示标签
  description: string;    // LLM 可见描述
  promptSnippet?: string; // 系统提示中的工具说明
  promptGuidelines?: string[]; // 系统提示附加指南
  parameters: TParams;    // TypeBox 参数模式
  renderShell?: "default" | "self"; // 渲染框架选择
  prepareArguments?: (args: unknown) => Static<TParams>; // 参数预处理
  executionMode?: "sequential" | "parallel"; // 执行模式
  execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>>;
  renderCall?(args, theme, context): Component;      // 自定义调用渲染
  renderResult?(result, options, theme, context): Component; // 自定义结果渲染
}
```

### 命令/快捷键/Flag 注册

```typescript
interface ExtensionAPI {
  registerCommand(name: string, options: {
    description?: string;
    getArgumentCompletions?: (prefix) => AutocompleteItem[] | null;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  }): void;

  registerShortcut(shortcut: KeyId, options: {
    description?: string;
    handler: (ctx: ExtensionContext) => Promise<void> | void;
  }): void;

  registerFlag(name: string, options: {
    description?: string;
    type: "boolean" | "string";
    default?: boolean | string;
  }): void;

  getFlag(name: string): boolean | string | undefined;
}
```

### Provider 注册

```typescript
interface ExtensionAPI {
  registerProvider(name: string, config: ProviderConfig): void;
  unregisterProvider(name: string): void;
}

interface ProviderConfig {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: Api;
  streamSimple?: StreamFunction;  // 自定义流处理器
  headers?: Record<string, string>;
  authHeader?: boolean;
  models?: ProviderModelConfig[];
  oauth?: OAuthConfig;
}
```

### UI 交互

```typescript
interface ExtensionUIContext {
  select(title, options, opts?): Promise<string | undefined>;
  confirm(title, message, opts?): Promise<boolean>;
  input(title, placeholder?, opts?): Promise<string | undefined>;
  notify(message, type?): void;
  setStatus(key, text?): void;
  setWorkingMessage(message?): void;
  setWorkingVisible(visible): void;
  setWidget(key, content?, options?): void;
  setFooter(factory?): void;
  setHeader(factory?): void;
  setTitle(title): void;
  custom<T>(factory, options?): Promise<T>;
  pasteToEditor(text): void;
  setEditorText(text): void;
  getEditorText(): string;
  editor(title, prefill?): Promise<string | undefined>;
  addAutocompleteProvider(factory): void;
  setEditorComponent(factory?): void;
  readonly theme: Theme;
  getAllThemes(): { name, path }[];
  getTheme(name): Theme | undefined;
  setTheme(theme): { success, error? };
}
```

### 扩展上下文

```typescript
interface ExtensionContext {
  ui: ExtensionUIContext;
  hasUI: boolean;
  cwd: string;
  sessionManager: ReadonlySessionManager;
  modelRegistry: ModelRegistry;
  model: Model<any> | undefined;
  isIdle(): boolean;
  signal: AbortSignal | undefined;
  abort(): void;
  hasPendingMessages(): boolean;
  shutdown(): void;
  getContextUsage(): ContextUsage | undefined;
  compact(options?): void;
  getSystemPrompt(): string;
}

interface ExtensionCommandContext extends ExtensionContext {
  waitForIdle(): Promise<void>;
  newSession(options?): Promise<{ cancelled }>;
  fork(entryId, options?): Promise<{ cancelled }>;
  navigateTree(targetId, options?): Promise<{ cancelled }>;
  switchSession(sessionPath, options?): Promise<{ cancelled }>;
  reload(): Promise<void>;
}
```

## Agent 类 API

`Agent` 是低层级的有状态包装器，围绕 Agent 循环提供生命周期管理和事件发射。

### 构造选项

```typescript
interface AgentOptions {
  initialState?: Partial<AgentState>;     // 初始状态
  convertToLlm?: (messages) => Message[]; // 消息转换
  transformContext?: (messages, signal?) => Promise<AgentMessage[]>; // 上下文变换
  streamFn?: StreamFn;                     // 自定义流函数
  getApiKey?: (provider) => string;        // 动态 API Key 解析
  onPayload?: OnPayloadCallback;           // Payload 回调
  onResponse?: OnResponseCallback;         // 响应回调
  beforeToolCall?: (context, signal?) => Promise<BeforeToolCallResult>; // 工具前置钩子
  afterToolCall?: (context, signal?) => Promise<AfterToolCallResult>;   // 工具后置钩子
  prepareNextTurn?: (signal?) => Promise<AgentLoopTurnUpdate>; // 回合准备
  steeringMode?: QueueMode;                // steering 队列模式
  followUpMode?: QueueMode;                // follow-up 队列模式
  sessionId?: string;                      // 会话 ID（用于缓存）
  thinkingBudgets?: ThinkingBudgets;       // 思考预算
  transport?: Transport;                   // 传输协议
  maxRetryDelayMs?: number;                // 最大重试延迟
  toolExecution?: ToolExecutionMode;       // 工具执行模式
}
```

### 核心方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `prompt` | `prompt(message \| messages): Promise<void>`<br>`prompt(text, images?): Promise<void>` | 启动新提示 |
| `continue` | `continue(): Promise<void>` | 从当前上下文继续 |
| `steer` | `steer(message): void` | 向 steering 队列添加消息 |
| `followUp` | `followUp(message): void` | 向 follow-up 队列添加消息 |
| `abort` | `abort(): void` | 中止当前运行 |
| `waitForIdle` | `waitForIdle(): Promise<void>` | 等待当前运行完成 |
| `reset` | `reset(): void` | 重置所有状态 |
| `subscribe` | `subscribe(listener): () => void` | 订阅生命周期事件 |

### 状态属性

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

## AgentHarness 事件钩子

`AgentHarness` 在 `Agent` 之上提供更丰富的生命周期钩子，分为两类：

### 通配订阅（subscribe）

接收所有事件（AgentEvent + AgentHarnessOwnEvent）：

```typescript
harness.subscribe((event, signal) => {
  // 处理所有事件
});
```

### 类型化钩子（on）

按事件类型注册，可返回结果影响行为：

| 事件类型 | 返回类型 | 用途 |
|---------|---------|------|
| `before_agent_start` | `{ messages?, systemPrompt? }` | 修改初始消息/系统提示 |
| `context` | `{ messages }` | 修改发送给 LLM 的上下文 |
| `before_provider_request` | `{ streamOptions? }` | 修改 Provider 请求选项 |
| `before_provider_payload` | `{ payload }` | 修改/替换请求 Payload |
| `after_provider_response` | `undefined` | 响应后处理 |
| `tool_call` | `{ block?, reason? }` | 拦截工具执行 |
| `tool_result` | `{ content?, details?, isError?, terminate? }` | 修改工具结果 |
| `session_before_compact` | `{ cancel?, compaction? }` | 拦截/自定义压缩 |
| `session_compact` | `undefined` | 压缩后处理 |
| `session_before_tree` | `{ cancel?, summary?, label? }` | 拦截/自定义树导航 |
| `session_tree` | `undefined` | 树导航后处理 |
| `model_select` | `undefined` | 模型切换通知 |
| `thinking_level_select` | `undefined` | 思考级别切换通知 |
| `resources_update` | `undefined` | 资源更新通知 |

### 队列事件

| 事件类型 | 说明 |
|---------|------|
| `queue_update` | steering/followUp/nextTurn 队列状态变化 |
| `save_point` | 回合结束，会话写入已刷新 |
| `abort` | 运行被中止 |
| `settled` | Agent 完全空闲 |

## Provider 注册表 API

```typescript
// 注册 Provider
registerApiProvider<TApi, TOptions>(provider: ApiProvider<TApi, TOptions>, sourceId?: string): void;

// 获取 Provider
getApiProvider(api: Api): ApiProviderInternal | undefined;

// 获取所有 Provider
getApiProviders(): ApiProviderInternal[];

// 按 sourceId 注销
unregisterApiProviders(sourceId: string): void;

// 清空所有
clearApiProviders(): void;
```

### 内置 Provider

| API | Provider 文件 | 说明 |
|-----|--------------|------|
| `anthropic-messages` | `providers/anthropic.ts` | Anthropic Messages API |
| `openai-completions` | `providers/openai-completions.ts` | OpenAI Chat Completions |
| `openai-responses` | `providers/openai-responses.ts` | OpenAI Responses API |
| `openai-codex-responses` | `providers/openai-codex-responses.ts` | OpenAI Codex |
| `azure-openai-responses` | `providers/azure-openai-responses.ts` | Azure OpenAI |
| `mistral-conversations` | `providers/mistral.ts` | Mistral API |
| `google-generative-ai` | `providers/google.ts` | Google Gemini |
| `google-vertex` | `providers/google-vertex.ts` | Google Vertex AI |
| `bedrock-converse-stream` | `providers/amazon-bedrock.ts` | AWS Bedrock |

## Result<T, E> 模式

显式错误处理，替代 try/catch 控制流：

```typescript
type Result<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

// 构造
function ok<T, E>(value: T): Result<T, E>;
function err<T, E>(error: E): Result<T, E>;

// 解包
function getOrThrow<T, E>(result: Result<T, E>): T;
function getOrUndefined<T extends object, E>(result: Result<T, E>): T | undefined;

// 错误转换
function toError(error: unknown): Error;
```

### 使用示例

```typescript
const result = prepareCompaction(entries, settings);
if (!result.ok) {
  // 处理错误
  throw result.error;
}
const preparation = result.value; // CompactionPreparation
```

### 错误类型层次

```
AgentHarnessError
├── code: "busy" | "invalid_state" | "invalid_argument" | "session" | "hook" | "auth" | "compaction" | "branch_summary" | "unknown"
├── cause?: Error

SessionError
├── code: "not_found" | "invalid_session" | "invalid_entry" | "invalid_fork_target" | "storage" | "unknown"

CompactionError
├── code: "aborted" | "summarization_failed" | "invalid_session" | "unknown"

BranchSummaryError
├── code: "aborted" | "summarization_failed" | "invalid_session"

FileError
├── code: "aborted" | "not_found" | "permission_denied" | ...

ExecutionError
├── code: "aborted" | "timeout" | "shell_unavailable" | ...
```

## 会话树 Entry 类型

```typescript
type SessionTreeEntry =
  | MessageEntry              // 对话消息
  | ThinkingLevelChangeEntry  // 思考级别变更
  | ModelChangeEntry          // 模型切换
  | CompactionEntry           // 压缩摘要
  | BranchSummaryEntry        // 分支摘要
  | CustomEntry               // 扩展自定义数据
  | CustomMessageEntry        // 扩展自定义消息
  | LabelEntry                // 书签标签
  | SessionInfoEntry          // 会话信息
  | LeafEntry;                // 叶子指针

interface SessionTreeEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}
```

### Entry 类型详解

| 类型 | 关键字段 | 参与 LLM 上下文 |
|------|---------|---------------|
| `message` | `message: AgentMessage` | 是 |
| `thinking_level_change` | `thinkingLevel: string` | 否（影响配置） |
| `model_change` | `provider, modelId` | 否（影响配置） |
| `compaction` | `summary, firstKeptEntryId, tokensBefore` | 是（转为 summary 消息） |
| `branch_summary` | `fromId, summary` | 是（转为 summary 消息） |
| `custom` | `customType, data` | 否 |
| `custom_message` | `customType, content, display` | 是（如 display=true） |
| `label` | `targetId, label` | 否 |
| `session_info` | `name` | 否 |
| `leaf` | `targetId` | 否（指针） |
