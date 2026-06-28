# harness-kit

> 让 coding agent 可靠运行的编排层。

harness-kit 提供一个独立的 agent runtime 和可选的 PI Extension 层，通过结构化 workflow 和**硬事实校验**确保 agent 真实阅读了文件、没有编造事实。PI Extension 的目标形态是 phase scheduler/state machine，由 harness 管理 phase 边界和状态推进。

## 为什么从"编排外部 agent"转向"自己就是 agent"

两条旧路都走不通：

| 方案 | 问题 |
|------|------|
| **PI + ACP 调度外部 agent**（Claude Code、Codex） | agent 是黑盒，tmux-bridge IPC 文本解析脆弱，绑定 PI 框架的生命周期和事件模型 |
| **Claude Code SDK 直调** | 锁死单一 provider，无法支持 Codex 等其他 agent，不够通用 |

新方向：**自己拥有 agent loop**。主路径是直接 LLM 调用 + middleware pipeline（事实校验、上下文压缩、workspace guardrail、遥测采集）。Claude Code 和 Codex 作为 subagent 通过 CLI 调度（`claude -p`、`codex`），harness 给足上下文、限定范围、让其只执行一件事，结果通过 `<HK_RESULT>` 结构化回传。调度权在自己手里，不绑定任何单一 provider 或框架。

## 核心理念

**Agent = Model + Harness**。模型负责"想"，harness 负责"管"：

1. **Agent Runtime** — 独立的 agent loop，支持 middleware pipeline、工具执行、双 agent 架构（A 编排 / B 执行）
2. **事实硬校验** — LLM 声明事实（文件路径+行号+原文），独立 CLI 实际读盘比对
3. **PI Extension（可选）** — 目标是在 PI 框架内作为 phase scheduler/state machine 管理 phase 边界、校验和重试

## 包结构

```
packages/
├── harness-agent/     @harness-kit/agent — 独立 agent runtime + CLI
└── core/              @harness-kit/core  — PI Extension 层（硬校验、workflow、telemetry）
```

### @harness-kit/agent

独立 agent runtime，不依赖 PI 框架即可运行：

- **agent-loop** — 多轮 LLM 调用 + 工具执行循环，支持 iteration budget 和 abort signal
- **middleware pipeline** — beforeModel / afterModel / beforeTool / afterTool 钩子，按优先级执行
- **dual-agent** — Agent A（任务评估+编排）→ Agent B（实际执行），支持任务结果累积
- **session** — HarnessAgentSession 封装完整生命周期，ExtensionAPI 提供事件订阅
- **CLI** — 交互式 REPL，支持多 provider（anthropic、openai、deepseek 等）

### @harness-kit/core

PI Extension 层，接入 PI agent loop 的生命周期事件和工具系统。当前保留 `turn_end` 兼容路径，目标能力包括：

- **phase scheduler** — harness 拥有 currentPhase、状态持久化、phase 完成/失败/确认边界
- **`<HK_RESULT>` 校验** — 提取 agent 输出的事实声明，读盘逐字比对
- **workspace guardrails** — 检测越界文件访问
- **workflow 执行** — YAML 定义的多阶段 workflow（fail-stop、模板替换、dry-run）
- **telemetry** — JSONL 格式的运行日志
- **状态持久化** — session 恢复和去重

## 快速开始

```bash
pnpm install
pnpm run build

# 独立 CLI（需要 API key）
pnpm run harness -- --provider anthropic --model claude-sonnet-4-20250514

# 或通过 npx
npx harness-agent --help
```

CLI 默认加载 `@harness-kit/core` 扩展（如果可用）。用 `--no-extension` 进入 bare 模式。

## Agent 输出契约

被 harness-kit 驱动的 coding agent **必须** 用 `<HK_RESULT>` 块包裹结构化输出：

```
<HK_RESULT>
{
  "currentWork": "描述完成的工作",
  "facts": [
    {
      "file": "相对路径.ts",
      "startLine": 1,
      "endLine": 5,
      "exactText": "文件中实际出现的精确文本"
    }
  ],
  "reasoning": "可选的推理说明"
}
</HK_RESULT>
```

harness-kit 提取这些事实声明，用 `harness-verify` CLI 实际读取文件并逐字比对。**硬校验只验证"引用是否真实"，不验证"结论是否正确"**。

## 命令

```bash
pnpm install              # 安装依赖
pnpm run build            # 构建所有包
pnpm run test             # vitest 测试
pnpm run lint             # oxlint 检查
pnpm run typecheck        # tsc --noEmit
pnpm run harness          # 运行 CLI
```

## 设计文档

| 文档 | 内容 |
|------|------|
| [wiki](wiki/index.md) | 知识库索引：架构、技术栈、协议、设计决策 |
| [design doc](docs/superpowers/specs/2026-05-02-harness-kit-design.md) | 完整架构设计、MVP 范围、演进路线 |
| [Phase scheduler plan](docs/phase-scheduler-plan.md) | PI Extension 改造成硬 phase scheduler 的迭代计划 |
| [Phase 3 plan](docs/phase3-plan.md) | standalone CLI 实现计划 |

## License

MIT
