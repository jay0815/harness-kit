# Hermes Agent API 参考

本文档描述 Hermes Agent 核心类与接口的公共 API。

---

## 1. ContextEngine ABC

文件: `agent/context_engine.py`

上下文引擎抽象基类，定义所有上下文管理策略必须实现的接口。

```python
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

class ContextEngine(ABC):
    """可插拔上下文管理抽象基类。"""

    @abstractmethod
    def onSessionStart(self, session_id: str, system_prompt: str) -> None:
        """会话启动时调用，初始化上下文状态。

        Args:
            session_id: 唯一会话标识符
            system_prompt: 系统提示词
        """
        ...

    @abstractmethod
    def updateFromResponse(self, response: Dict[str, Any]) -> None:
        """将模型响应合并到当前上下文。

        Args:
            response: 模型响应字典，包含 content, tool_calls 等
        """
        ...

    @abstractmethod
    def shouldCompress(self, context: List[Dict[str, Any]], max_tokens: int) -> bool:
        """判断当前上下文是否需要压缩。

        Args:
            context: 当前消息列表
            max_tokens: 最大允许的 token 数

        Returns:
            是否需要压缩
        """
        ...

    @abstractmethod
    def compress(self, context: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """执行上下文压缩，返回压缩后的消息列表。

        Args:
            context: 当前消息列表

        Returns:
            压缩后的消息列表
        """
        ...

    @abstractmethod
    def assembleContext(self) -> List[Dict[str, Any]]:
        """组装最终发送给模型的消息列表。

        Returns:
            完整的消息列表（含 system prompt）
        """
        ...

    @abstractmethod
    def onSessionEnd(self, session_id: str) -> None:
        """会话结束时调用，执行清理工作。

        Args:
            session_id: 会话标识符
        """
        ...
```

### 默认实现: ContextCompressor

文件: `agent/context_compressor.py`

```python
class ContextCompressor(ContextEngine):
    """基于阈值的默认上下文压缩器。

    当上下文占用超过 max_tokens 的 threshold_percent 时触发压缩。
    压缩策略：保留系统提示和最近 N 条消息，对早期消息生成摘要。
    """

    def __init__(self, threshold_percent: float = 0.75):
        self.threshold_percent = threshold_percent
        self._context: List[Dict[str, Any]] = []
        self._system_prompt: str = ""
```

---

## 2. ToolCallGuardrailController

文件: `agent/tool_guardrails.py`

每轮对话级别的工具调用安全控制器。

```python
from enum import Enum
from typing import Dict, List, Any, Optional
from dataclasses import dataclass

class GuardrailAction(Enum):
    """护栏决策动作。"""
    ALLOW = "allow"      # 允许执行
    WARN = "warn"        # 记录警告但继续
    BLOCK = "block"      # 阻止该工具调用
    HALT = "halt"        # 终止本轮对话

class ToolClassification(Enum):
    """工具分类。"""
    IDEMPOTENT = "idempotent"   # 幂等工具
    MUTATING = "mutating"       # 变更工具

@dataclass
class ToolCallRecord:
    """单次工具调用记录。"""
    tool_name: str
    arguments: Dict[str, Any]
    result: Any
    error: Optional[str] = None
    timestamp: float = 0.0

class ToolCallGuardrailController:
    """工具调用护栏控制器。

    在每轮对话中跟踪工具调用历史，检测异常模式并采取行动。
    """

    def __init__(
        self,
        max_same_failure: int = 3,
        max_tool_failure_streak: int = 5,
        max_no_progress_idempotent: int = 4,
    ):
        self.max_same_failure = max_same_failure
        self.max_tool_failure_streak = max_tool_failure_streak
        self.max_no_progress_idempotent = max_no_progress_idempotent
        self._history: List[ToolCallRecord] = []

    def track(self, record: ToolCallRecord) -> None:
        """记录一次工具调用。

        Args:
            record: 工具调用记录
        """
        ...

    def check(self, tool_name: str, arguments: Dict[str, Any]) -> GuardrailAction:
        """检查即将执行的工具调用是否安全。

        检测规则（按优先级）：
        1. 相同失败重复: 同一工具+参数+错误连续 >= max_same_failure → HALT
        2. 同工具失败链: 同一工具连续失败 >= max_tool_failure_streak → BLOCK
        3. 无进展幂等: 幂等工具连续返回相同结果 >= max_no_progress_idempotent → WARN

        Args:
            tool_name: 工具名称
            arguments: 工具参数

        Returns:
            护栏决策动作
        """
        ...

    def classify_tool(self, tool_name: str) -> ToolClassification:
        """对工具进行分类。

        Args:
            tool_name: 工具名称

        Returns:
            IDEMPOTENT 或 MUTATING
        """
        ...

    def reset(self) -> None:
        """重置本轮历史记录。"""
        ...
```

