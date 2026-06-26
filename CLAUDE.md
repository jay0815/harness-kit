# CLAUDE.md — harness-kit

harness-kit: 通过结构化工作流编排编码代理，并进行硬事实校验的 PI Extension。

## 技术栈

- TypeScript 6.x，ESM（`"type": "module"`）
- Node.js >= 20，pnpm workspace
- TypeBox 用于运行时 schema（`@sinclair/typebox`）

## 原则

每次变更，先问 Linus 三个问题：
1. 这是真实问题吗？
2. 有更简单的方案吗？
3. 会破坏什么吗？

基于事实思考和行动。不要讨好——当证据表明不对时，要敢于质疑。

## 命令

```bash
pnpm install              # 安装所有依赖
pnpm run build            # 构建所有包
pnpm run test             # vitest 测试
pnpm run lint             # oxlint 检查所有包
pnpm run lint:fix         # oxlint --fix 修复所有包
pnpm run fmt              # oxfmt 格式化所有包
pnpm run fmt:check        # oxfmt --check 检查格式
pnpm run typecheck        # tsc --noEmit 类型检查
```

## Monorepo

| 包 | 职责 |
|---|------|
| `@harness-kit/core` | PI Extension — 工作流编排、工具注册、遥测 |
| `@harness-kit/agent` | 独立 agent runtime — middleware 管道、CLI |
| `@harness-kit/kimi-coder` | Kimi 编码代理集成 |

Standalone CLI（`harness-agent`）直接运行 middleware。PI Extension 模式将 prompt 注入 PI 的 agent 循环。两者共用 `<HK_RESULT>` 作为唯一的 agent 输出边界。

## Wiki

知识库。**变更或执行命令前务必先查阅 wiki。** 如果不确定构建/测试命令、约定、架构或工具用法——先查 wiki，而非依赖记忆或假设。

- [index](wiki/index.md) — 完整目录
- [architecture](wiki/architecture.md) — 系统设计、数据流
- [tech-stack](wiki/tech-stack.md) — 依赖、工具、版本
- [acp-protocol](wiki/acp-protocol.md) — tmux-bridge IPC 协议、读守卫
- [pi-integration](wiki/pi-integration.md) — Extension API、事件
- [design-decisions](wiki/design-decisions.md) — 关键决策及理由
- [conventions](wiki/conventions.md) — 代码风格、命名、模式
- [log](wiki/log.md) — 活动日志

## 规则

- 仅限 ESM。禁止 `require()`。
- `strict: true`。运行时 schema 使用 TypeBox。
- 除非 WHY 不明显，否则不写注释。
- 工具 `execute` 函数内部使用同步 I/O。
- 测试与源码同目录：`foo.ts` → `foo.test.ts`（vitest）。
- 失败即停。不自动重试。
- `<HK_RESULT>` 是唯一的 agent 输出边界。
- **Lint/Format：始终使用 `pnpm run lint` 和 `pnpm run fmt`。不要使用 `npx` 或全局安装的工具。**
