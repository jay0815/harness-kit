# Prax Agent API 文档

## 1. 中间件接口 (AgentMiddleware)

所有中间件继承自 `AgentMiddleware`，通过覆盖 4 个钩子方法介入执行流程。

```python
class AgentMiddleware:
    """Base middleware class. Override hooks as needed."""

    priority: int = 100  # 数值越小越先执行

    async def before_model(self, state: RuntimeState) -> None:
        """在 LLM 调用前执行，可修改 state.messages 注入上下文。"""
        return None

    async def after_model(self, state: RuntimeState, response: LLMResponse) -> LLMResponse:
        """在 LLM 返回后执行，可修改/替换响应。"""
        return response

    async def before_tool(
        self, state: RuntimeState, tool_call: ToolCall, tool: Tool | None
    ) -> ToolResult | None:
        """在工具执行前执行。返回非 None 则短路（跳过实际工具执行）。"""
        return None

    async def after_tool(
        self, state: RuntimeState, tool_call: ToolCall, tool: Tool | None, result: ToolResult
    ) -> ToolResult:
        """在工具执行后执行，可修改结果。"""
        return result
```

### 优先级常量

```python
PRIORITY_GUARD = 10    # 安全/循环检测类
PRIORITY_CACHE = 20    # 缓存类
PRIORITY_INJECT = 50   # 上下文注入类
PRIORITY_EXTRACT = 90  # 信息提取类
PRIORITY_EVAL = 95     # 评估/质量门类
```

### RuntimeState

```python
@dataclass
class RuntimeState:
    messages: list[dict]           # 完整对话历史
    context: Context               # 执行上下文
    iteration: int                 # 当前迭代次数
    tool_loop_counts: dict[str, int] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)  # 共享状态桶
```

`metadata` 是中间件间共享状态的唯一通道。`ChangeTracker` 作为单一写入者将代码变更/验证状态写入 `metadata["change_tracker"]`，其他中间件只读。

---

## 2. AgentRunReport

```python
@dataclass(frozen=True)
class AgentRunReport:
    stop_reason: str           # "end_turn" | "max_iterations" | "circuit_breaker" | "max_budget_reached"
    iterations: int            # 实际迭代次数
    had_tool_errors: bool      # 是否有工具执行错误
    only_permission_errors: bool   # 错误是否仅为权限拒绝
    usage: dict[str, int] | None   # Token 消耗统计
    verification_passed: bool = False   # 验证是否通过
```

`AgentRunReport` 在每次 `run_agent_loop` 结束时通过 `EventBus` 发射，供调用方获取执行摘要。

---

## 3. 工具抽象 (Tool ABC)

### Tool 基类

```python
class Tool(ABC):
    name: str
    description: str
    input_schema: dict[str, Any]           # JSON Schema
    permission_level: PermissionLevel = PermissionLevel.SAFE
    is_concurrency_safe: bool = False      # 是否可并行执行

    def to_claude_format(self) -> dict: ...
    def to_openai_format(self) -> dict: ...
    def validate_params(self, params: dict[str, Any]) -> None: ...

    @abstractmethod
    async def execute(self, params: dict[str, Any]) -> ToolResult: ...
```

### PermissionLevel

```python
class PermissionLevel(str, Enum):
    SAFE = "safe"          # 自动批准 (Read, Glob, Grep)
    REVIEW = "review"      # 默认批准但展示给用户 (Write, Edit)
    DANGEROUS = "dangerous" # 需显式确认 (Bash, rm)
```

### ToolCall

```python
@dataclass
class ToolCall:
    id: str = field(default_factory=lambda: f"toolu_{uuid.uuid4().hex[:12]}")
    name: str = ""
    input: dict[str, Any] = field(default_factory=dict)
```

### ToolResult

```python
@dataclass
class ToolResult:
    content: str
    is_error: bool = False
```

---

## 4. MemoryBackend 抽象

