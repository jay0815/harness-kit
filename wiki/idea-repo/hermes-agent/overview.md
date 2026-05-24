# Hermes Agent 项目概览

> **项目**: Hermes Agent — 自进化 AI Agent
> **版本**: 0.14.0
> **语言**: Python >= 3.11
> **许可证**: MIT
> **最新提交**: `3bace071b` — "fix(state): restrict sensitive store file permissions"
> **规模**: 约 985K 行代码，1,832 个 Python 文件
> **维护方**: Nous Research

---

## 简介

Hermes Agent 是由 Nous Research 开发的一款自进化 AI Agent 框架。它以**流式优先**的 API 调用为核心，通过可插拔的上下文引擎、工具护栏、记忆提供者和子代理委派等机制，构建了一个高度模块化、可扩展的智能体运行时。

该项目的设计哲学强调：

- **安全优先**: 精确锁定的依赖版本、敏感文件权限限制、工具调用护栏
- **可扩展性**: 基于 ABC 的插件体系（上下文引擎、记忆后端、模型提供者）
- **健壮性**: 多层错误恢复、空响应恢复、流超时检测
- **性能**: Anthropic 提示缓存（约 75% 输入 token 成本降低）、LRU 代理缓存、并发工具执行

---

## 与 harness-kit 的关联

harness-kit 在构建其 Agent 运行时参考了 Hermes Agent 的多个核心抽象：

| Hermes Agent 组件 | harness-kit 对应概念 | 说明 |
|---|---|---|
| `ContextEngine` ABC | 上下文管理接口 | 可插拔的上下文压缩与组装策略 |
| `ToolCallGuardrailController` | 工具调用护栏 | 每轮对话的循环检测与安全控制 |
| `IterationBudget` | 迭代预算 | 限制单轮/总会话的工具调用次数 |
| `MemoryProvider` ABC | 记忆提供者接口 | 外部记忆后端的统一抽象 |
| `PromptCaching` | 提示缓存 | Anthropic `cache_control` 注入机制 |

这些抽象为 harness-kit 的 ACP（Agent Communication Protocol）运行时提供了重要的设计参考。

---

## 核心特性

| 特性 | 说明 |
|---|---|
| **可插拔上下文引擎** | 基于 ABC 的上下文管理，默认实现为阈值压缩器（threshold_percent=0.75） |
| **工具护栏** | 每轮检测：重复失败、同工具失败链、无进展幂等调用 |
| **自注册工具发现** | 基于 AST 解析的 `registry.register()` 自动发现，带 TTL 缓存 |
| **记忆提供者插件** | 内置支持 Honcho、Mem0、Hindsight、Supermemory，限制一个外部提供者 |
| **子代理委派** | 隔离上下文的子 Agent 生成，自动阻断危险工具 |
| **SQLite 会话存储** | WAL 模式、FTS5 全文搜索、会话来源标记 |
| **多平台网关** | 15+ 平台适配器（Telegram、Discord、Slack 等），LRU 代理缓存 |
| **流式 API 优先** | 90 秒过期流检测，实时响应交付 |
| **后台审查** | 记忆/技能审查在响应交付后异步执行 |

---

## 文档导航

| 文档 | 内容 |
|---|---|
| [architecture.md](./architecture.md) | 系统架构、组件关系、数据流、Mermaid 图表 |
| [api.md](./api.md) | 核心类与接口的 API 参考 |
| [design.md](./design.md) | 关键设计决策与模式详解 |
| [源码目录指引说明.md](./源码目录指引说明.md) | 源码树结构、文件职责、阅读路径 |

---

## 快速开始（阅读路径）

```
1. overview.md（本文档）→ 了解项目全貌
2. 源码目录指引说明.md → 熟悉代码结构
3. architecture.md → 理解系统架构
4. api.md → 查阅具体接口
5. design.md → 深入设计 rationale
```

---

## 关键指标

| 指标 | 数值 |
|---|---|
| 核心编排器（`run_agent.py`） | ~4,309 LOC |
| 对话循环（`conversation_loop.py`） | ~4,231 LOC |
| 会话存储（`hermes_state.py`） | ~3,279 LOC |
| 终端工具（`terminal_tool.py`） | ~2,405 LOC |
| 委派工具（`delegate_tool.py`） | ~2,801 LOC |
| 工具编排（`model_tools.py`） | ~923 LOC |
| 工具集定义（`toolsets.py`） | ~876 LOC |
| 网关平台适配器 | 15+ |
| 网关 LRU 缓存大小 | 128 agents |
| 网关空闲 TTL | 1 小时 |
| 工具线程池最大工作者 | 8 |
| 提示缓存成本降低 | ~75% |
