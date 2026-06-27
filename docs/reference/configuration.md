# 配置参考

## CLI 参数（Standalone 模式）

```bash
harness-agent [flags]
```

| 参数 | 值 | 默认值 | 说明 |
|------|-----|--------|------|
| `--provider` | string | `anthropic` | AI 提供商 |
| `--model` | string | `claude-sonnet-4-20250514` | 模型 ID |
| `--workspace` | path | `cwd` | 工作目录 |
| `--system-prompt` | string | 内置默认 | 自定义 system prompt |
| `--max-iterations` | number | 无限制 | 最大迭代轮数 |
| `--verify` | `strict` \| `warn` \| `off` | `strict` | 校验模式 |
| `--no-extension` | flag | `false` | 不加载 PI Extension |
| `--help` / `-h` | flag | — | 显示帮助 |
| `--version` / `-v` | flag | — | 显示版本 |

### 校验模式说明

| 模式 | 行为 |
|------|------|
| `strict` | 校验失败时注入错误，LLM 自动修正；持续失败则停止 |
| `warn` | 校验失败时记录警告，不阻断流程 |
| `off` | 关闭事实校验 |

## Workflow CLI 参数

```bash
harness-kit [flags]
```

| 参数 | 值 | 默认值 | 说明 |
|------|-----|--------|------|
| `-w, --workflow` | path | 内置 feature-impl | 工作流 YAML 路径 |
| `-d, --workspace` | path | `cwd` | 工作目录 |
| `-p, --provider` | string | `anthropic` | AI 提供商 |
| `-m, --model` | string | 第一个可用模型 | 模型 ID |
| `--verify` | `strict` \| `warn` \| `off` | `strict` | 校验模式 |
| `--max-iterations` | number | 无限制 | 最大迭代轮数 |
| `-h, --help` | flag | — | 显示帮助 |

## 环境变量

### API Key

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `GROQ_API_KEY` | Groq API key |
| `XAI_API_KEY` | xAI API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `XIAOMI_API_KEY` | Xiaomi MiMo Token Plan API key |

### PI Extension 环境变量

PI Extension 模式下，通过 PI 框架的环境变量配置。

## 配置文件

### 工作流 YAML

自定义工作流通过 YAML 文件定义：

```yaml
workflow: <name>
description: "<描述>"
phases:
  - name: <phase-name>
    executor: self | code | subagent
    prompt: "<LLM 提示>"              # executor: self/subagent 时
    command: "<shell 命令>"            # executor: code 时
    script: "<脚本路径>"              # executor: code 时
    args: ["--flag"]                  # executor: code + script 时
    subagentType: claude | codex | harness-agent | script  # executor: subagent 时
    subagentSettings: "/path/to/settings.json"              # executor: subagent 时
    subagentConstraints: ["constraint1", "constraint2"]     # executor: subagent 时
    subagentTimeoutMs: 300000                                # executor: subagent 时
```

### PI 配置

**~/.pi/agent/auth.json** — API key 存储：

```json
{
  "xiaomi": { "type": "api_key", "key": "your-key" }
}
```

**~/.pi/agent/models.json** — 自定义 provider 覆盖：

```json
{
  "providers": {
    "xiaomi": {
      "baseUrl": "https://token-plan-cn.xiaomimimo.com/anthropic"
    }
  }
}
```

### 遥测输出

遥测事件写入 JSONL 文件，路径由 PI Extension 或 session 配置决定。

## 包级配置

### HarnessAgentSessionConfig

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cwd` | `string` | — | 工作目录（必填） |
| `model` | `Model<Api>` | — | 模型（必填） |
| `systemPrompt` | `string` | — | System prompt（必填） |
| `streamFn` | `StreamFn` | — | Stream 函数（必填） |
| `tools` | `AgentTool[]` | `[]` | 自定义工具 |
| `maxIterations` | `number` | `50` | 最大迭代轮数 |
| `contextWindow` | `number` | `200000` | 上下文窗口大小 |
| `sessionDir` | `string` | — | Session 持久化目录 |
| `enablePersistence` | `boolean` | `false` | 启用 session 持久化 |
| `maxAutoRetries` | `number` | `3` | sendUserMessage 自动重试次数 |
| `verifyMode` | `strict` \| `warn` \| `off` | `off` | 校验模式 |
| `maxVerificationRetries` | `number` | `3` | 校验重试次数上限 |
| `middlewares` | `AgentMiddleware[]` | `[]` | 自定义 middleware（跨 prompt 复用） |
| `enableAssessment` | `boolean` | `false` | 启用 LLM 任务评估 |
| `assessmentModel` | `Model<Api>` | 主模型 | 评估用模型 |
| `contextEngine` | `ContextEngine` | — | Compaction 引擎（启用后自动注册 CompactionMiddleware） |
| `errorRecovery` | `ErrorRecoveryConfig` | — | 错误恢复配置（启用后自动注册 ErrorRecoveryMiddleware） |
| `enableSubagent` | `boolean` | `false` | 启用 subagent 工具（spawn_subagent, collect_result） |
| `subagentSettingsPath` | `string` | — | claude subagent 的 settings 文件路径 |

### WorkflowRunnerConfig

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cwd` | `string` | — | 工作目录（必填） |
| `model` | `Model<Api>` | — | 模型（必填） |
| `streamFn` | `StreamFn` | — | Stream 函数（必填） |
| `systemPrompt` | `string` | 内置默认 | System prompt |
| `workflow` | `Workflow` | — | 工作流对象 |
| `workflowPath` | `string` | — | 工作流 YAML 路径 |
| `verifyMode` | `strict` \| `warn` \| `off` | `strict` | 校验模式 |
| `maxIterations` | `number` | — | 最大迭代轮数 |
| `contextWindow` | `number` | — | 上下文窗口大小 |
| `enableSubagent` | `boolean` | `false` | 启用 subagent 支持 |
| `subagentSettingsPath` | `string` | — | 默认 settings 文件路径 |

### ErrorRecoveryConfig

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxRetriesPerTool` | `number` | `3` | 每个工具最大重试次数 |
| `maxConsecutiveUnknown` | `number` | `5` | 连续未知错误次数上限 |
| `blacklistThreshold` | `number` | `3` | 工具黑名单阈值 |
| `baseBackoffMs` | `number` | `1000` | 基础退避时间 |
| `maxBackoffMs` | `number` | `30000` | 最大退避时间 |

### CompactionConfig (ContextEngine)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `threshold` | `number` | `0.75` | 触发 compaction 的 token 使用率阈值 |
| `keepRecentTurns` | `number` | `3` | 保留最近的对话轮数 |
| `wikiDir` | `string` | `.harness-kit/wiki` | wiki 存储目录 |
| `maxWikiRetries` | `number` | `2` | wiki 生成最大重试次数 |
| `minWikiScore` | `number` | `0.7` | wiki 最低质量分数 |
| `wikiSummaryMaxTokens` | `number` | `500` | wiki summary 最大 token 数 |

### @harness-kit/core

PI Extension 通过 `ExtensionAPI` 注册，无独立配置文件。工作流通过 YAML 加载。
