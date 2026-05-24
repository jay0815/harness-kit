# Hermes Agent 架构文档

本文档描述 Hermes Agent 的系统架构、组件关系和数据流。

---

## 1. 系统总览

Hermes Agent 由三大运行时组成：

| 运行时 | 入口 | 用途 |
|---|---|---|
| **独立 Agent** | `run_agent.py` | 直接运行 AIAgent |
| **网关服务** | `gateway/run.py` | 多平台多会话服务 |
| **TUI** | `ui-tui/` + `tui_gateway/` | Ink/React 终端界面 |

```mermaid
graph TB
    subgraph "运行时层"
        A[独立 Agent<br/>run_agent.py]
        B[网关服务<br/>gateway/run.py]
        C[TUI 前端<br/>ui-tui/]
        D[TUI 后端<br/>tui_gateway/]
    end

    subgraph "核心编排层"
        E[AIAgent<br/>核心编排器]
        F[ConversationLoop<br/>对话循环]
    end

    subgraph "能力层"
        G[ToolRegistry<br/>工具注册表]
        H[ContextEngine<br/>上下文引擎]
        I[MemoryProvider<br/>记忆提供者]
        J[ToolGuardrails<br/>工具护栏]
        K[PromptCaching<br/>提示缓存]
    end

    subgraph "工具层"
        L[TerminalTool<br/>终端会话]
        M[DelegateTool<br/>子代理委派]
        N[其他工具集<br/>toolsets.py]
    end

    subgraph "存储层"
        O[HermesState<br/>SQLite + FTS5]
        P[插件存储<br/>plugins/]
    end

    A --> E
    B --> E
    C --> D --> E
    E --> F
    F --> G
    F --> H
    F --> I
    F --> J
    F --> K
    G --> L
    G --> M
    G --> N
    E --> O
    I --> P
```

---

## 2. AIAgent 核心编排

`run_agent.py` 中的 `AIAgent` 类是整个系统的中央编排器（~4,309 LOC）。它协调所有子系统完成一次完整的 Agent 运行。

```mermaid
graph LR
    subgraph "AIAgent 初始化"
        A1[解析 60+ 参数]
        A2[初始化 ContextEngine]
        A3[初始化 MemoryProvider]
        A4[加载 ToolRegistry]
        A5[配置 PromptCaching]
    end

    subgraph "单次运行"
        B1[会话恢复/创建]
        B2[预取记忆]
        B3[进入 ConversationLoop]
        B4[会话持久化]
    end

    A1 --> A2 --> A3 --> A4 --> A5
    A5 --> B1 --> B2 --> B3 --> B4
```

### 初始化参数分类

| 类别 | 示例参数 |
|---|---|
| 模型配置 | `model`, `provider`, `api_key`, `base_url` |
| 上下文管理 | `context_engine`, `max_context_tokens`, `compression_threshold` |
| 记忆配置 | `memory_provider`, `honcho_config`, `mem0_config` |
| 工具配置 | `toolsets`, `blocked_tools`, `tool_timeout` |
| 安全/护栏 | `guardrail_enabled`, `max_iterations`, `iteration_budget` |
| 流式/缓存 | `stream`, `cache_enabled`, `cache_ttl` |
| 网关相关 | `gateway_mode`, `platform_adapter`, `session_ttl` |

---

## 3. 对话循环（Conversation Loop）

`agent/conversation_loop.py`（~4,231 LOC）是 Agent 的核心执行引擎。每轮对话按固定阶段顺序执行：

```mermaid
graph TD
    Start[开始新轮次] --> P1[阶段1: 预检压缩<br/>Preflight Compression]
    P1 --> P2[阶段2: API 调用<br/>Streaming API Call]
    P2 --> P3[阶段3: 错误恢复<br/>Error Recovery]
    P3 --> P4[阶段4: 响应验证<br/>Response Validation]
    P4 --> P5[阶段5: 工具执行<br/>Tool Execution]
    P5 --> P6[阶段6: 空响应恢复<br/>Empty Response Recovery]
    P6 --> P7[阶段7: 轮次退出诊断<br/>Turn-Exit Diagnostics]
    P7 --> Check{继续?}
    Check -->|是| Start
    Check -->|否| End[会话结束]

    P2 -.->|90s 过期| Timeout[流超时检测]
    Timeout --> P3

    P5 -.->|并发执行| ThreadPool[ThreadPoolExecutor<br/>max 8 workers]
    P5 -.->|顺序执行| Sequential[顺序模式]
```