```python
class MemoryBackend(abc.ABC):
    # ── Project-level facts ──
    @abc.abstractmethod
    async def get_facts(self, cwd: str, limit: int = 100) -> list[Fact]: ...

    @abc.abstractmethod
    async def store_fact(self, cwd: str, fact: Fact) -> None: ...

    @abc.abstractmethod
    async def delete_fact(self, cwd: str, fact_id: str) -> None: ...

    # ── Project context ──
    @abc.abstractmethod
    async def get_context(self, cwd: str) -> MemoryContext: ...

    @abc.abstractmethod
    async def save_context(self, cwd: str, ctx: MemoryContext) -> None: ...

    # ── Global experiences ──
    @abc.abstractmethod
    async def get_experiences(self, task_type: str, limit: int = 10) -> list[Experience]: ...

    @abc.abstractmethod
    async def store_experience(self, exp: Experience) -> None: ...

    # ── Prompt injection ──
    async def format_for_prompt(self, cwd: str, task_type: str = "general",
                                 max_facts: int = 15) -> str: ...

    # ── Knowledge Graph ──
    def get_knowledge_graph(self, cwd: str) -> "KnowledgeGraph | None":
        return None  # 默认不支持

    # ── Lifecycle ──
    @abc.abstractmethod
    async def close(self) -> None: ...
```

### 数据对象

```python
@dataclass
class Fact:
    id: str
    content: str
    category: str = "context"      # preference|knowledge|context|behavior|goal|correction
    confidence: float = 0.5        # 0.0–1.0
    created_at: str = ""           # ISO-8601
    source: str = "unknown"
    source_error: str = ""         # 纠错类型专用

@dataclass
class MemoryContext:
    work_context: str = ""         # 项目背景（低频更新）
    top_of_mind: str = ""          # 当前优先级（每会话更新）
    updated_at: str = ""

@dataclass
class Experience:
    id: str
    task_type: str                 # "refactor" | "debug" | "implement"
    context: str                   # 情境描述
    insight: str                   # 学到的经验
    outcome: str                   # "completed" | "partial" | "failed"
    tags: list[str] = field(default_factory=list)
    timestamp: str = ""
    project: str = ""
```

---

## 5. LLM 客户端 API

### ModelConfig

```python
@dataclass
class ModelConfig:
    provider: str              # "zhipu" | "openai" | "anthropic"
    model: str                 # 提供商模型 ID
    base_url: str
    api_key: str
    api_format: str            # "openai" | "anthropic"
    config_name: str | None = None
    request_mode: str = "chat_completions"   # "chat_completions" | "responses"
    supports_tools: bool = True
    supports_streaming: bool = True
    supports_reasoning_effort: bool = False
    supports_thinking: bool = False
```

### LLMResponse

```python
@dataclass
class LLMResponse:
    content: list[dict[str, Any]]   # [{type: "text", text: ...}, {type: "tool_use", ...}]
    stop_reason: str | None = None
    usage: dict[str, int] | None = None

    @property
    def text(self) -> str: ...           # 提取所有文本块
    @property
    def tool_calls(self) -> list[ToolCall]: ...
    @property
    def has_tool_calls(self) -> bool: ...
```

### LLMClient 核心方法

```python
class LLMClient:
    def __init__(self, timeout: float = 120.0): ...
    async def close(self): ...

    # 模型解析
    def resolve_model(self, model_name: str, models_config: dict) -> ModelConfig: ...

    # 非流式调用
    async def complete(
        self, messages, tools, model_config, system_prompt="",
        max_tokens=4096, temperature=0.7,
        thinking_enabled=False, reasoning_effort=None, cache_enabled=False
    ) -> LLMResponse: ...

    # 流式调用 — 先 yield str 文本块，最后 yield LLMResponse
    async def stream_complete(
        self, messages, tools, model_config, system_prompt="",
        max_tokens=4096, temperature=0.7,
        thinking_enabled=False, cache_enabled=False
    ) -> AsyncGenerator[str | LLMResponse, None]: ...
```

**内部格式统一**: LLMClient 内部使用 Claude message format 作为 lingua franca，自动完成与 OpenAI chat completions / responses API 的双向转换。

---

## 6. EventBus API

