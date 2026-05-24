# pi-mono 架构设计

## 1. 五包分层架构

pi-mono 采用严格的分层架构，上层依赖下层，禁止反向依赖。

```mermaid
graph TB
    subgraph "用户界面层"
        W[Web UI<br/>@mariozechner/pi-web-ui]
        T[TUI<br/>@mariozechner/pi-tui]
    end

    subgraph "会话编排层"
        S[AgentSession<br/>@mariozechner/pi-coding-agent]
    end

    subgraph "代理运行时层"
        A[Agent / Agent Loop<br/>@mariozechner/pi-agent-core]
    end

    subgraph "LLM 抽象层"
        AI[pi-ai<br/>@mariozechner/pi-ai]
    end

    subgraph "Provider 实现层"
        P1[OpenAI]
        P2[Anthropic]
        P3[Google]
        P4[Bedrock]
        P5[Mistral]
        P6[...]
    end

    W --> S
    T --> S
    S --> A
    A --> AI
    AI --> P1
    AI --> P2
    AI --> P3
    AI --> P4
    AI --> P5
    AI --> P6
```

### 分层职责

| 层级 | 包 | 职责 |
|------|-----|------|
| 用户界面层 | pi-web-ui / pi-tui | 渲染、输入处理、用户交互 |
| 会话编排层 | pi-coding-agent | 会话管理、扩展系统、工具注册、持久化 |
| 代理运行时层 | pi-agent-core | 消息队列、事件发射、工具执行、LLM 调用协调 |
| LLM 抽象层 | pi-ai | Provider 注册、消息转换、流式协议 |
| Provider 实现层 | 各 Provider 模块 | 具体 API 调用、认证、响应解析 |

## 2. 数据流

```mermaid
sequenceDiagram
    participant U as 用户
    participant UI as Web UI / TUI
    participant S as AgentSession
    participant A as Agent
    participant AL as Agent Loop
    participant AI as pi-ai
    participant P as Provider

    U->>UI: 输入消息
    UI->>S: prompt(text)
    S->>A: prompt(messages)
    A->>AL: runAgentLoop()
    AL->>AL: convertToLlm(messages)
    AL->>AI: streamSimple(model, context)
    AI->>P: HTTP 请求
    P-->>AI: SSE/WebSocket 响应
    AI-->>AL: AssistantMessageEventStream
    AL-->>A: message_start / message_update / message_end
    A-->>S: agent_start / turn_start / ...
    S-->>UI: 渲染更新
    S->>S: 持久化到会话文件

    alt 工具调用
        AL->>AL: executeToolCalls()
        AL-->>A: tool_execution_start
        AL-->>A: tool_execution_end
        A-->>S: 工具结果事件
        S-->>UI: 渲染工具输出
    end

    AL-->>A: turn_end
    AL-->>A: agent_end
    A-->>S: 会话完成
    S-->>UI: 显示完成状态
```

## 3. 事件生命周期

Agent 运行时定义了一套完整的事件协议，用于 UI 更新和扩展拦截。

```mermaid
stateDiagram-v2
    [*] --> agent_start: prompt() / continue()

    agent_start --> turn_start: 开始新回合

    turn_start --> message_start: 发送用户消息
    message_start --> message_end: 消息完成

    message_end --> message_start: 流式助手响应
    message_start --> message_update: 收到 token
    message_update --> message_update: 继续流式
    message_update --> message_end: 流结束

    message_end --> tool_execution_start: 有工具调用
    tool_execution_start --> tool_execution_update: 部分结果
    tool_execution_update --> tool_execution_end: 工具完成
    tool_execution_end --> tool_execution_start: 下一个工具

    tool_execution_end --> turn_end: 所有工具完成

    turn_end --> turn_start: 继续（有 steering/followUp）
    turn_end --> agent_end: 无更多消息

    agent_end --> [*]
```

### 事件类型详解

| 事件 | 方向 | 说明 |
|------|------|------|
| `agent_start` | 发射 | 代理运行开始 |
| `agent_end` | 发射 | 代理运行结束，携带新增消息列表 |
| `turn_start` | 发射 | 新回合开始（一次 assistant + tools） |
| `turn_end` | 发射 | 回合结束，携带 assistant 消息和工具结果 |
| `message_start` | 发射 | 消息开始（user/assistant/toolResult） |
| `message_update` | 发射 | 助手消息流式更新 |
| `message_end` | 发射 | 消息完成 |
| `tool_execution_start` | 发射 | 工具开始执行 |
| `tool_execution_update` | 发射 | 工具部分结果（流式） |
| `tool_execution_end` | 发射 | 工具执行完成 |

## 4. 会话树结构

pi-mono 的会话不是线性列表，而是一棵**可分支的树**。

