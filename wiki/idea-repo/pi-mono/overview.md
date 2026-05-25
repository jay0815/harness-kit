# pi-mono 项目概览

## 基本信息

| 属性 | 值 |
|------|-----|
| 全称 | Pi Monorepo |
| 版本 | v0.72.0 |
| 提交 | e4163fe9 |
| 日期 | 2026-05-02 |
| 作者 | Mario Zechner |
| 许可证 | MIT |
| 运行时 | Node.js >= 20.0.0 |
| 模块格式 | ESM |

## 项目定位

pi-mono 是原始 `pi` 仓库的 monorepo 演进版本，由 Mario Zechner 开发的极简终端编码助手框架。它将原先单体仓库中的功能拆分为 5 个独立包，采用**同步版本发布**（lockstep versioning）策略。

### 与 pi 仓库的关系

- **pi**（旧）：单体仓库，所有功能集中在单个包中
- **pi-mono**（新）：5 包 monorepo，职责分离，便于独立使用和维护
- 代码演进：从单一 CLI 工具发展为可复用的 AI 代理构建工具集

## harness-kit 为何引用 pi-mono

harness-kit 将 pi-mono 作为**核心参考实现**，主要借鉴以下子系统：

| 子系统 | pi-mono 来源 | harness-kit 用途 |
|--------|-------------|-----------------|
| Agent Loop | `packages/agent/src/agent-loop.ts` | 代理执行循环、事件协议 |
| AgentSession | `packages/coding-agent/src/core/agent-session.ts` | 会话生命周期、队列管理 |
| 扩展系统 | `packages/coding-agent/src/core/extensions/` | 插件加载、事件分发 |
| 工具模式 | `packages/coding-agent/src/core/tools/` | 工具定义、可插拔执行 |
| 上下文压缩 | `packages/coding-agent/src/core/compaction/` | 长会话压缩策略 |
| 多 Provider LLM | `packages/ai/src/` | 统一 LLM API 抽象 |

## 包结构

```
pi-mono/
├── packages/
│   ├── ai/           # @earendil-works/pi-ai      (~28K 行)
│   ├── agent/        # @earendil-works/pi-agent-core  (~1.7K 行)
│   ├── coding-agent/ # @earendil-works/pi-coding-agent  (~23K 行)
│   ├── tui/          # @earendil-works/pi-tui      (~11K 行)
│   └── web-ui/       # @earendil-works/pi-web-ui   (~14K 行, 新增)
```

### 各包简介

**1. @earendil-works/pi-ai** — 统一多 Provider LLM API
- 支持 25+ 个 Provider（OpenAI、Anthropic、Google、Mistral、Bedrock 等）
- 统一的 `streamSimple` / `completeSimple` 接口
- 懒加载 Provider 实现，减少启动开销
- 模型注册表（`models.ts` + `models.generated.ts`）

**2. @earendil-works/pi-agent-core** — 通用代理运行时
- `Agent` 类：状态管理、事件订阅、队列 API
- `runAgentLoop()` / `runAgentLoopContinue()`：核心执行循环
- 工具调用生命周期（顺序/并行执行）
- `AgentMessage` 声明合并扩展机制

**3. @earendil-works/pi-coding-agent** — 编码代理 CLI
- `AgentSession`：中央编排器（~3100 行）
- 会话树持久化与分支管理
- 扩展系统（jiti 加载、虚拟模块）
- 内置工具集（bash、read、edit、write、grep、find、ls）
- 交互式 TUI 模式

**4. @earendil-works/pi-tui** — 差分渲染 TUI 框架
- 差分渲染终端 UI（只更新变化的部分）
- 编辑器组件（支持撤销、自动补全）
- Markdown 渲染组件
- 覆盖层（Overlay）系统

**5. @earendil-works/pi-web-ui** — 浏览器 UI 组件（新增）
- 基于 Lit 的 Web Components
- `ChatPanel`、`AgentInterface` 等组件
- Artifact 渲染（HTML、Markdown、PDF、Excel 等）
- IndexedDB 持久化存储

## 导航

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 分层架构、数据流、事件生命周期、会话树 |
| [api.md](./api.md) | AgentSession API、Agent API、ExtensionAPI、pi-ai 流式 API |
| [design.md](./design.md) | 核心设计决策与原理 |
| [源码目录指引说明.md](./源码目录指引说明.md) | 源码树、文件职责、阅读路径 |
