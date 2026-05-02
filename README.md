# harness-kit

> 让 coding agent 可靠运行的编排层。

harness-kit 是一个 **PI Extension**，它通过 tmux pane 驱动多个 coding agent（Claude Code、Codex 等）完成结构化的 workflow，并用**硬校验**确保 agent 真实阅读了文件、没有编造事实。

## 核心理念

**Agent = Model + Harness**。模型负责"想"，harness 负责"管"。harness-kit 不重新发明 agent loop——它包裹在现有 coding agent 之外，负责：

1. **Workflow 编排** — 按预设阶段（设计→实现→测试）驱动 agent 完成任务
2. **多 agent 协同** — 通过 tmux pane + ACP 让不同 LLM 实例相互验证
3. **事实硬校验** — LLM 声明事实（文件路径+行号+原文），独立 CLI 实际读盘比对

## 架构

```
PI Agent (harness-kit extension)
  ├── start_agent  → 创建 tmux pane，启动 coding agent
  ├── acp_send     → 发送结构化任务（要求 <HK_RESULT> 输出）
  ├── acp_read     → 读取 pane 输出，提取结果块
  └── hard_verify  → 比对声称的文本与磁盘实际内容
```

```
┌─────────────────┐     ACP      ┌─────────────┐
│ harness-kit     │ ───────────> │ pane:codex  │
│ (PI Extension)  │              │  需求理解   │
│                 │     ACP      ├─────────────┤
│ 4 tools         │ ───────────> │ pane:claude │
│ system prompt   │              │  设计       │
│ workflow YAML   │     ACP      ├─────────────┤
└─────────────────┘ ───────────> │ pane:codex  │
                                │  编码       │
                                └─────────────┘
```

## 快速开始

```bash
cd packages/harness-kit
npm install
npm run build

# 作为 PI 扩展加载
pi --extension ./dist/index.js

# 或使用独立 CLI 进行硬校验
./bin/harness-verify --input facts.json --workspace ./
```

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

harness-kit 会提取这些事实声明，用 `harness-verify` CLI 实际读取文件并逐字比对。**硬校验只验证"引用是否真实"，不验证"结论是否正确"**。

## 项目结构

```
packages/harness-kit/
├── src/
│   ├── index.ts          # PI Extension 入口，注入 workflow system prompt
│   ├── tools.ts          # 4 个 PI 工具定义
│   ├── pane.ts           # tmux pane 生命周期管理
│   ├── result-block.ts   # <HK_RESULT> 块解析器
│   ├── verify.ts         # 硬校验逻辑（读盘比对）
│   ├── workflow.ts       # 硬编码 3 阶段 workflow
│   ├── types.ts          # 共享类型
│   └── cli.ts            # harness-verify CLI 入口
├── bin/
│   └── harness-verify    # 独立可执行脚本
├── examples/
│   └── demo.yaml         # 示例 workflow 配置
└── AGENTS.md             # 面向 coding agent 的开发者指南
```

## 设计文档

| 文档 | 内容 |
|------|------|
| [design doc](docs/superpowers/specs/2026-05-02-harness-kit-design.md) | 完整架构设计、MVP 范围、演进路线 |
| [harness engineering 调研](docs/research/04-harness-engineering.md) | "仓库即记录系统 + 机械化执行" 方法论 |
| [PI 框架调研](docs/research/05-pi-mono.md) | PI 扩展机制、生命周期事件、工具系统 |
| [browser-harness 调研](docs/research/02-browser-harness.md) | "反框架"哲学——原语暴露、薄层设计 |
| [harness-books 调研](docs/research/03-harness-books.md) | "Prompt 决定怎么说，Harness 决定怎么做" |

## 测试

```bash
cd packages/harness-kit
npm run build
node --test dist/*.test.js
```

## License

MIT