```mermaid
graph TD
    H[SessionHeader<br/>id: session-001] --> M1[User: "Hello"]
    M1 --> M2[Assistant: "Hi!"]
    M2 --> M3[User: "Fix bug"]
    M3 --> M4[Assistant + Tools]
    M4 --> M5[CompactionEntry<br/>summary: "..."]
    M5 --> M6[User: "Refactor"]
    M6 --> M7[Assistant + Tools]

    M4 -.->|分支| B1[BranchSummary<br/>fromId: M4]
    B1 --> M8[User: "Try alt approach"]
    M8 --> M9[Assistant + Tools]

    M7 -.->|导航回 M4| B2[BranchSummary<br/>fromId: M7]
    B2 --> M10[在 M4 继续]
```

### 会话条目类型

| 类型 | 作用 |
|------|------|
| `message` | 标准消息（user/assistant/toolResult） |
| `compaction` | 上下文压缩摘要 |
| `branch_summary` | 分支导航摘要 |
| `custom` | 扩展自定义数据（不参与 LLM 上下文） |
| `custom_message` | 扩展自定义消息（参与 LLM 上下文） |
| `thinking_level_change` | 思考级别变更记录 |
| `model_change` | 模型切换记录 |
| `label` | 用户书签/标记 |
| `session_info` | 会话元数据（名称等） |

### 树操作

- **Fork**：从任意节点创建新分支（新会话文件）
- **Navigate**：在同一会话文件内切换当前叶子节点
- **Branch with Summary**：导航时生成被放弃分支的摘要

## 5. 组件映射

```mermaid
graph LR
    subgraph "pi-coding-agent 核心"
        AS[AgentSession]
        SM[SessionManager]
        EX[ExtensionRunner]
        TR[ToolRegistry]
        CO[Compaction]
        BS[BranchSummarization]
    end

    subgraph "pi-agent-core"
        AG[Agent]
        AL[AgentLoop]
    end

    subgraph "pi-ai"
        ST[stream.ts]
        AR[api-registry.ts]
        RB[register-builtins.ts]
        TY[types.ts]
    end

    subgraph "Provider 实现"
        PA[anthropic.ts]
        PO[openai-completions.ts]
        PG[google.ts]
        PB[bedrock.ts]
    end

    AS --> AG
    AS --> SM
    AS --> EX
    AS --> TR
    AS --> CO
    AS --> BS
    AG --> AL
    AL --> ST
    ST --> AR
    AR --> RB
    RB --> PA
    RB --> PO
    RB --> PG
    RB --> PB
```

## 6. 关键数据转换点

```mermaid
graph LR
    AM[AgentMessage<br/>内部消息] --> CL[convertToLlm<br/>转换函数]
    CL --> LM[Message<br/>LLM 消息]
    LM --> AI[pi-ai]
    AI --> PR[Provider 请求]
    PR --> RS[Provider 响应]
    RS --> ES[AssistantMessageEventStream]
    ES --> UP[message_update<br/>事件]
    UP --> AM2[AgentMessage<br/>更新]
```

核心原则：**AgentMessage 在系统内部流转，仅在调用 LLM 时才转换为 Message**。这使得系统可以支持自定义消息类型（如 `bashExecution`、`custom`），而这些类型对 LLM 不可见。

## 7. 扩展系统架构

```mermaid
graph TB
    subgraph "扩展加载"
        LD[loader.ts<br/>jiti 加载]
        DC[discoverAndLoadExtensions]
        VM[virtualModules<br/>Bun 二进制支持]
    end

    subgraph "扩展运行时"
        RN[runner.ts<br/>ExtensionRunner]
        EB[event-bus.ts<br/>扩展间通信]
        API[ExtensionAPI<br/>pi.*]
    end

    subgraph "扩展能力"
        EV[事件订阅]
        TL[工具注册]
        CM[命令注册]
        SC[快捷键注册]
        FL[CLI Flag 注册]
        PR[Provider 注册]
    end

    LD --> RN
    DC --> LD
    VM --> LD
    RN --> API
    RN --> EB
    API --> EV
    API --> TL
    API --> CM
    API --> SC
    API --> FL
    API --> PR
```

## 8. 工具执行流程

```mermaid
sequenceDiagram
    participant AL as AgentLoop
    participant PT as prepareToolCall
    participant BT as beforeToolCall<br/>Hook
    participant EX as execute
    participant AT as afterToolCall<br/>Hook
    participant EM as emit

    AL->>PT: 参数验证
    PT->>BT: 扩展拦截
    BT-->>PT: {block} / undefined
    PT->>EX: 执行工具
    EX-->>PT: AgentToolResult
    PT->>AT: 扩展修改结果
    AT-->>PT: AfterToolCallResult
    PT->>EM: tool_execution_end
    EM->>AL: 继续循环
```

工具执行支持两种模式：
- **sequential**：逐个执行（有状态依赖时使用）
- **parallel**：预检顺序执行，允许的工具并发执行（默认）
