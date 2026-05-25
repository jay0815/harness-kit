# Phase 3: Standalone Runner — CLI Entry Point

## Context

Phase 1 完成了 agent runtime 核心（agent-loop、middleware、dual agent）。Phase 2 完成了 session 层（HarnessAgentSession、ExtensionAPI adapter）。Phase 3 目标：创建 CLI 入口，让 harness-kit 独立运行，不依赖 PI runtime。

**核心约束**：`@harness-kit/core` 依赖 `@harness-kit/agent`，如果 CLI 在 agent 包中需要加载 core，会形成循环依赖。解决方案：使用动态 `import("@harness-kit/core")`，core 作为 optional peerDependency。

## 新文件结构

```
packages/harness-agent/
├── src/
│   ├── cli.ts                    ← 入口点 (#!/usr/bin/env node)
│   ├── cli/
│   │   ├── args.ts               ← 参数解析（无依赖）
│   │   ├── config.ts             ← 配置解析 + streamFn 创建
│   │   ├── repl.ts               ← 交互式 prompt loop
│   │   └── output.ts             ← 终端输出格式化
│   ├── core/                     ← Phase 1（已有，需修改 agent-loop.ts）
│   ├── session/                  ← Phase 2（已有，需修改 event-bridge.ts）
│   └── index.ts                  ← 已有
├── package.json                  ← 修改：添加 bin、optional peerDeps
└── tsconfig.json                 ← 无变更
```

## 关键设计决策

1. **循环依赖解决** — CLI 在 agent 包中需要加载 core 的扩展函数，但 core 依赖 agent。使用非字面量动态 import 延迟解析，core 作为 optional peerDependency（不放 devDependencies，避免构建期类型解析循环）：
   ```typescript
   const packageName = "@harness-kit/core";
   const coreModule = await import(packageName) as {
     default?: (api: HarnessExtensionAPI) => void;
   };
   ```

2. **配置管理** — 环境变量（API key）+ 命令行参数（model、workspace）。解析优先级：CLI args > 环境变量 > 默认值。默认模型：`anthropic/claude-sonnet-4-20250514`。provider 和 model 必须校验：
   ```typescript
   let model: Model<any> | undefined;
   try {
     model = getModel(provider as any, modelId as any) as Model<any> | undefined;
   } catch {
     model = undefined;
   }
   if (!model) {
     const models = getModels(provider as any).map((m) => m.id);
     throw new Error(`Unknown model "${modelId}" for provider "${provider}". Available: ${models.join(", ")}`);
   }
   ```

3. **streamFn 创建** — 使用 `getModel(provider, modelId)` 和 `streamSimple` 从 `@earendil-works/pi-ai`，包装为 StreamFn：
   ```typescript
   const streamFn: StreamFn = (model, context, options) =>
     streamSimple(model, context, { ...options, apiKey });
   ```

4. **agent-loop.ts 修复** — 当前 `collectStream()` 使用旧 stream 事件协议（`for await (const event of stream)`），不能正确消费 `streamSimple()` 返回的 `AssistantMessageEventStream`。应改为使用 `stream.result()`：
   ```typescript
   async function collectStream(stream: any): Promise<LLMResponse> {
     const msg = await stream.result();
     const content = msg.content.map((c: any) =>
       c.type === "toolCall"
         ? { ...c, input: c.input ?? c.arguments }
         : c
     );
     return {
       content,
       stopReason: msg.stopReason,
       usage: msg.usage
         ? { inputTokens: msg.usage.input, outputTokens: msg.usage.output }
         : undefined,
     };
   }
   ```
   注意：tool call 应保留 arguments，额外补 input 兼容旧 mock/旧逻辑。确认 `stream.result()` 在 error/abort 时的行为，若 reject 需清晰抛出。

5. **event-bridge.ts 修复** — PI 风格事件中的 `tool_use.input` 应兼容 pi-ai 原生字段：
   ```typescript
   input: block.input ?? block.arguments
   ```