---

## 3. MemoryProvider ABC

文件: `agent/memory_provider.py`

记忆提供者抽象基类，统一外部记忆后端的接口。

```python
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional

class MemoryProvider(ABC):
    """记忆提供者抽象基类。

    每个会话最多激活一个外部 MemoryProvider 实例。
    生命周期: initialize → prefetch → sync_turn → get_tool_schemas
    """

    @abstractmethod
    def initialize(self, config: Dict[str, Any]) -> None:
        """初始化记忆提供者。

        Args:
            config: 提供者特定配置
        """
        ...

    @abstractmethod
    def prefetch(self, session_id: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """在会话开始时预取相关记忆。

        Args:
            session_id: 会话标识符
            context: 当前上下文信息

        Returns:
            相关记忆条目列表
        """
        ...

    @abstractmethod
    def sync_turn(self, session_id: str, turn_data: Dict[str, Any]) -> None:
        """每轮对话结束后同步记忆。

        Args:
            session_id: 会话标识符
            turn_data: 本轮对话数据（用户输入、模型响应、工具结果等）
        """
        ...

    @abstractmethod
    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """返回记忆相关的工具模式定义。

        这些工具会被注入到模型的可用工具列表中，
        允许模型主动查询/修改记忆。

        Returns:
            JSON Schema 格式的工具定义列表
        """
        ...

    @abstractmethod
    def shutdown(self) -> None:
        """关闭提供者，释放资源。"""
        ...
```

### 内置提供者

| 提供者 | 模块路径 | 说明 |
|---|---|---|
| Honcho | `plugins/memory/honcho/` | 用户级记忆层 |
| Mem0 | `plugins/memory/mem0/` | 个性化 AI 记忆 |
| Hindsight | `plugins/memory/hindsight/` | 事后反思记忆 |
| Supermemory | `plugins/memory/supermemory/` | 超级记忆系统 |

---

## 4. ToolRegistry

文件: `tools/registry.py`

自注册工具发现与管理。

```python
from typing import Dict, Callable, Any, Optional, List
import ast

class ToolRegistry:
    """工具注册表（单例模式）。

    通过 AST 扫描自动发现 @registry.register() 装饰器标记的工具。
    使用 generation 计数器跟踪注册表变更，TTL 缓存工具验证函数。
    """

    _instance: Optional["ToolRegistry"] = None
    _generation: int = 0
    _check_fn_ttl: float = 30.0  # 秒

    def __new__(cls) -> "ToolRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._tools: Dict[str, Dict[str, Any]] = {}
            cls._instance._check_cache: Dict[str, Any] = {}
        return cls._instance

    def register(
        self,
        name: Optional[str] = None,
        description: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Callable:
        """工具注册装饰器。

        Args:
            name: 工具名称（默认使用函数名）
            description: 工具描述
            parameters: JSON Schema 参数定义

        Returns:
            装饰器函数
        """
        ...

    def discover(self, module_path: str) -> int:
        """通过 AST 扫描发现模块中的工具注册。

        解析指定模块的 AST，查找所有 registry.register() 调用，
        提取工具元数据并注册。

        Args:
            module_path: Python 模块路径

        Returns:
            新发现的工具数量
        """
        ...

    def get(self, name: str) -> Optional[Dict[str, Any]]:
        """获取指定工具的元数据。

        Args:
            name: 工具名称

        Returns:
            工具元数据字典，包含 name, description, parameters, handler
        """
        ...

    def list_tools(self) -> List[str]:
        """列出所有已注册工具名称。

        Returns:
            工具名称列表
        """
        ...

    def get_check_fn(self, tool_name: str) -> Optional[Callable]:
        """获取工具的参数校验函数（带 TTL 缓存）。

        Args:
            tool_name: 工具名称

        Returns:
            校验函数或 None
        """
        ...

    @property
    def generation(self) -> int:
        """当前注册表版本号，每次注册新工具时递增。"""
        return self._generation
```

