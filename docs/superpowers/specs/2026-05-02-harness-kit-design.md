# harness-kit 设计文档

> 日期：2026-05-02
> 状态：草案
> 作者：harness-kit 项目团队

## 1. 项目定位

### 1.1 harness-kit 是什么

harness-kit 是一个**让 coding agent 可靠运行的编排层**。它不是一个完整的 agent framework，也不是一个模型——它是包裹在现有 coding agent（Claude Code、Codex、Kimi 等）之外的**harness**，负责：

1. **workflow 编排**：按照 YAML 配置的阶段序列，驱动 coding agent 完成复杂任务
2. **多 agent 协同**：通过 ACP（Agent Communication Protocol）建立跨 pane 的聊天室，让多个 LLM 实例相互论证
3. **事实确认**：通过"LLM 声明事实 + 代码硬校验 CLI"的机制，确保 agent 真实阅读文件、不编造事实

### 1.2 harness-kit 不是什么

- **不是 agent framework**：底层 agent loop 由 PI 提供，harness-kit 不重新发明
- **不是替代 coding agent**：Claude Code / Codex 等仍然是实际干活的执行者，harness-kit 是驱动它们的编排器
- **不是通用 AI 平台**：聚焦 coding 场景，但架构可扩展到其他终端驱动型任务

### 1.3 与参考仓库的关系

| 参考仓库 | 学到的核心 lesson | 在 harness-kit 中的体现 |
|---|---|---|
| awesome-harness-engineering | "Agent = Model + Harness" | harness-kit 就是 coding agent 的 harness |
| browser-harness | "反框架"——原语暴露、物理边界 | harness-kit 对 PI 也是"薄层"，不封装PI的内部 |
| harness-books | "Prompt 决定怎么说，Harness 决定怎么做" | workflow YAML 是 harness 的"怎么做" |
| harness-engineering | "仓库即记录系统 + 机械化执行" | 事实硬校验 CLI 就是"机械化执行" |

---

## 2. 核心架构

### 2.1 技术栈

```
PI (agent loop) → harness-kit (PI agent)
  ├── workflow YAML 定义阶段和角色
  ├── 工具：启动 smux pane → 运行 coding agent
  ├── 工具：tmux-bridge (ACP 基础层) 通信
  ├── 工具：硬校验 CLI
  └── ACP 聊天室：多个 coding agent 实例
```

### 2.2 关键组件

| 组件 | 职责 | 技术选型 |
|---|---|---|
| **PI** | 最底层 agent loop，执行 harness-kit 的动作 | `@earendil-works/pi-agent-core` (~900 行) |
| **harness-kit** | PI agent，工具集 = 启动 pane + ACP + 校验 | TypeScript，PI Extension 或独立 agent |
| **smux** | terminal multiplexer + 跨 pane 通信基础设施 | tmux + `tmux-bridge` CLI |
| **ACP** | Agent Communication Protocol，聊天室消息传递 | 基于 tmux-bridge 的轻量协议 |
| **硬校验 CLI** | 解析事实引用，实际读文件，验证匹配 | Node.js CLI，独立进程 |
| **coding agent** | 实际执行代码任务的 agent | Claude Code / Codex / Kimi CLI |

### 2.3 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    harness-kit (PI agent)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ workflow    │  │ ACP 协议    │  │ 硬校验 CLI          │  │
│  │ YAML 解析   │  │ (消息格式)  │  │ (事实验证)          │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────────▼──────────┐  │
│  │ start_agent │  │ acp_send    │  │ hard_verify         │  │
│  │ (启动 pane) │  │ (发消息)    │  │ (运行校验)          │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                         smux (tmux)                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │ pane 1  │  │ pane 2  │  │ pane 3  │  │ pane 4 (验证)   │ │
│  │ Codex   │  │ Claude  │  │ Kimi    │  │ Kimi+Codex+...  │ │
│  │ 需求理解│  │ 设计    │  │ 编码    │  │ 验证论证        │ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────────────┘ │
│              tmux-bridge: read / type / keys                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 设计哲学