```python
class EventBus:
    def on(self, event_type: Type[StreamEvent], handler: Handler) -> "EventBus": ...
    def off(self, event_type: Type[StreamEvent], handler: Handler) -> None: ...
    def clear(self, event_type: Type[StreamEvent] | None = None) -> None: ...
    def merge(self, other: "EventBus") -> None: ...
    async def emit(self, event: StreamEvent) -> None: ...
    def emit_sync(self, event: StreamEvent) -> None: ...

    @classmethod
    def from_callbacks(
        cls, *, on_text=None, on_tool_call=None,
        on_tool_result=None, on_complete=None, on_event=None
    ) -> "EventBus": ...
```

### StreamEvent 类型

| 事件类型 | 触发时机 | 关键字段 |
|---------|---------|---------|
| `MessageStartEvent` | 每次迭代开始 | `session_id`, `iteration` |
| `ToolMatchEvent` | 匹配到工具调用 | `tool_name`, `tool_id`, `tool_input` |
| `ToolStartEvent` | 工具执行开始 | `tool_name`, `tool_id` |
| `ToolResultEvent` | 工具执行完成 | `tool_name`, `is_error`, `content_preview` |
| `MessageDeltaEvent` | 流式文本块 | `text` |
| `MessageStopEvent` | 循环结束 | `stop_reason`, `iterations`, `usage` |
| `SpanStartEvent` | Span 开始 | `trace_id`, `span_id`, `span_name` |
| `SpanEndEvent` | Span 结束 | `duration_ms`, `status` |

---

## 7. 关键中间件 API 速查

### ChangeTracker (单一写入者)

```python
class ChangeTracker(AgentMiddleware):
    priority: int = 5

    # 写入到 state.metadata["change_tracker"] 的结构:
    # {
    #     "code_gen": int,           # 成功代码修改次数
    #     "verified_gen": int,       # 上次通过验证时的 code_gen 值
    #     "last_verify_ok": bool,    # 最近验证是否通过
    #     "last_verify_error": str | None,   # 失败输出摘要
    # }
```

### LoopDetectionMiddleware

```python
class LoopDetectionMiddleware(AgentMiddleware):
    def __init__(self, hard_limit: int = 5): ...
    # 检测重复工具调用序列，超过 hard_limit 时返回安全停止响应
```

### QualityGateMiddleware

```python
class QualityGateMiddleware(AgentMiddleware):
    def __init__(self, cwd: str, commands: list[str] | None = None,
                 require_verify_before_completion: bool | None = None,
                 max_require_verify_retries: int = 3): ...
    # 代码修改后自动运行质量检查
    # 支持合成工具调用 __completion_check__ 强制继续执行
```

### EvaluatorMiddleware

```python
class EvaluatorMiddleware(AgentMiddleware):
    def __init__(self, cwd: str, max_retries: int = 2): ...
    # 基于 .prax/evaluator.yaml 中的 criteria 评估最终响应
    # 未满足时注入合成工具调用 __evaluator_feedback__
```

---

## 8. Sandbox 抽象

```python
class Sandbox(ABC):
    @abstractmethod
    def execute_command(self, command: str, timeout: int = 60) -> str: ...
    @abstractmethod
    def read_file(self, path: str) -> str: ...
    @abstractmethod
    def write_file(self, path: str, content: str, append: bool = False) -> None: ...
    @abstractmethod
    def list_dir(self, path: str, max_depth: int = 2) -> list[str]: ...
    def execute_command_v2(self, command: str, timeout: int = 60) -> SandboxResult: ...

@dataclass
class SandboxResult:
    output: str
    exit_code: int
    timed_out: bool = False
```

---

## 9. GovernanceConfig

```python
@dataclass
class GovernanceConfig:
    max_budget_tokens: int | None = None      # Token 预算
    max_iterations: int = 25                  # 最大迭代次数
    max_tool_calls_per_tool: int | None = None
    risk_threshold: int = 15
    permission_mode: str = "workspace_write"  # "read-only" | "workspace-write" | "danger-full-access"
    require_approval_above_risk: int | None = None
    max_llm_calls_per_minute: int | None = None
```

支持从 YAML 文件加载，并通过 `mtime` 缓存实现热重载。