---

## 5. AIAgent

文件: `run_agent.py`

核心编排器类。

```python
from typing import Dict, List, Any, Optional, AsyncIterator
from dataclasses import dataclass

@dataclass
class AgentConfig:
    """Agent 配置数据类。"""
    model: str
    provider: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    max_context_tokens: int = 128000
    compression_threshold: float = 0.75
    stream: bool = True
    cache_enabled: bool = True
    guardrail_enabled: bool = True
    max_iterations: int = 50
    tool_timeout: float = 120.0
    blocked_tools: Optional[List[str]] = None

class AIAgent:
    """Hermes Agent 核心编排器。

    协调上下文引擎、记忆系统、工具执行、错误恢复等子系统，
    完成完整的对话会话。
    """

    def __init__(
        self,
        # 模型配置 (~10 参数)
        model: str,
        provider: str = "anthropic",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        # 上下文管理 (~8 参数)
        context_engine: Optional[Any] = None,
        max_context_tokens: int = 128000,
        compression_threshold: float = 0.75,
        # 记忆配置 (~8 参数)
        memory_provider: Optional[Any] = None,
        honcho_config: Optional[Dict] = None,
        mem0_config: Optional[Dict] = None,
        # 工具配置 (~10 参数)
        toolsets: Optional[List[str]] = None,
        blocked_tools: Optional[List[str]] = None,
        tool_timeout: float = 120.0,
        # 安全/护栏 (~8 参数)
        guardrail_enabled: bool = True,
        max_iterations: int = 50,
        iteration_budget: Optional[int] = None,
        # 流式/缓存 (~6 参数)
        stream: bool = True,
        cache_enabled: bool = True,
        cache_ttl: int = 300,
        # 网关相关 (~6 参数)
        gateway_mode: bool = False,
        platform_adapter: Optional[str] = None,
        session_ttl: int = 3600,
        # 其他 (~4 参数)
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        **kwargs,
    ) -> None:
        """初始化 AIAgent。

        总计约 60 个参数，涵盖模型、上下文、记忆、工具、安全、流式、网关等配置。
        """
        ...

    async def run(
        self,
        user_input: str,
        session_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> AsyncIterator[str]:
        """运行一次完整的用户交互。

        流式返回模型生成的内容片段。

        Args:
            user_input: 用户输入文本
            session_id: 会话标识符（None 则新建）
            context: 额外上下文数据

        Yields:
            内容字符串片段
        """
        ...

    async def run_turn(
        self,
        messages: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """执行单轮对话（内部使用）。

        包含完整的 7 个阶段：预检压缩 → API 调用 → 错误恢复 →
        响应验证 → 工具执行 → 空响应恢复 → 轮次退出诊断。

        Args:
            messages: 当前消息列表

        Returns:
            轮次结果字典
        """
        ...

    def get_session_state(self) -> Dict[str, Any]:
        """获取当前会话状态。"""
        ...

    def save_session(self, session_id: str) -> None:
        """持久化会话到 SQLite 存储。"""
        ...

    def load_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """从 SQLite 存储恢复会话。"""
        ...
```

---

## 6. DelegateTool

文件: `tools/delegate_tool.py`

子代理委派工具（~2,801 LOC）。

