# Wiki Index

LLM-generated knowledge base for harness-kit. Updated on every significant change.

## Docs

用户文档位于 [docs/](../docs/)：

| 文档 | 说明 |
|------|------|
| [docs/README.md](../docs/README.md) | 文档入口 |
| [快速开始](../docs/guides/quick-start.md) | 安装、构建、首次运行 |
| [架构](../docs/reference/architecture.md) | 系统分层、执行模式、数据流 |
| [配置](../docs/reference/configuration.md) | CLI 参数、环境变量 |
| [文件地图](../docs/reference/file-map.md) | 按职责分类的完整文件索引 |
| [调试](../docs/guides/debugging.md) | 调试技巧 |
| [故障排除](../docs/guides/troubleshooting.md) | 常见问题及解决方案 |

## Wiki Pages

| Page | Description |
|------|-------------|
| [architecture](architecture.md) | System design, data flow, component relationships |
| [tech-stack](tech-stack.md) | Dependencies, tools, versions |
| [acp-protocol](acp-protocol.md) | tmux-bridge IPC protocol, read guard, message format |
| [pi-integration](pi-integration.md) | PI Extension API, events, tool registration |
| [design-decisions](design-decisions.md) | Key decisions with rationale |
| [agent-runtime-plan](agent-runtime-plan.md) | Agent Runtime 重构计划（双 Agent 架构） |
| [conventions](conventions.md) | Code style, naming, patterns |
| [log](log.md) | Chronological activity log |

## Reference Repositories

源码解读文档 — 供 harness-kit 设计参考的第三方项目。

| Repository | Entry | Description |
|------------|-------|-------------|
| pi | [idea-repo/pi/overview.md](idea-repo/pi/overview.md) | PI Agent Harness — 交互式编码代理 CLI（TypeScript, 4 包 monorepo） |
| pi-mono | [idea-repo/pi-mono/overview.md](idea-repo/pi-mono/overview.md) | pi-mono — PI 的 monorepo 演进版（5 包，含 web-ui） |
| prax-agent | [idea-repo/prax-agent/overview.md](idea-repo/prax-agent/overview.md) | Prax Agent — Python 编码代理运行时（middleware、记忆系统、错误恢复） |
| hermes-agent | [idea-repo/hermes-agent/overview.md](idea-repo/hermes-agent/overview.md) | Hermes Agent — Nous Research 自进化 AI Agent（上下文引擎、工具护栏） |

## Raw Sources (immutable)

| Source | Path |
|--------|------|
| Design spec | `docs/superpowers/specs/2026-05-02-harness-kit-design.md` |
| Harness engineering research | `docs/research/04-harness-engineering.md` |
| PI framework research | `docs/research/05-pi-mono.md` |
| Browser harness research | `docs/research/02-browser-harness.md` |
| Harness books research | `docs/research/03-harness-books.md` |
