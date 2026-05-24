# Prax Agent 架构文档

## 1. 整体架构概览

```mermaid
graph TB
    subgraph "编排层 (Agents)"
        S[SisyphusAgent<br/>意图分类 + 路由]
        R[RalphAgent<br/>持续执行]
        T[TeamAgent<br/>DAG 并行协作]
    end

    subgraph "核心运行时 (Core Runtime)"
        AL[Agent Loop<br/>agent_loop.py]
        MW[Middleware Chain<br/>middleware.py]
        EC[EventBus<br/>event_bus.py]
        TC[TraceContext<br/>trace.py]
    end

    subgraph "LLM 层"
        LC[LLMClient<br/>llm_client.py]
        AN[Anthropic API]
        OA[OpenAI API]
        OR[OpenAI Responses API]
    end

    subgraph "工具层 (Tools)"
        TB[Tool ABC<br/>tools/base.py]
        VT[VerifyCommand<br/>安全边界]
        ST[StreamingToolExecutor<br/>并行/串行调度]
    end

    subgraph "记忆系统 (Memory)"
        LI[LayeredInjector<br/>L0-L3 分层]
        KG[KnowledgeGraph<br/>SQLite 时序图谱]
        VS[VectorStore<br/>ChromaDB + 嵌入]
        MB[MemoryBackend<br/>抽象接口]
    end

    subgraph "支撑系统"
        GOV[GovernanceConfig<br/>治理配置]
        ER[ErrorRecovery<br/>错误分类 + 恢复]
        HK[HookRegistry<br/>声明式钩子]
        SB[Sandbox<br/>隔离执行]
    end

    S --> AL
    R --> AL
    T --> AL
    AL --> MW
    AL --> LC
    AL --> ST
    AL --> EC
    AL --> TC
    MW --> TB
    ST --> TB
    LC --> AN
    LC --> OA
    LC --> OR
    MB --> LI
    MB --> KG
    MB --> VS
    AL --> GOV
    AL --> ER
    AL --> HK
    TB --> SB
```

---

## 2. 中间件管道 (Middleware Pipeline)

Prax 采用 Deep Agents 风格的中间件模式，每个中间件可在 4 个钩子点介入：

```mermaid
flowchart LR
    A[before_model] --> B[LLM Call]
    B --> C[after_model]
    C --> D{有 tool_calls?}
    D -->|是| E[before_tool]
    E --> F[Tool Execute]
    F --> G[after_tool]
    G --> H[结果反馈到 messages]
    H --> A
    D -->|否| I[最终文本响应]
```

### 优先级体系

| 优先级常量 | 值 | 中间件 | 职责 |
|-----------|-----|--------|------|
| `PRIORITY_GUARD` | 10 | PermissionMiddleware, LoopDetectionMiddleware | 安全/循环检测 |
| `PRIORITY_CACHE` | 20 | PromptCacheMiddleware | 缓存优化 |
| `PRIORITY_INJECT` | 50 | ContextInjectMiddleware, MemoryExtractionMiddleware | 上下文注入 |
| `PRIORITY_EXTRACT` | 90 | MemoryExtractionMiddleware | 信息提取 |
| `PRIORITY_EVAL` | 95 | QualityGateMiddleware, EvaluatorMiddleware | 评估/质量门 |

### 核心中间件一览

```mermaid
graph LR
    subgraph "执行顺序 (数值越小越先)"
        direction TB
        CT[ChangeTracker<br/>priority=5]
        PM[PermissionMiddleware<br/>priority=10]
        LD[LoopDetectionMiddleware<br/>priority=10]
        PCM[PromptCacheMiddleware<br/>priority=20]
        CIM[ContextInjectMiddleware<br/>priority=50]
        TR[TodoReminderMiddleware<br/>priority=100]
        RBM[RunBoundaryReminderMiddleware<br/>priority=55]
        VG[VerificationGuidanceMiddleware<br/>priority=60]
        DRG[DesignRestorationGuardMiddleware<br/>priority=62]
        MFM[ModelFallbackMiddleware<br/>priority=100]
        MEM[MemoryExtractionMiddleware<br/>priority=100]
        HM[HookMiddleware<br/>priority=100]
        QGM[QualityGateMiddleware<br/>priority=95]
        EM[EvaluatorMiddleware<br/>priority=95]
    end
```