### 3.1 轻量优先，渐进演化

**MVP 用方案 1（LLM 自治型）**，workflow YAML 注入 system prompt，PI agent 自主驱动流程。目标是**用最少的代码验证核心假设**：

1. ACP 跨 pane 通信是否可靠？
2. 事实硬校验 CLI 能否有效检测编造？
3. 多 agent 论证是否能提高输出质量？

验证通过后，再演进到方案 3（混合骨架型）——把阶段骨架硬编码到状态机中，提高可靠性。

**为什么先轻量**：browser-harness 的"反框架"哲学告诉我们，harness 越薄越好。在不知道哪些约束真正有效之前，不要提前构建重的骨架。

### 3.2 事实确认 = LLM 声明 + 代码硬校验

这是 harness-kit 区别于其他多 agent 系统的核心机制。

**问题**：如果只用 LLM 互相验证，当所有 LLM 都"集体降智"时，验证也会失效。

**方案**：强制每个执行者 agent 在输出中包含**事实引用**（文件路径 + 行号 + 原始内容），然后由**独立的硬校验 CLI** 实际读取文件并比对。

```
agent 输出:
  当前工作内容: 实现了用户认证中间件
  读取信息来源: src/auth.ts
  读取信息的文本: "const verifyToken = (token: string) => {...}"
  读取信息的行列: 15-23

硬校验 CLI:
  1. 读取 src/auth.ts 的 15-23 行
  2. 比对内容是否匹配
  3. 输出: PASS / FAIL + 差异详情
```

### 3.3 预设角色，可退化

**默认模式**：workflow YAML 中预定义每个阶段的执行者 agent（需求理解→Codex，设计→Claude，编码→Kimi...）。

**退化模式**：用户可以选择不预设角色，让 agent 在 ACP 聊天室中自己协商分工。

**设计理由**：预设角色提供确定性（知道谁在做什么），退化模式提供灵活性（处理未预见的场景）。两者不互斥——骨架确定角色，节点内部可协商。

### 3.4 渐进式披露

**上下文是预算，不是垃圾桶**（来自 awesome-harness-engineering 的共识）。

- workflow YAML 只包含当前阶段需要的信息
- 每个阶段启动时，harness-kit 只传递该阶段需要的上下文
- ACP 聊天室的消息只包含验证所需的信息，不塞无关内容

### 3.5 错误路径是主路径

来自 harness-books 的核心 lesson：**失败是结构性条件，不是异常事件**。

- 硬校验失败 → 预期行为，触发重试或通知人
- ACP 通信失败 → 预期行为，触发重连或切换 pane
- agent 输出不符合格式 → 预期行为，要求重新输出

---

## 4. 组件设计

### 4.1 workflow YAML

workflow 用 YAML 描述阶段序列、角色分配和验证规则。

```yaml
name: "feature-impl"
description: "实现新功能"

phases:
  - name: "需求理解"
    executor: "codex"
    context:
      files: ["docs/requirements.md"]
      prompt: "阅读需求文档，输出功能列表"
    output_format:
      - 当前工作内容
      - 读取信息来源
      - 读取信息的文本
      - 读取信息的行列
    verification:
      hard_verify: true
      human_confirm: true  # 需求理解需要人类确认
      validators: ["codex", "kimi", "claude-code", "qoder"]
    criteria:
      - 方向正确
      - 结果没有偏离
      - 输入输出一致性

  - name: "设计"
    executor: "claude"
    context:
      files: ["docs/requirements.md", "output/需求理解.md"]
      prompt: "基于需求输出技术设计文档"
    verification:
      hard_verify: true
      validators: ["codex", "kimi", "claude-code", "qoder"]

  - name: "编码"
    executor: "kimi"
    context:
      files: ["output/设计.md"]
      prompt: "实现设计文档中的功能"
    verification:
      hard_verify: true
      validators: ["codex", "kimi", "claude-code", "qoder"]

  - name: "测试"
    executor: "kimi"
    context:
      files: ["output/编码结果"]
      prompt: "编写并运行测试"
    verification:
      hard_verify: true
      validators: ["codex", "kimi", "claude-code", "qoder"]
```