6. **DEFAULT_SYSTEM_PROMPT** — bare mode 下没有 core 注入系统提示词，必须有最小默认提示词：
   ```typescript
   const DEFAULT_SYSTEM_PROMPT = `You are a CLI coding assistant. Answer based on actual context. Do not pretend to execute operations you haven't performed.`;
   ```

7. **REPL 生命周期和并发控制** — repl.ts 需要包含：
   - `/exit` 正常退出
   - `session.shutdown()` 总会执行
   - `rl.close()` 总会执行
   - SIGINT/SIGTERM 行为明确，避免重复 handler 冲突
   - busy 锁，避免前一轮 `session.prompt()` 未完成时再次调用
   - `session.prompt()` 抛错后 REPL 不崩溃，回到提示符

8. **CLI 输出层** — `turn_end.message.content` 可能包含 text、thinking、tool_use。输出层应正确显示：
   - assistant text
   - 工具调用（name、args）
   - 工具执行开始/结束
   - 错误状态
   - 空响应应显示诊断，不能静默

9. **扩展加载** — 非字面量动态 import 避免编译期类型解析循环，失败时 graceful fallback：
   ```typescript
   try {
     const packageName = "@harness-kit/core";
     const coreModule = await import(packageName) as {
       default?: (api: HarnessExtensionAPI) => void;
     };
     if (coreModule.default) coreModule.default(session.extensionAPI);
   } catch {
     console.log("[harness-agent] @harness-kit/core not available, running in bare mode");
   }
   ```

## 实施步骤

### Step 1: 修 `core/agent-loop.ts` — collectStream() 使用 stream.result()

当前 `collectStream()` 使用 `for await (const event of stream)` 消费旧协议，改为使用 `stream.result()`：
```typescript
async function collectStream(stream: any): Promise<LLMResponse> {
  let msg: any;

  try {
    msg = await stream.result();
  } catch (err) {
    throw new Error(`LLM stream failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (msg.stopReason === "error" || msg.stopReason === "aborted") {
    const detail = msg.errorMessage ? ` - ${msg.errorMessage}` : "";
    throw new Error(`LLM response stopped: ${msg.stopReason}${detail}`);
  }

  const content = msg.content.map((c: any) =>
    c.type === "toolCall"
      ? { ...c, input: c.input ?? c.arguments }
      : c,
  );

  return {
    content,
    stopReason: msg.stopReason,
    usage: msg.usage
      ? { inputTokens: msg.usage.input, outputTokens: msg.usage.output }
      : undefined,
  };
}
```
注意：保留 arguments，额外补 input 兼容旧 mock。error/abort 时清晰抛出错误，不静默返回空响应。

### Step 2: 修 `session/event-bridge.ts` — input 兼容

`bridgeContentBlocks()` 中 tool_use.input 应兼容 pi-ai 原生字段：
```typescript
if (block?.type === "toolCall") {
  return {
    type: "tool_use",
    id: block.id,
    name: block.name,
    input: block.input ?? block.arguments,
  };
}
```

### Step 3: 修 `core/agent-loop.ts` — tool result message shape

当前 tool result message 使用 `role: "tool"`，但 pi-ai 的 ToolResultMessage 是 `role: "toolResult"`，并包含 `toolName`、`timestamp` 等字段。修复：
```typescript
messages.push({
  role: "toolResult",
  toolCallId: toolCalls[i].id,
  toolName: toolCalls[i].name,
  content: toolResults[i].content,
  details: toolResults[i].details,
  isError: toolResults[i].isError ?? false,
  timestamp: Date.now(),
} as any);
```

### Step 4: 补 runtime 测试

使用 `registerFauxProvider()` 或真实 AssistantMessageEventStream 验证：
- stream.result() 正确消费 AssistantMessageEventStream
- toolCall -> tool execution -> 第二轮 model response
- usage 映射
- stream error/abort
- toolCall.arguments 能桥接成 tool_use.input
- error/abort 不会静默变成空响应

注意：现有旧 mock async generator 测试需要更新，或者 collectStream() 临时保留 legacy fallback

### Step 5: `src/cli/args.ts` — 参数解析

手动解析，与 `packages/core/src/cli.ts` 风格一致。支持：
- `--provider <name>` — 模型提供者（默认 anthropic）
- `--model <id>` — 模型 ID（默认 claude-sonnet-4-20250514）
- `--workspace <dir>` — 工作目录（默认 cwd）
- `--system-prompt <text>` — 系统提示词
- `--max-iterations <n>` — 最大迭代次数
- `--no-extension` — 不加载 core 扩展
- `--help` — 显示帮助
- `--version` — 显示版本

### Step 6: `src/cli/config.ts` — 配置解析

使用 `getModel`、`getModels`、`getProviders`、`getEnvApiKey` 从 `@earendil-works/pi-ai`：
```typescript
import { resolve } from "node:path";
import { getModel, getModels, getProviders, getEnvApiKey, streamSimple } from "@earendil-works/pi-ai";

const DEFAULT_SYSTEM_PROMPT =
  "You are a CLI coding assistant. Answer based on actual context. Do not pretend to execute operations you haven't performed.";

const KEY_REQUIRED_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "deepseek",
  "groq",
  "xai",
  "openrouter",
]);

export function resolveConfig(args: ParsedArgs): HarnessAgentSessionConfig {
  // 校验 provider
  const providers = getProviders();
  if (!providers.includes(args.provider as any)) {
    throw new Error(`Unknown provider "${args.provider}". Available: ${providers.join(", ")}`);
  }

  // 校验 model（双重防御：try/catch + undefined check）
  let model: Model<any> | undefined;
  try {
    model = getModel(args.provider as any, args.model as any) as Model<any> | undefined;
  } catch {
    model = undefined;
  }
  if (!model) {
    const models = getModels(args.provider as any).map((m) => m.id);
    throw new Error(
      `Unknown model "${args.model}" for provider "${args.provider}". Available: ${models.join(", ")}`,
    );
  }

  // API key（只对明确需要 key 的 provider 提前报错）
  const apiKey = getEnvApiKey(args.provider);
  if (KEY_REQUIRED_PROVIDERS.has(args.provider) && !apiKey) {
    throw new Error(`No API key found for provider "${args.provider}".`);
  }

  const streamFn: StreamFn = (model, context, options) =>
    streamSimple(model, context, { ...options, apiKey });

  return {
    cwd: resolve(args.workspace),
    model,
    systemPrompt: args.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    streamFn,
    maxIterations: args.maxIterations,
  };
}
```

### Step 7: `src/cli/output.ts` — 终端输出格式化

处理事件显示：
- `turn_start` — 显示轮次索引
- `turn_end` — 显示 assistant text、工具调用（name、args）、工具执行状态、错误状态
- `tool_execution_start/end` — 显示工具执行状态
- `agent_end` — 显示完成信息
- 空响应应显示诊断，不能静默

至少支持：
- assistant text
- thinking 可选择隐藏或简短显示
- tool_use name 和 input
- tool start/end
- tool error
- empty response diagnostic

### Step 8: `src/cli/repl.ts` — 交互式 prompt loop

```typescript
import readline from "node:readline";
import { HarnessAgentSession } from "../session/harness-session.js";
import type {
  HarnessAgentSessionConfig,
  HarnessExtensionAPI,
} from "../session/types.js";
import * as output from "./output.js";

export async function startREPL(
  config: HarnessAgentSessionConfig,
  loadExtension: boolean,
): Promise<void> {
  const session = new HarnessAgentSession(config);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  let busy = false;
  let cleanedUp = false;

  let onSigint: (() => void) | undefined;
  let onSigterm: (() => void) | undefined;

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;

    if (onSigint) process.off("SIGINT", onSigint);
    if (onSigterm) process.off("SIGTERM", onSigterm);

    rl.close();
    await session.shutdown();
  };

  onSigint = () => {
    void cleanup()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  onSigterm = () => {
    void cleanup()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    // 可选加载 core 扩展（非字面量动态 import 避免编译期耦合）
    if (loadExtension) {
      try {
        const packageName = "@harness-kit/core";
        const coreModule = await import(packageName) as {
          default?: (api: HarnessExtensionAPI) => void;
        };

        if (coreModule.default) {
          coreModule.default(session.extensionAPI);
        }
      } catch {
        console.log("[harness-agent] @harness-kit/core not available, running in bare mode");
      }
    }

    // 注册事件处理器显示输出
    session.extensionAPI.on("turn_start", (event) => {
      output.turnStart(event);
    });

    session.extensionAPI.on("turn_end", (event) => {
      output.turnEnd(event);
      console.log();
    });

    session.extensionAPI.on("tool_execution_start", (event) => {
      output.toolStart(event);
    });

    session.extensionAPI.on("tool_execution_end", (event) => {
      output.toolEnd(event);
    });

    session.extensionAPI.on("agent_end", (event) => {
      output.agentEnd(event);
    });

    await session.start();

    rl.prompt();

    for await (const line of rl) {
      const trimmed = line.trim();

      if (trimmed === "/exit") break;

      if (!trimmed) {
        rl.prompt();
        continue;
      }

      if (busy) {
        console.log("Please wait for the current response...");
        rl.prompt();
        continue;
      }

      busy = true;

      try {
        await session.prompt(trimmed);
      } catch (err) {
        console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        busy = false;
        rl.prompt();
      }
    }
  } finally {
    await cleanup();
  }
}
```

关键设计：
- readline 创建在 handler 注册前
- 输出 handler 只输出，不调用 rl.prompt()
- 主循环 finally 统一 rl.prompt()
- 空输入直接 continue
- cleanup 幂等（cleanedUp 标志）
- process.once("SIGINT"/"SIGTERM")
- cleanup 中移除 signal listener
- prompt 错误只打印，不退出 REPL

### Step 9: `src/cli.ts` — 入口点

```typescript
#!/usr/bin/env node
import { parseArgs } from "./cli/args.js";
import { resolveConfig } from "./cli/config.js";
import { startREPL } from "./cli/repl.js";

const args = parseArgs(process.argv.slice(2));
if (args.help) { /* 显示帮助 */ process.exit(0); }
if (args.version) { /* 显示版本 */ process.exit(0); }

try {
  const config = resolveConfig(args);
  await startREPL(config, !args.noExtension);
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
```

### Step 10: 更新 `package.json`

```json
{
  "bin": { "harness-agent": "dist/cli.js" },
  "peerDependencies": {
    "@harness-kit/core": "workspace:*"
  },
  "peerDependenciesMeta": {
    "@harness-kit/core": { "optional": true }
  }
}
```
注意：不添加 `@harness-kit/core` 到 devDependencies，避免构建期类型解析循环。

### Step 11: 更新根 `package.json`

添加 `harness` script：
```json
{
  "scripts": {
    "harness": "node packages/harness-agent/dist/cli.js"
  }
}
```

## 测试策略

### CLI 单元测试（使用 mock streamFn）

4 个测试文件（~30 tests）：
- `cli/args.test.ts` — 参数解析、默认值、未知标志
- `cli/config.test.ts` — 环境变量解析、API key 错误、模型查找、streamFn 创建
- `cli/output.test.ts` — 每种事件类型的格式化
- `cli/repl.test.ts` — session 生命周期、扩展加载、错误恢复

### Runtime compatibility 测试（使用 registerFauxProvider 或真实 AssistantMessageEventStream）

1 个测试文件（~5 tests）：
- registerFauxProvider() text response
- toolCall -> tool execution -> 第二轮 model response
- usage 映射
- stream error/abort
- arguments -> tool_use.input

注意：现有旧 mock async generator 测试需要更新，或者 collectStream() 临时保留 legacy fallback

## 关键文件

| 文件 | 作用 |
|------|------|
| `packages/harness-agent/src/session/types.ts` | HarnessAgentSessionConfig、StreamFn、HarnessExtensionAPI |
| `packages/harness-agent/src/session/harness-session.ts` | HarnessAgentSession 主类 |
| `packages/core/src/index.ts` | harnessKitExtension 扩展函数 |
| `packages/harness-agent/node_modules/@earendil-works/pi-ai/dist/stream.d.ts` | streamSimple 签名 |
| `packages/harness-agent/package.json` | 需修改：添加 bin、peerDeps |

## 验收标准

### Runtime 可用性

1. **runAgentLoop() 能消费真实 pi-ai stream**
   - 使用 `registerFauxProvider()` 或等价测试
   - assistant text 能进入 session messages
   - toolCall 能被执行
   - usage 能正确累加
   - error/abort 不会静默变成空响应

2. **事件桥接不丢数据**
   - toolCall.arguments 能桥接成 tool_use.input
   - turn_end 中工具调用参数完整
   - tool execution start/end 输出有 tool name、args、error

3. **agent 构建不依赖 core dist**
   - `pnpm --filter @harness-kit/agent run typecheck` 通过
   - `pnpm --filter @harness-kit/agent run build` 通过
   - 在 core 未预先 build 的情况下也应通过

### CLI 配置可靠

4. **参数校验**
   - `--help` 正常
   - `--version` 正常
   - 未知 provider/model 报清晰错误
   - 明确需要 API key 的 provider（anthropic、openai 等）缺 key 时报清晰错误；其他 provider 交给 streamSimple() 处理
   - `--workspace` 生效
   - `--no-extension` 可进入 bare mode

### REPL 生命周期可靠

5. **生命周期控制**
   - `/exit` 正常 shutdown
   - Ctrl+C/SIGTERM 行为明确
   - readline 不阻止进程退出
   - prompt 期间重复输入不会造成未捕获异常
   - prompt 错误后仍能继续交互

### 端到端验证命令

6. **最低验证**
   ```bash
   pnpm --filter @harness-kit/agent run typecheck
   pnpm --filter @harness-kit/agent run test
   pnpm run build
   pnpm run harness -- --help
   ```

7. **有真实 API key 时验证**
   ```bash
   pnpm run harness -- --provider anthropic --model claude-sonnet-4-20250514
   ```