### 各阶段详解

| 阶段 | 职责 | 关键组件 |
|---|---|---|
| **预检压缩** | 检查上下文是否超限，触发 ContextEngine 压缩 | ContextCompressor |
| **API 调用** | 流式发送请求，注入 cache_control，接收 SSE 流 | PromptCaching |
| **错误恢复** | 按层次处理：编码错误 → 图片拒绝 → 413 → 上下文溢出 → 限流 → 认证失败 | ErrorClassifier, RetryUtils |
| **响应验证** | 校验响应格式、工具调用合法性 | ToolRegistry |
| **工具执行** | 并发/顺序调度工具，传播上下文变量 | ToolExecutor, ThreadPoolExecutor |
| **空响应恢复** | 轻推 → 预填充 → 回退提供者 → 空哨兵 | 内置恢复链 |
| **轮次退出诊断** | 记录本轮指标，更新记忆，触发后台审查 | MemoryManager |

---

## 4. 上下文引擎架构

上下文引擎采用 **ABC + 插件** 模式，允许自定义上下文管理策略。

```mermaid
graph TB
    subgraph "ContextEngine ABC"
        A[onSessionStart<br/>会话启动]
        B[updateFromResponse<br/>更新上下文]
        C[shouldCompress<br/>检查压缩]
        D[compress<br/>执行压缩]
        E[assembleContext<br/>组装消息]
        F[onSessionEnd<br/>会话结束]
    end

    subgraph "默认实现"
        G[ContextCompressor<br/>阈值压缩器]
        H[threshold_percent=0.75]
    end

    subgraph "插件实现"
        I[plugins/context_engine/]
        J[自定义引擎A]
        K[自定义引擎B]
    end

    A --> B --> C
    C -->|需要| D
    C -->|不需要| E
    D --> E --> F
    G --> H
    I --> J
    I --> K
```

### ContextCompressor 生命周期

```
onSessionStart() → 初始化上下文窗口
       ↓
updateFromResponse(response) → 将模型响应合并到上下文
       ↓
shouldCompress(context, max_tokens) → 检查是否超过阈值（75%）
       ↓
compress(context) → 丢弃/摘要化早期消息
       ↓
assembleContext() → 生成最终消息列表
       ↓
onSessionEnd() → 清理资源
```

---

## 5. 工具护栏流程

`agent/tool_guardrails.py` 实现**每轮对话级别**的工具调用安全控制，区别于简单的全局循环计数。

```mermaid
graph TD
    A[工具调用请求] --> B{检查类型}
    B -->|IDEMPOTENT| C[幂等工具检查]
    B -->|MUTATING| D[变更工具检查]

    C --> E{检测模式}
    D --> E

    E -->|相同失败重复| F[计数器+1]
    E -->|同工具失败链| G[链长度+1]
    E -->|无进展幂等调用| H[标记无进展]

    F --> I{阈值判断}
    G --> I
    H --> I

    I -->|正常| J[action: allow]
    I -->|警告| K[action: warn]
    I -->|危险| L[action: block]
    I -->|严重| M[action: halt]

    J --> N[继续执行]
    K --> O[记录警告继续]
    L --> P[跳过该工具]
    M --> Q[终止本轮]
```

### 检测规则

| 规则 | 说明 | 触发条件 |
|---|---|---|
| **相同失败重复** | 同一工具、同一参数、同一错误 | 连续 N 次失败 |
| **同工具失败链** | 同一工具连续失败（参数可能不同） | 连续 M 次 |
| **无进展幂等调用** | 幂等工具返回与之前相同结果 | 连续 K 次无变化 |

### 工具分类

| 分类 | 特征 | 示例 |
|---|---|---|
| **IDEMPOTENT** | 多次调用结果相同，无副作用 | `read_file`, `search`, `get_status` |
| **MUTATING** | 会改变系统状态 | `write_file`, `execute_command`, `delegate_task` |

---

## 6. 记忆提供者架构

记忆系统采用 **ABC + 内置实现 + 外部插件** 的三层架构。

