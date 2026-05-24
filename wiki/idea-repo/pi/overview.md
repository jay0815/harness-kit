# Pi Agent Harness 概述

## 项目简介

**Pi Agent Harness** 是一个交互式编码代理 CLI（命令行界面）——基于终端的 AI 辅助软件开发助手。它提供了一个完整的框架，用于构建、运行和扩展由大语言模型（LLM）驱动的智能代理应用。

| 属性 | 值 |
|------|-----|
| 版本 | 0.0.3 |
| 最新提交 | `fc51a40d` — "Merge pull request #4922 from earendil-works/horrifying-terminal-hack" |
| 语言 | TypeScript, ESM |
| 结构 | Monorepo（4 个包） |
| 引擎要求 | Node.js >= 22.19.0 |

## 与 harness-kit 的关系

harness-kit 是基于 Pi Agent Harness 构建的上层编排框架：

- **Pi** 提供底层基础设施：TUI 渲染、LLM  Provider 抽象、Agent 循环引擎、会话树管理
- **harness-kit** 在此基础上增加结构化工作流编排、硬事实验证、多阶段任务分解

Pi 是 harness-kit 的"基座"（base PI framework），harness-kit 对其进行封装和扩展，添加了更高层次的 agent 协作能力。

## 包结构

```
packages/
├── tui/           # 终端用户界面 — 差分渲染、组件系统
├── ai/            # LLM Provider 抽象 — 多 Provider 流式 API
├── agent/         # 核心 Agent 引擎 — 事件循环、工具执行、会话管理
└── coding-agent/  # 交互式编码应用 — 扩展系统、工具实现、会话管理器
```

### 各包职责

| 包 | 职责 | 关键文件 |
|----|------|---------|
| `tui` | 终端 UI 渲染，支持差分更新达到 60fps | `tui.ts`, `terminal.ts`, `components/` |
| `ai` | 统一 LLM 调用接口，支持 9+ Provider | `stream.ts`, `api-registry.ts`, `providers/` |
| `agent` | Agent 生命周期、事件循环、工具执行、会话持久化 | `agent.ts`, `agent-loop.ts`, `agent-harness.ts` |
| `coding-agent` | 面向编码场景的应用层，扩展系统、内置工具 | `agent-session.ts`, `extensions/types.ts`, `tools/` |

## 架构分层

```
┌─────────────────────────────────────────┐
│         Coding Agent (应用层)            │  ← 扩展系统、编码工具、会话管理
├─────────────────────────────────────────┤
│           Agent Core (引擎层)            │  ← Agent 循环、事件流、工具执行
├─────────────────────────────────────────┤
│         AI Provider (Provider 层)        │  ← 多 Provider 抽象、流式 API
├─────────────────────────────────────────┤
│            TUI (界面层)                  │  ← 差分渲染、组件系统、终端协议
└─────────────────────────────────────────┘
```

## 文档导航

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 架构图、数据流、组件映射、核心循环详解 |
| [api.md](./api.md) | ExtensionAPI、Agent 类 API、事件钩子、Provider 注册、Result 模式 |
| [design.md](./design.md) | 差分渲染、会话树压缩、队列模式、工具执行流水线、扩展系统、懒加载 |
| [源码目录指引说明.md](./源码目录指引说明.md) | 源码树、文件职责表、按类别索引、新开发者阅读路径 |

## 关键技术特性

- **差分终端渲染**：只重绘变更的行，实现 60fps 流畅体验
- **多 Provider 支持**：Anthropic、OpenAI、Azure、Google、Mistral、Bedrock 等 9+ Provider
- **事件驱动架构**：基于 `EventStream<T, R>` 的异步事件迭代
- **会话树与分支**：支持分支、压缩、分支摘要，类似 Git 的会话历史
- **扩展系统**：基于 jiti 的 TypeScript 扩展热加载
- **Result<T, E> 模式**：显式错误处理，避免异常控制流
- **队列模式**： steering（转向）和 follow-up（跟进）消息的灵活队列策略