### 4.2 ACP 协议（基于 tmux-bridge）

ACP 在 tmux-bridge 之上定义消息格式。

**消息格式**（JSON，通过 tmux-bridge `type` 发送）：

```json
{
  "from": "harness-kit",
  "to": "codex",
  "type": "task",
  "payload": {
    "phase": "需求理解",
    "context": {
      "files": ["docs/requirements.md"],
      "prompt": "阅读需求文档，输出功能列表"
    },
    "output_format": ["当前工作内容", "读取信息来源", "读取信息的文本", "读取信息的行列"]
  }
}
```

**消息类型**：
- `task`：分配任务
- `result`：任务结果
- `verify`：验证请求
- `verify_result`：验证结果
- `confirm`：确认请求（人工确认节点）

**通信模式**：
- harness-kit → agent：`type` 发送消息 + `keys Enter`
- agent → harness-kit：`read` 读取 pane 输出
- agent ↔ agent：通过 harness-kit 中继（harness-kit 读取 A 的输出，转发给 B）

### 4.3 硬校验 CLI

硬校验 CLI 是一个独立的 Node.js 工具，负责验证 agent 输出中的事实引用。

**输入**：agent 输出（包含事实引用的文本）
**输出**：校验报告（PASS / FAIL + 差异详情）

**工作流程**：
1. 解析 agent 输出，提取事实引用（文件路径 + 行号 + 声称的内容）
2. 实际读取文件对应位置
3. 字符串比对
4. 生成报告

```bash
harness-verify --input output/需求理解.md --report report.json
```

**校验报告格式**：
```json
{
  "overall": "FAIL",
  "facts": [
    {
      "file": "docs/requirements.md",
      "line": 15,
      "claimed": "用户需要 OAuth2 认证",
      "actual": "用户需要 JWT 认证",
      "status": "FAIL"
    }
  ]
}
```

### 4.4 执行者 agent 启动

harness-kit 通过工具调用启动 coding agent：

```typescript
// harness-kit 的工具之一
async function startAgent(role: string, context: Context): Promise<PaneId> {
  // 1. 创建 smux pane
  const pane = await tmuxBridge.createPane(role);
  
  // 2. 在 pane 中启动 coding agent
  await tmuxBridge.type(pane, `claude-code --context ${context.files.join(' ')}`);
  await tmuxBridge.keys(pane, 'Enter');
  
  // 3. 等待 agent 就绪
  await waitForReady(pane);
  
  return pane;
}
```

---

## 5. 数据流

一个典型 workflow 的完整执行流程：

```
1. harness-kit 读取 workflow YAML
2. 进入阶段 1（需求理解）
   2.1 harness-kit 启动 Codex agent（smux pane）
   2.2 harness-kit 通过 ACP 发送任务 + 上下文
   2.3 Codex 执行任务，输出结果（含事实引用）
   2.4 harness-kit 收集输出
   2.5 运行硬校验 CLI
   2.6 硬校验通过？
       是 → 进入验证环节
       否 → 通知人 / 重试
   2.7 验证环节（多 agent ACP 论证）
   2.8 验证通过？
       是 → 进入人工确认节点
       否 → 通知人 / 重试
   2.9 人工确认节点
   2.10 人类确认？
       是 → 进入阶段 2
       否 → 通知人 / 修改
3. 进入阶段 2（设计）
   ...（同上流程）
4. ...（后续阶段）
5. workflow 完成
```

---

## 6. 错误处理

### 6.1 硬校验失败

- **行为**：暂停当前阶段，生成失败报告
- **恢复**：
  - 自动重试（最多 N 次）
  - 通知人，等待人工介入
- **报告**：包含失败的 fact、预期内容、实际内容

### 6.2 验证失败（多 agent 论证不通过）

- **行为**：暂停当前阶段，收集所有验证 agent 的反对意见
- **恢复**：
  - 自动重试（用验证反馈修正上下文）
  - 通知人，等待人工决策

