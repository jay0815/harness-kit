# Prax Agent 源码文档

## 项目概览

**Prax** 是一个开源的 Python 编码智能体运行时，专注于仓库级别的代码操作任务。

| 属性 | 值 |
|------|-----|
| 版本 | 0.5.5 |
| 提交 | `f6a4181fa23a9c822dceb06370871fa01cc8fd83` |
| 语言 | Python 3.10+ |
| Python 文件数 | ~140 |
| 代码总行数 | ~24,000 |
| 入口点 | `prax = "prax.main:main"` |

Prax 的定位是 Claude Code 之上的轻量级编排层（orchestration layer），通过结构化的中间件管道、智能错误恢复、分层记忆系统和意图驱动的模型路由，将单次对话扩展为可持久化、可恢复、可协作的仓库级工作流。

---

## 为什么 harness-kit 关注 Prax

harness-kit 作为 PI Extension，其目标是"通过结构化工作流编排编码智能体，并进行硬事实验证"。Prax 在以下方面提供了可直接借鉴的设计：

| Prax 特性 | harness-kit 借鉴价值 |
|-----------|---------------------|
| **中间件管道** (4 钩子 × 优先级系统) | 工作流阶段注入与拦截的标准化模式 |
| **合成工具调用** (`__completion_check__`) | 质量门控的自我修复闭环机制 |
| **错误恢复系统** (7 类型 × 7 动作) | 从"重试+睡眠"到"分类+策略"的升级路径 |
| **分层记忆系统** (L0-L3 + 时序) | 长上下文窗口下的知识注入策略 |
| **单一写入者模式** (ChangeTracker) | 共享状态的一致性保障 |
| **验证优先架构** (VerifyCommand) | 安全边界与代码正确性的双重保障 |
| **意图驱动路由** (Sisyphus) | 任务自适应的模型选择策略 |

---

## 导航

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 系统架构、数据流、Mermaid 图 |
| [api.md](./api.md) | 核心接口与数据类型 |
| [design.md](./design.md) | 设计决策与模式详解 |
| [源码目录指引说明.md](./源码目录指引说明.md) | 源码树、文件职责、阅读路径 |

---

## 快速定位

- **核心循环**: `src/prax/core/agent_loop.py` — LLM 与工具的编排主循环
- **中间件**: `src/prax/core/middleware.py` — 11 个中间件的优先级链
- **记忆系统**: `src/prax/core/memory/` — 5 层记忆 + 知识图谱 + 向量存储
- **LLM 客户端**: `src/prax/core/llm_client.py` — 多提供商统一接口
- **工具基类**: `src/prax/tools/base.py` — 权限级别与并发安全标记
- **主编排器**: `src/prax/agents/sisyphus.py` — 意图分类与任务路由
- **持续执行**: `src/prax/agents/ralph.py` — 基于待办事项的持续执行
- **并行协作**: `src/prax/agents/team.py` — DAG 感知的并行子智能体
