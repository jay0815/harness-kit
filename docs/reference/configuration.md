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
    executor: llm | code
    prompt: "<LLM 提示>"      # executor: llm 时
    command: "<shell 命令>"    # executor: code 时
    script: "<脚本路径>"      # executor: code 时
    args: ["--flag"]          # executor: code + script 时
```

### 遥测输出

遥测事件写入 JSONL 文件，路径由 PI Extension 或 session 配置决定。

## 包级配置

### @harness-kit/agent

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `verifyMode` | `strict` | 校验模式 |
| `maxVerificationRetries` | `3` | 校验重试次数上限 |
| `maxIterations` | `undefined`（无限制） | agent loop 最大轮数 |

### @harness-kit/core

PI Extension 通过 `ExtensionAPI` 注册，无独立配置文件。工作流通过 YAML 加载。