```python
from typing import Dict, Any, Optional, List

class DelegateTool:
    """子代理委派工具。

    生成隔离上下文的子 AIAgent 实例执行特定任务。
    子代理自动阻断危险工具，防止无限递归。
    """

    # 子代理默认阻断的工具列表
    BLOCKED_TOOLS_FOR_CHILDREN: List[str] = [
        "delegate_task",
        "clarify",
        "memory",
        # ... 其他危险工具
    ]

    def __init__(self, parent_agent: "AIAgent") -> None:
        """初始化委派工具。

        Args:
            parent_agent: 父 Agent 实例，用于继承配置
        """
        ...

    async def delegate(
        self,
        task: str,
        context: Optional[Dict[str, Any]] = None,
        tools: Optional[List[str]] = None,
        max_turns: int = 10,
        inherit_memory: bool = False,
    ) -> Dict[str, Any]:
        """委派任务给子代理。

        Args:
            task: 任务描述
            context: 传递给子代理的上下文
            tools: 子代理可用工具列表（None = 继承父代理工具并过滤）
            max_turns: 子代理最大轮次数
            inherit_memory: 是否继承父代理记忆

        Returns:
            包含 result, turns_used, tools_called 的结果字典
        """
        ...

    def _create_child_agent(
        self,
        task: str,
        allowed_tools: List[str],
    ) -> "AIAgent":
        """创建隔离的子 Agent 实例。

        子 Agent 继承父 Agent 的模型配置，但使用独立的：
        - 上下文引擎实例
        - 会话存储
        - 工具注册表（过滤后）
        - 迭代预算
        """
        ...
```

---

## 7. PromptCaching

文件: `agent/prompt_caching.py`

Anthropic 提示缓存控制。

```python
from typing import Dict, List, Any, Optional

class PromptCaching:
    """Anthropic cache_control 注入器。

    通过在消息列表中注入 `cache_control` 标记，
    启用 Anthropic API 的前缀缓存，实现约 75% 的输入 token 成本降低。
    """

    def __init__(self, enabled: bool = True, ttl_seconds: int = 300) -> None:
        self.enabled = enabled
        self.ttl_seconds = ttl_seconds

    def inject_cache_control(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """向消息列表注入 cache_control 标记。

        策略：
        1. system prompt 标记为 ephemeral（临时缓存）
        2. 早期消息（前缀）标记为 persistent（持久缓存）
        3. 最近消息不标记（不参与缓存）

        Args:
            messages: 消息列表
            system_prompt: 系统提示词

        Returns:
            包含 messages 和 system 的 API 请求体
        """
        ...

    def compute_cache_savings(self, usage: Dict[str, int]) -> Dict[str, float]:
        """计算缓存节省的 token 和成本。

        Args:
            usage: API 返回的 usage 数据

        Returns:
            包含 input_tokens, cached_tokens, savings_percent 的字典
        """
        ...
```

---

## 8. ErrorClassifier

文件: `agent/error_classifier.py`

结构化 API 错误分类。

```python
from enum import Enum
from typing import Dict, Any, Optional
from dataclasses import dataclass

class ErrorCategory(Enum):
    """错误分类。"""
    UNICODE_ENCODE = "unicode_encode"       # Unicode 编码错误
    IMAGE_REJECTED = "image_rejected"       # 图片被拒绝
    CONTEXT_OVERFLOW = "context_overflow"   # 上下文溢出
    RATE_LIMIT = "rate_limit"               # 速率限制
    AUTH_FAILURE = "auth_failure"           # 认证失败
    SERVER_ERROR = "server_error"           # 服务端错误
    UNKNOWN = "unknown"                     # 未知错误

class RecoveryStrategy(Enum):
    """恢复策略。"""
    RETRY = "retry"                         # 直接重试
    BACKOFF_RETRY = "backoff_retry"         # 退避重试
    TRUNCATE_RETRY = "truncate_retry"       # 截断后重试
    REMOVE_IMAGE_RETRY = "remove_image"     # 移除图片重试
    FALLBACK_PROVIDER = "fallback"          # 切换提供者
    ABORT = "abort"                         # 中止

@dataclass
class ClassifiedError:
    """分类后的错误。"""
    category: ErrorCategory
    strategy: RecoveryStrategy
    retry_after: Optional[float] = None
    message: str = ""

class ErrorClassifier:
    """API 错误分类器。

    将原始异常映射到预定义的错误类别和恢复策略。
    """

    def classify(self, error: Exception, context: Optional[Dict] = None) -> ClassifiedError:
        """分类错误并推荐恢复策略。

        恢复优先级（从高到低）：
        1. UnicodeEncodeError → REMOVE_IMAGE_RETRY
        2. 图片拒绝 → REMOVE_IMAGE_RETRY
        3. 413 Payload Too Large → TRUNCATE_RETRY
        4. 上下文溢出 → TRUNCATE_RETRY
        5. 429 速率限制 → BACKOFF_RETRY
        6. 401/403 认证失败 → ABORT

        Args:
            error: 原始异常
            context: 当前请求上下文

        Returns:
            分类后的错误信息
        """
        ...
```

