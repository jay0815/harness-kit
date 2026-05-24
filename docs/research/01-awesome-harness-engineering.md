# Awesome Harness Engineering 调研

> 来源：github-repo/awesome-harness-engineering
> 调研者：parallel-agent-1
> 日期：2026-05-02

## 1. 对 harness 的定义

仓库 README 在开篇给出了清晰的定位：

> "harness engineering: the practice of shaping the environment around AI agents so they can work reliably."
>
> "Harness engineering sits at the intersection of context engineering, evaluation, observability, orchestration, safe autonomy, and software architecture."

换言之，harness 不是 agent 本身，也不是底层模型，而是**围绕 agent 构建的"环境工程"**——通过塑造上下文、约束、工具、评估和运行时，让 agent 在真实工作流（尤其是长时间运行的 coding/research 任务）中变得可靠。LangChain 的文章进一步将其归纳为 "agent = model + harness"（包含 prompts、tools、middleware、orchestration、runtime infrastructure）。Thoughtworks 则把 harness 工作分解为 context engineering、architectural constraints 与 "garbage collection against entropy" 三块。Preprint 论文提出 **CAR (Control–Agency–Runtime)** 三层分解，并提出 **HarnessCard** 作为结构化报告格式。

## 2. 分类与全景

仓库一共组织了 8 个大类：

1. **Courses & Learning Resources**：`walkinglabs/learn-harness-engineering`（基于 Electron 知识库 app 的项目制课程）。
2. **Foundations**：`OpenAI - Harness engineering`（Codex 大型应用实战）、`Anthropic - Effective harnesses for long-running agents`（initializer agent + init.sh + handoff）、`LangChain - Anatomy of an Agent Harness`（agent = model + harness 框架）。
3. **Context, Memory & Working State**：`Anthropic - Effective context engineering`（上下文窗口当作内存预算）、`Manus - Context Engineering Lessons`（KV-cache、tool masking、filesystem memory）、`HumanLayer - Writing a good CLAUDE.md`（仓库本地指令落地）。
4. **Constraints, Guardrails & Safe Autonomy**：`Anthropic - Beyond permission prompts`（sandboxing 与 policy）、`Anthropic - Code execution with MCP`（显式工具边界）、`OpenHands - Mitigating Prompt Injection`（confirmation mode + analyzer）。
5. **Specs, Agent Files & Workflow Design**：`AGENTS.md`（仓库本地 agent 指令格式）、`GitHub Spec Kit`（spec-driven development 工具链）、`12 Factor Agents`（生产级 agent 操作原则）。
6. **Evals & Observability**：`OpenAI - Trace grading`（轨迹直接打分）、`Anthropic - Demystifying Evals`、`LangChain - Improving Deep Agents with harness engineering`（仅 harness 改动就显著提升基准分）。
7. **Benchmarks**：`SWE-bench Verified`（GitHub issue 修复）、`Terminal-Bench / Harbor`（终端原生 agent）、`OSWorld / OSWorld-MCP`（真实桌面任务），以及 MCPMark、τ-bench、WebArena 等 30+ 项。
8. **Runtimes, Harnesses & Reference Implementations**：`SWE-agent`（可检视的研究级 coding agent）、`Citadel`（Claude Code/Codex 多 agent + worktree 隔离）、`Ralph Wiggum`（极简 `while :; do cat PROMPT.md | claude-code; done` 循环）。

## 3. 关键观点与共识

- **Harness 是 agent 与 model 之外的第三层**：LangChain 明确区分 framework / runtime / harness；Inngest 主张 "Your Agent Needs a Harness, Not a Framework"，把 state、retries、traces、concurrency 视为一等基础设施。
- **结果差不是模型差，是 harness 差**：HumanLayer "Skill Issue" 与 LangChain "Improving Deep Agents" 都用证据说明仅调 harness 即可显著提分；Anthropic 的 "Infrastructure noise" 指出运行时配置可掩盖排行榜上多数差距。
- **Context 是预算而不是垃圾桶**：上下文工程聚焦 KV-cache、condensation、backpressure，避免噪声烧 token。
- **Long-running 才是 harness 真正的考验**：initializer agents、self-verification、handoff artifacts、checkpoint/resume 是反复出现的设计模式。
- **Spec + 仓库本地指令是 harness 的"硬骨架"**：`CLAUDE.md` / `AGENTS.md` / spec-kit 让 agent 行为可重复、可审计。

## 4. 与 coding agent harness 的关联

直接适用于"让 coding agent 稳定执行 workflow"的内容非常密集：

- **Foundations** 全部命中：OpenAI/Anthropic 的 harness 文章、HumanLayer "Skill Issue"、Inngest "Harness not Framework" 都是 coding agent 实践经验。
- **Context** 类的 CLAUDE.md 写法、context condensation、backpressure 直接决定长任务能否撑过去。
- **Constraints** 的 sandboxing、MCP 工具边界、prompt injection 缓解是 coding agent 接管真实仓库的前提。
- **Specs** 类（AGENTS.md、spec-kit、12 Factor Agents）解决"agent 如何稳定理解任务边界"。
- **Runtimes/Reference**：`SWE-agent`、`Citadel`、`Harbor`、`Ralph` 是开源可拆解的 harness 蓝本，`Harness Evolver` 还演示 harness 自我迭代。
- **Benchmarks** 中的 SWE-bench Verified、Terminal-Bench、EvoClaw、SEC-bench 提供了直接衡量 coding harness 质量的标尺。

## 5. 可借鉴点（给 harness-kit 的启示）

1. **采用 CAR 三层 + HarnessCard 作为内部设计语汇**（来源：Foundations / Preprints harness 论文），让 control（策略）、agency（自主度）、runtime（执行层）的取舍能被显式记录、可比较。
2. **把 `init.sh` + initializer agent + handoff artifact 设为一等公民**（来源：Foundations / Anthropic Effective harnesses），保障跨 context window 的长任务可恢复。
3. **以 CLAUDE.md / AGENTS.md + ratcheted pre-commit hooks 作为仓库侧 harness 抓手**（来源：Context + Foundations / Sawinyh "Greenfield/Brownfield"），让 codebase 本身承担一部分约束职责。
4. **用 trace grading + no-skill baseline 评估每次 harness 改动**（来源：Evals / OpenAI Trace grading、OpenHands "Evaluating Agent Skills"），避免改 harness 凭感觉。
5. **参考 Citadel / Harbor / Ralph 三种风格搭建参考实现**（来源：Runtimes）：Citadel 代表"多 agent + worktree + 持久化 campaign"，Harbor 代表"可规模化评测的通用 harness"，Ralph 代表"最小确定性循环"——三者覆盖从重到轻的可行域。

## 6. 一句话总结

Harness engineering 是把"模型能不能干"变成"agent 在真实工作流里能不能稳定干完"的工程学，本仓库给出了它的术语、分层、参考实现与可量化的评测基准。
