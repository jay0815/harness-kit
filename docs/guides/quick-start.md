# 快速开始

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | >= 20 | ESM 运行时 |
| pnpm | >= 8 | 包管理器 |
| tmux | >= 3.0 | PI Extension 模式需要（Standalone 模式不需要） |

## 安装

```bash
git clone <repo-url> harness-kit
cd harness-kit
pnpm install
```

## 构建

```bash
pnpm run build            # 构建所有包
pnpm run typecheck        # 类型检查（不生成产物）
```

## 测试

```bash
pnpm run test             # 运行所有测试
pnpm run test:e2e         # E2E 测试（需要 tmux，仅 core 包）
```

## Lint / Format

```bash
pnpm run lint             # oxlint 检查
pnpm run lint:fix         # oxlint 自动修复
pnpm run fmt              # oxfmt 格式化
pnpm run fmt:check        # oxfmt 格式检查
```

> **注意**：始终使用 `pnpm run lint` 和 `pnpm run fmt`，不要使用 `npx` 或全局安装的工具。

## 运行模式

### Standalone CLI（主路径）

独立运行，不依赖 PI，middleware 全量生效：

```bash
# 直接运行
node packages/harness-agent/dist/cli.js

# 或通过 pnpm script
pnpm run harness
```

### PI Extension（可选）

在 PI 框架内运行，接入 PI 的 ExtensionAPI。当前路径会注入 current-phase scheduler prompt、注册 `complete_phase`、记录 telemetry，并通过 `sendUserMessage` 反馈 legacy 校验失败；目标路径是由 harness-kit 的 phase scheduler/state machine 管理 phase 边界。需要 PI 环境。

目标形态见 [Phase Scheduler 计划](../phase-scheduler-plan.md)。

## 项目结构

```
harness-kit/
├── packages/
│   ├── core/              # PI Extension — 工作流编排、工具、遥测
│   ├── harness-agent/     # 独立 agent runtime — middleware 管道、CLI
│   └── kimi-coder/        # Kimi 编码代理集成
├── wiki/                  # 知识库
├── docs/                  # 文档（本目录）
└── package.json           # 根配置
```

## 下一步

- [架构概览](../reference/architecture.md) — 理解系统设计
- [配置参考](../reference/configuration.md) — 了解 CLI 参数和环境变量
- [文件地图](../reference/file-map.md) — 按职责浏览源码