---

## 9. GatewayRunner

文件: `gateway/run.py`

网关服务运行器。

```python
from typing import Dict, Any, Optional, Callable
from collections import OrderedDict
import time

class GatewayRunner:
    """多平台 Agent 网关服务。

    管理多个平台适配器，维护 LRU 缓存的 Agent 实例池。
    """

    def __init__(
        self,
        cache_size: int = 128,
        idle_ttl: int = 3600,
        config: Optional[Dict[str, Any]] = None,
    ) -> None:
        """初始化网关。

        Args:
            cache_size: LRU 缓存最大 Agent 数
            idle_ttl: 空闲 Agent 淘汰时间（秒）
            config: 全局配置
        """
        self.cache_size = cache_size
        self.idle_ttl = idle_ttl
        self._agents: OrderedDict[str, Any] = OrderedDict()
        self._last_access: Dict[str, float] = {}
        self._adapters: Dict[str, Callable] = {}

    def register_adapter(self, platform: str, adapter: Callable) -> None:
        """注册平台适配器。

        Args:
            platform: 平台名称
            adapter: 适配器函数/类
        """
        ...

    async def handle_message(
        self,
        platform: str,
        session_id: str,
        user_input: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """处理来自平台的消息。

        流程：
        1. 查找/创建 Agent 实例（LRU 缓存）
        2. 检查空闲 TTL，过期则重建
        3. 调用 Agent.run() 获取响应
        4. 更新访问时间

        Args:
            platform: 平台名称
            session_id: 会话标识符
            user_input: 用户输入
            metadata: 平台特定元数据

        Returns:
            模型响应文本
        """
        ...

    def _get_or_create_agent(self, session_id: str) -> "AIAgent":
        """从缓存获取或新建 Agent 实例。"""
        ...

    def _evict_idle_agents(self) -> int:
        """淘汰空闲超时的 Agent，返回淘汰数量。"""
        ...

    async def start(self) -> None:
        """启动网关服务，监听所有已注册平台。"""
        ...

    async def stop(self) -> None:
        """停止网关，清理所有 Agent 资源。"""
        ...
```

---

## 10. HermesState

文件: `hermes_state.py`

SQLite 会话存储。

```python
from typing import Dict, Any, Optional, List
import sqlite3

class HermesState:
    """SQLite 会话存储管理器。

    使用 WAL 模式保证并发安全，FTS5 支持全文搜索，
    schema version 13 支持会话来源标记。
    """

    SCHEMA_VERSION: int = 13

    def __init__(self, db_path: Optional[str] = None) -> None:
        """初始化存储。

        Args:
            db_path: 数据库文件路径（None 则使用默认路径）
        """
        ...

    def create_session(
        self,
        session_id: str,
        source: str = "cli",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """创建新会话。

        Args:
            session_id: 会话标识符
            source: 来源标记（cli, telegram, discord, web 等）
            metadata: 会话元数据
        """
        ...

    def save_turn(
        self,
        session_id: str,
        turn_data: Dict[str, Any],
    ) -> None:
        """保存单轮对话数据。"""
        ...

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """获取完整会话数据。"""
        ...

    def search_sessions(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """使用 FTS5 全文搜索会话。"""
        ...

    def migrate_schema(self) -> None:
        """执行数据库 schema 迁移到最新版本。"""
        ...
```