---

## 3. Agent Loop 执行流程

```mermaid
sequenceDiagram
    participant User
    participant AL as AgentLoop
    participant MW as Middleware
    participant LLM as LLMClient
    participant ST as StreamingToolExecutor
    participant Tool as Tool
    participant Bus as EventBus

    User->>AL: user_message
    AL->>AL: 初始化 state, messages, middlewares
    loop 最多 MAX_ITERATIONS (默认 25) 次
        AL->>MW: before_model(state)
        AL->>LLM: complete() / stream_complete()
        LLM-->>AL: LLMResponse
        AL->>MW: after_model(state, response)
        alt response.has_tool_calls
            AL->>Bus: emit ToolMatchEvent, ToolStartEvent
            AL->>ST: submit(tool_call)
            ST->>MW: before_tool
            ST->>Tool: execute()
            Tool-->>ST: ToolResult
            ST->>MW: after_tool
            ST-->>AL: ToolCallResult[]
            AL->>Bus: emit ToolResultEvent, SpanEndEvent
            AL->>AL: messages.append(tool_results)
        else 最终文本
            AL->>Bus: emit MessageDeltaEvent
            AL->>Bus: emit MessageStopEvent
            AL->>Bus: emit AgentRunReport
            AL-->>User: 返回最终文本
        end
    end
```

### 关键控制参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_ITERATIONS` | 25 | 最大迭代次数，防止无限循环 |
| `MAX_CONSECUTIVE_FAILURES` | 3 | 连续 LLM 失败触发熔断 |
| `effective_budget` | governance 配置 | Token 预算上限 |

---

## 4. 记忆子系统架构 (5 层)

```mermaid
graph TB
    subgraph "记忆注入流程"
        direction TB
        U[用户查询] --> L0
        L0[L0 Identity<br/>~100 tokens<br/>用户偏好 + 项目身份] --> L1
        L1[L1 Essential<br/>~500 tokens<br/>高置信度 KG 三元组] --> L2
        L2[L2 On-Demand<br/>~300 tokens<br/>语义相关 facts] --> L3
        L3[L3 Deep Search<br/>~800 tokens<br/>KG 全量查询] --> EP
        EP[Episodic<br/>最近 N 天会话快照] --> INJ[注入到 messages]
    end

    subgraph "存储后端"
        LB[LocalBackend<br/>JSON 文件]
        SB[SQLiteBackend<br/>FTS5 + 向量混合]
        OV[OpenVikingBackend<br/>gRPC 服务]
    end

    subgraph "检索组件"
        KG[KnowledgeGraph<br/>SQLite 时序图谱]
        VS[VectorStore<br/>ChromaDB]
        D[Dialect<br/>AAAK 压缩编码]
    end

    LB --> INJ
    SB --> INJ
    OV --> INJ
    KG --> L1
    KG --> L3
    VS --> L2
    D --> L1
```

### 各层职责

| 层级 | Token 预算 | 数据来源 | 触发时机 |
|------|-----------|---------|---------|
| L0 Identity | ~100 | MemoryStore.workContext / topOfMind | 每次对话 |
| L1 Essential | ~500 | KnowledgeGraph 高置信度三元组 | 每次对话 |
| L2 On-Demand | ~300 | VectorStore 语义检索 | 每次对话，基于查询 |
| L3 Deep Search | ~800 | KnowledgeGraph 实体查询 | L2 无结果时 |
| Episodic | 动态 | `.prax/sessions/*-facts.json` | 每次会话首次 |

