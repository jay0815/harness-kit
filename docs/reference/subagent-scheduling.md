# Subagent 调度

## 概述

harness-kit 支持将任务委托给外部编码代理（subagent）执行。主 agent（harness）负责调度和结果收集，subagent 专注执行单一任务。

## 架构

```
主 agent (harness)
  │
  ├─ spawn_subagent 工具
  │    ├── 构建 system prompt（任务 + 约束 + 结果文件路径）
  │    ├── 启动子进程（claude -p / codex exec / harness-agent / script）
  │    └── 返回 subagent ID
  │
  ├─ subagent 执行任务...
  │    └── 写入 /tmp/hk-result-{id}.json
  │
  ├─ collect_result 工具
  │    ├── 读取 JSON 文件
  │    ├── 验证 schema
  │    └── 返回结构化结果
  │
  └─ 主 agent 根据结果决定下一步
```

## 支持的 Subagent 类型

| 类型 | 命令 | 适用场景 |
|------|------|----------|
| `claude` | `claude -p [--settings ...] "任务"` | 复杂编码任务 |
| `codex` | `codex exec "任务"` | OpenAI 模型任务 |
| `harness-agent` | `harness-agent --prompt "任务"` | 递归调用自身 |
| `script` | 自定义命令 | 任意脚本/工具 |

## 结果文件协议

Subagent 完成任务后，将结果以 JSON 格式写入约定路径：

**路径**: `/tmp/hk-result-{subagentId}.json`

**格式**:
```json
{
  "summary": "任务完成摘要",
  "currentWork": "当前完成的工作",
  "facts": [
    {
      "file": "relative/path/to/file.ts",
      "startLine": 10,
      "endLine": 20,
      "exactText": "exact text from the file"
    }
  ],
  "reasoning": "可选的推理过程"
}
```

**字段说明**:
- `summary` (必填): 任务完成的简要描述
- `currentWork` (必填): 当前完成工作的详细描述
- `facts` (必填): 文件引用数组，每个引用包含文件路径、行号范围、精确文本
- `reasoning` (可选): 推理过程

## 使用方式

### 方式 1: 通过 Session 工具

```typescript
const session = new HarnessAgentSession({
  // ... existing config
  enableSubagent: true,
  subagentSettingsPath: "/path/to/settings.json",
});

// 主 agent 可以调用:
// spawn_subagent({ task: "...", executor: "claude", constraints: [...] })
// collect_result({ subagentId: "..." })
```

### 方式 2: 通过 WorkflowRunner

```typescript
const runner = new WorkflowRunner({
  // ... existing config
  enableSubagent: true,
  subagentSettingsPath: "/path/to/settings.json",
});
```

**Workflow YAML 配置**:
```yaml
workflow: feature-work
phases:
  - name: design
    executor: subagent
    subagentType: claude
    subagentSettings: /path/to/settings.json
    subagentTimeoutMs: 120000
    prompt: "设计认证模块的实现方案"
    constraints:
      - "只修改 src/auth/ 目录"
      - "不要修改现有测试"

  - name: implement
    executor: self
    prompt: "根据设计方案实现代码"
```

### 方式 3: 直接使用 SubagentRunner

```typescript
import { SubagentRunner } from "@harness-kit/agent";

const runner = new SubagentRunner();

// 生成 ID 和构建命令
const id = runner.generateId();
const { command, args } = runner.buildCommand({
  id,
  task: "Fix the login bug",
  executor: "claude",
  settingsPath: "/path/to/settings.json",
});

// 启动子进程（手动管理）
const proc = spawn(command, args);

// 收集结果
const result = runner.collectResult(id);
if (result.success) {
  console.log(result.block); // ResultBlock
}
```

## 失败处理

| 场景 | 处理方式 |
|------|----------|
| 超时 | `collect_result` 返回 `errorType: "timeout"` |
| 无结果文件 | `collect_result` 返回 `errorType: "no_result"` |
| JSON 格式错误 | `collect_result` 返回 `errorType: "invalid_json"` |
| Schema 验证失败 | `collect_result` 返回 `errorType: "invalid_schema"` |
| 进程崩溃 | `collect_result` 返回 `errorType: "process_crashed"` |

## 配置项

### HarnessAgentSessionConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableSubagent` | `boolean` | `false` | 启用 subagent 工具 |
| `subagentSettingsPath` | `string` | - | claude subagent 的 settings 文件路径 |

### WorkflowRunnerConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableSubagent` | `boolean` | `false` | 启用 subagent 支持 |
| `subagentSettingsPath` | `string` | - | 默认 settings 文件路径 |

### Phase (Workflow YAML)

| 字段 | 类型 | 说明 |
|------|------|------|
| `executor` | `"subagent"` | 使用 subagent 执行 |
| `subagentType` | `"claude"` \| `"codex"` \| `"harness-agent"` \| `"script"` | subagent 类型 |
| `subagentConstraints` | `string[]` | 约束条件 |
| `subagentTimeoutMs` | `number` | 超时时间（毫秒） |
| `subagentSettings` | `string` | settings 文件路径（覆盖全局配置） |

## 相关代码

| 文件 | 说明 |
|------|------|
| `packages/harness-agent/src/core/subagent/types.ts` | 类型定义 |
| `packages/harness-agent/src/core/subagent/subagent-runner.ts` | SubagentRunner 核心 |
| `packages/harness-agent/src/core/subagent/subagent-tools.ts` | spawn_subagent + collect_result 工具 |
| `packages/harness-agent/src/core/subagent/subagent-runner.test.ts` | 测试（20 个用例） |
| `packages/core/src/workflow-runner.ts` | WorkflowRunner subagent executor 集成 |