### 6.3 ACP 通信失败

- **行为**：检测 pane 是否存活
- **恢复**：
  - pane 存活 → 重试发送
  - pane 死亡 → 重启 pane，恢复上下文

### 6.4 Agent 输出格式不符合

- **行为**：要求 agent 重新输出，强调格式要求
- **恢复**：自动重试（最多 N 次）

---

## 7. MVP 范围

### 7.1 MVP 目标

用**最少的代码**验证 harness-kit 的核心假设：

1. ACP 跨 pane 通信是否可靠？
2. 事实硬校验 CLI 能否有效检测编造？
3. 多 agent 论证是否能提高输出质量？

### 7.2 MVP 架构（方案 1：LLM 自治型）

```
harness-kit (PI agent)
  system prompt: workflow YAML + 角色定义 + ACP 协议说明
  tools:
    - start_agent(role, context)
    - acp_send(target, message)
    - acp_read(target, lines)
    - hard_verify(output)
  → PI agent loop 自主驱动 workflow
```

**不做的事**（MVP 阶段）：
- 不做 workflow 骨架引擎（状态机）
- 不做复杂的错误恢复（失败就停，通知人）
- 不做自动确认节点（所有确认都是人工的）
- 不做角色退化（只用预设角色）

**做**（MVP 阶段）：
- workflow YAML 解析（简单注入 prompt）
- 启动/管理 smux pane
- ACP 消息发送/接收
- 硬校验 CLI
- 人工确认节点

### 7.3 MVP 工作量估计

| 模块 | 估计代码量 | 复杂度 |
|---|---|---|
| workflow YAML 解析 | ~100 行 | 低 |
| smux pane 管理 | ~200 行 | 中 |
| ACP 消息协议 | ~150 行 | 低 |
| 硬校验 CLI | ~200 行 | 中 |
| harness-kit PI agent | ~300 行 | 中 |
| **总计** | **~950 行** | **中** |

---

## 8. 演进路线

### Phase 1：MVP（方案 1）
- LLM 自治驱动 workflow
- 验证核心假设
- 时间：1-2 周

### Phase 2：骨架硬化（方案 3 的骨架部分）
- 把 workflow YAML 解析为确定性状态机
- 阶段顺序不可偏离
- 自动确认节点
- 时间：2-3 周

### Phase 3：完整 harness（方案 3）
- 阶段内部执行者自主
- 验证环节硬校验 + 多 agent 论证
- 角色退化支持
- 时间：3-4 周

### Phase 4：生态
- 预置 workflow 模板库
- 社区贡献的验证规则
- 与 CI/CD 集成

---

## 9. 关键设计决策记录

| 决策 | 选择 | 理由 | 备选 |
|---|---|---|---|
| 底层 agent loop | PI | 极简、可扩展、20+ lifecycle events | Claude Agent SDK（太重） |
| ACP 基础设施 | smux/tmux-bridge | 轻量、任何能跑 bash 的 agent 都能参与 | WebSocket（需要网络层） |
| workflow 驱动（MVP） | LLM 自治 | 最小代码量，快速验证 | 状态机（Phase 2） |
| 事实确认 | LLM 声明 + 硬校验 | 解决"集体降智"问题 | 纯 LLM 互证（不可靠） |
| 角色分配 | 预设（可退化） | 默认确定，灵活可选 | 完全不预设（太激进） |
| 确认节点 | 人工+自动 | 关键节点人工确认，常规节点自动 | 全人工（慢）/ 全自动（不可靠） |

---

## 10. 参考

- [PI Framework 调研](../../research/05-pi-mono.md)
- [Awesome Harness Engineering 调研](../../research/01-awesome-harness-engineering.md)
- [Browser Harness 调研](../../research/02-browser-harness.md)
- [Harness Books 调研](../../research/03-harness-books.md)
- [Harness Engineering 调研](../../research/04-harness-engineering.md)
- [smux](https://github.com/ShawnPana/smux)