---

## 5. 工具执行流 (并行 vs 串行)

```mermaid
flowchart TD
    A[LLM 返回 tool_calls] --> B{工具是否并发安全?}
    B -->|is_concurrency_safe=True| C[并行桶]
    B -->|is_concurrency_safe=False| D[串行队列]

    C --> C1[Read]
    C --> C2[Grep]
    C --> C3[Glob]
    C --> C4[HashlineRead]

    D --> D1[Write]
    D --> D2[Edit]
    D --> D3[Bash]
    D --> D4[ApplyPatch]

    C1 & C2 & C3 & C4 --> E[asyncio.gather 并行执行]
    E --> F[收集并行结果]
    F --> D1
    D1 --> D2
    D2 --> D3
    D3 --> D4
    D4 --> G[按提交顺序合并结果]
```

### 并发安全标记

工具基类通过 `is_concurrency_safe: bool` 标记是否可并行：

| 并发安全 | 工具 |
|---------|------|
| Yes | Read, Glob, Grep, HashlineRead, WebFetch, WebSearch |
| No | Write, Edit, Bash, SandboxBash, ApplyPatch, MultiEdit |

---

## 6. 组件映射

```mermaid
graph TB
    subgraph "src/prax/core/ (~9500 行)"
        A1[agent_loop.py<br/>主循环 566 行]
        A2[middleware.py<br/>中间件链 1013 行]
        A3[memory_middleware.py<br/>记忆提取 820 行]
        A4[llm_client.py<br/>多提供商 783 行]
        A5[error_recovery.py<br/>错误恢复 336 行]
        A6[streaming_tool_executor.py<br/>工具调度 167 行]
        A7[context.py<br/>系统提示 299 行]
        A8[event_bus.py<br/>事件总线 209 行]
        A9[trace.py<br/>链路追踪 74 行]
        A10[governance.py<br/>治理配置 86 行]
        A11[hooks.py<br/>声明式钩子 427 行]
        A12[permissions.py<br/>权限模式 58 行]
    end

    subgraph "src/prax/core/memory/ (~3500 行)"
        M1[backend.py<br/>抽象接口]
        M2[local_backend.py<br/>JSON 文件后端]
        M3[sqlite_backend.py<br/>FTS5 + 向量]
        M4[vector_store.py<br/>ChromaDB 语义检索]
        M5[knowledge_graph.py<br/>时序知识图谱]
        M6[dialect.py<br/>AAAK 压缩编码]
        M7[layers.py<br/>L0-L3 分层注入]
        M8[factory.py<br/>后端工厂]
        M9[migration.py<br/>迁移工具]
    end

    subgraph "src/prax/agents/"
        G1[sisyphus.py<br/>主编排器]
        G2[ralph.py<br/>持续执行]
        G3[team.py<br/>并行协作]
    end

    subgraph "src/prax/tools/"
        T1[base.py<br/>Tool ABC]
        T2[verify_command.py<br/>安全边界]
        T3[sandbox_bash.py<br/>隔离执行]
        T4[read/write/edit.py<br/>文件操作]
    end
```

---

## 7. 数据流总结

```
用户输入
  → SisyphusAgent 意图分类 (research/implement/diagnose/refactor)
    → 路由决策: direct / ralph / team
      → AgentLoop.run_agent_loop()
        → Middleware.before_model() [按优先级排序]
          → LLMClient.complete() / .stream_complete()
            → Middleware.after_model()
              → 有 tool_calls?
                → StreamingToolExecutor 并行/串行调度
                  → Middleware.before_tool() → Tool.execute() → Middleware.after_tool()
                → 结果追加到 messages
              → 无 tool_calls → 最终文本响应
        → EventBus 全程发射事件
        → TraceContext 记录 span 层级
        → GovernanceConfig 控制预算与迭代上限
```