```mermaid
graph TB
    subgraph "MemoryProvider ABC"
        A[initialize<br/>初始化]
        B[prefetch<br/>预取记忆]
        C[sync_turn<br/>同步轮次]
        D[get_tool_schemas<br/>获取工具模式]
    end

    subgraph "内置提供者"
        E[Honcho]
        F[Mem0]
        G[Hindsight]
        H[Supermemory]
    end

    subgraph "MemoryManager"
        I[协调内置 + 外部]
        J[强制单外部限制]
    end

    subgraph "外部插件"
        K[plugins/memory/]
    end

    A --> B --> C --> D
    I --> E
    I --> F
    I --> G
    I --> H
    I -.->|最多1个| K
    K --> L[自定义记忆后端]
```

### 关键约束

- **单外部提供者限制**: 同时只能激活一个外部记忆插件，避免冲突
- **生命周期**: `initialize` → `prefetch`（每会话）→ `sync_turn`（每轮）→ `get_tool_schemas`（按需）

---

## 7. 网关架构

`gateway/run.py` 提供多平台、多会话的 Agent 服务能力。

```mermaid
graph TB
    subgraph "GatewayRunner"
        A[LRU Agent 缓存<br/>size=128]
        B[空闲 TTL=1h]
        C[会话路由]
    end

    subgraph "平台适配器"
        D[Telegram]
        E[Discord]
        F[Slack]
        G[WebSocket]
        H[... 15+ 平台]
    end

    subgraph "Agent 实例"
        I[Agent #1]
        J[Agent #2]
        K[Agent #N]
    end

    D --> C
    E --> C
    F --> C
    G --> C
    H --> C
    C --> A
    A -->|命中| I
    A -->|命中| J
    A -->|新建| K
    A -.->|空闲超时| B
    B -.->|淘汰| L[清理资源]
```

### 网关特性

| 特性 | 实现 |
|---|---|
| Agent 复用 | LRU 缓存，最大 128 个实例 |
| 资源回收 | 1 小时空闲 TTL，自动关闭 |
| 会话隔离 | 每个会话独立 Agent 实例 |
| 平台适配 | 统一接口，15+ 平台实现 |

---

## 8. 工具注册与发现

`tools/registry.py` 实现自注册工具发现机制。

```mermaid
graph TD
    A[模块导入] --> B[AST 扫描]
    B --> C[查找 registry.register() 调用]
    C --> D[提取工具元数据]
    D --> E[注册到 Singleton Registry]
    E --> F[generation 计数器+1]
    F --> G[TTL 缓存 check_fn<br/>30s]

    H[运行时调用] --> I[registry.get]
    I --> J{缓存有效?}
    J -->|是| K[返回缓存]
    J -->|否| L[重新验证]
```

---

## 9. 组件映射表

| 组件 | 文件路径 | 规模 | 职责 |
|---|---|---|---|
| AIAgent | `run_agent.py` | ~4,309 LOC | 核心编排器，协调所有子系统 |
| ConversationLoop | `agent/conversation_loop.py` | ~4,231 LOC | 对话循环的 7 个阶段 |
| HermesState | `hermes_state.py` | ~3,279 LOC | SQLite 会话存储，WAL + FTS5 |
| DelegateTool | `tools/delegate_tool.py` | ~2,801 LOC | 子代理生成与管理 |
| TerminalTool | `tools/terminal_tool.py` | ~2,405 LOC | 终端会话管理 |
| ModelTools | `model_tools.py` | ~923 LOC | 工具编排层 |
| Toolsets | `toolsets.py` | ~876 LOC | 工具集定义与组合 |
| ToolRegistry | `tools/registry.py` | 中等 | 自注册工具发现 |
| ContextEngine | `agent/context_engine.py` | 小 | 上下文引擎 ABC |
| ContextCompressor | `agent/context_compressor.py` | 中等 | 默认上下文压缩实现 |
| ToolGuardrails | `agent/tool_guardrails.py` | 中等 | 每轮工具调用护栏 |
| ToolExecutor | `agent/tool_executor.py` | 中等 | 并发/顺序工具调度 |
| MemoryProvider | `agent/memory_provider.py` | 小 | 记忆提供者 ABC |
| MemoryManager | `agent/memory_manager.py` | 中等 | 记忆 orchestration |
| PromptCaching | `agent/prompt_caching.py` | 中等 | Anthropic cache_control |
| ErrorClassifier | `agent/error_classifier.py` | 小 | 结构化 API 错误分类 |
| RetryUtils | `agent/retry_utils.py` | 小 | 抖动退避工具 |
| GatewayRunner | `gateway/run.py` | 中等 | 网关服务 + LRU 缓存 |
