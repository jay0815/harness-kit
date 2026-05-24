# Harness Engineering 调研

> 来源：github-repo/harness-engineering
> 调研者：parallel-agent-4
> 日期：2026-05-02

## 1. 对 harness engineering 的定义

原文关键句（`README.md:13`）："Harness Engineering（驭缰工程）是 OpenAI 在 2026 年 2 月提出的工程范式：工程师不再写代码，而是设计环境、明确意图、构建反馈回路，让 AI 智能体可靠地完成工作。"

更精确的工程定义见 `concepts/06-harness-definition.md:7-11`："**Agent = Model + Harness**。Harness = 模型之外的一切代码、配置和执行逻辑。"——裸模型只能做文本到文本的映射，是 harness 给它"状态、工具执行、反馈回路和可执行约束"，它才成为智能体。

一句话总结：Harness 是包裹在模型之外、用确定性约束驾驭概率性模型的全部工程系统（提示、工具、沙箱、编排、反馈），让"智能体可靠工作"成为可设计、可演进的工程问题。

## 2. 核心理念

提炼自 `concepts/00-overview.md` 与 `concepts/06-harness-definition.md`，作者反复强调的核心理念有 5 条：

1. **仓库即记录系统**（`concepts/01-repo-as-source-of-truth.md`）：不在仓库里的东西，对智能体不存在。Slack、脑内知识、Google Doc 全部不可见，只有版本化工件可被消费。
2. **机械化执行优于规劝**（`concepts/02-mechanical-enforcement.md`）：文档会腐烂，linter 不会；并把"修复指令"内嵌进 lint 错误，形成自我纠正闭环。
3. **地图而非手册（渐进式披露）**（`concepts/00-overview.md:18-22`）：AGENTS.md 是 ~100 行入口目录页，按需向下指引，避免上下文挤占与维护塌方。
4. **约束多样性 = 自主性**（`concepts/06-harness-definition.md:93-96`，引 Ashby 必要多样性定律）：约束越严，模型在约束内的自主空间越可信，全面 harness 才变得可行。
5. **人类掌舵、智能体执行**（`README.md:16`、`concepts/00-overview.md:42-46`）：人类时间最稀缺；出错时不是"更努力"，而是补齐缺失的上下文/工具/约束。

## 3. 实践方法

### practice/

`practice/AGENTS.md` 规定每个实验目录应含 README + AGENTS + 代码三件套，建议三类实验：
- 用 Claude Code 生成 CLI 工具（验证仓库即记录）
- 给生成代码写自定义 linter（验证机械化执行）
- 让智能体自我重构（验证熵管理）

当前仅有 `practice/01-ralph-demo/`，是 Ralph 循环的最小验证（321 秒、$0.31）。

### prompts/

`prompts/AGENTS.md` 接受两种合法形态：单条 Prompt 卡片（带"用途/正文/效果评价/改进记录"）与 Prompt 工作流（多步 A/B/C，跨模型协作）。当前唯一文件 `deep-research-tracker.md` 是后者，用于每 1–2 周扫描 harness/AI coding 领域新内容。在体系中，prompts/ 是**已验证提示词的沉淀仓**——只收录亲测有效的，与 references/（外部资源索引）和 works/（输出物）分工明确。

### works/

`works/AGENTS.md` 列出 12 篇翻译 + 1 篇原创综合分析（`harness-engineering-chinese-interpretation.md`）。这是**可对外独立展示的成果**，不是仓库内部学习记录；翻译本身被 `feedback/2026-04-14-translation-as-harness.md` 重新解读为"翻译即 Harness"——非代码场景的真实案例。

## 4. review 流程的角色

`REVIEW.md` 定义了一套针对文档型仓库的 review 方法：聚焦"导航失真 / 事实漂移 / 可复现性 / 机械化维护"四类问题，分 5 步执行（冻结权威来源 → 结构导航 → 元数据一致性 → 内容约定 → 机械化建议）。`REVIEW-EXECUTION.md` 是该计划的实际执行报告，逐项列出 7 个问题（如 P1 文章数三处口径分叉、P2 README↔AGENTS Phase 漂移）和修复状态。

这两份文档非常清楚地表达了"评估 + 反馈循环 = harness 的核心机制"：仓库本身就是被 harness 的对象——`scripts/check-consistency.sh` 七层校验（C1–C7）+ `.githooks` pre-commit + GitHub Actions CI 三层兜底（`README.md:202-221`）正是把 review 中发现的高频漂移**编码为 lint**，对应 OpenAI 概念 3 的机械化执行。换言之，review 文档本身是元 harness——用 harness 工程方法管理一个讲 harness 工程的仓库。

## 5. feedback 机制

`feedback/` 目前只有一篇 `2026-04-14-translation-as-harness.md`，但其立意很明确：把"踩坑—修正—迭代"抽象为可复用的 harness 实践。该文把翻译流水线的 5 阶段（analysis → prompt → draft → critique → revision）映射到 Rahul Garg 的"Feedback Flywheel"：观察失败 → 诊断根因 → 系统性修复 → 验证效果。

作者把 feedback loop 视为 harness 的**主发动机**：`concepts/06-harness-definition.md` 的 Guides×Sensors 2×2 矩阵明确指出"只有反馈 = 反复犯同样错误；只有前馈 = 不知道规则是否生效"——前馈（AGENTS.md/Skills）与反馈（linter/AI review）必须协同。`thinking/evaluation-elephant-in-the-room.md` 进一步把"行为正确性的反馈"列为整个领域最弱的一环，称之为"房间里的大象"。

## 6. 与 coding agent harness（PI 框架）的关联

这套方法论里直接对应 PI 框架要做的事的，至少有三块：

- **workflow 稳定执行**：对应概念 2/3 + REVIEW 的机械化校验脚本——把 workflow 的不变量（步骤顺序、产物形状、文件契约）编码为 lint/CI，让 agent 在偏离时被立刻挡回，错误信息内嵌修复指令。
- **多 agent 协同**：对应 `concepts/06-harness-definition.md` 的 LangChain 组件清单（编排逻辑、Sub-Agents 防火墙、Hooks 中间件）+ Symphony 的"给目标不规定状态转换"。多 agent 不靠刚性状态机，而靠共享仓库（disk is state, git is memory）+ 背压门控。
- **事实确认**：对应"仓库即记录系统"+ `thinking/evaluation-elephant-in-the-room.md` 的三层验证。事实必须以版本化工件存在，agent 之间靠 PR/文件交接而非对话；行为正确性需要 LLM-as-judge + 计算性 sensors 联合裁定。

此外，Ralph 六信条（`README.md:184-191`）几乎就是给 PI 框架的设计 checklist：Fresh Context、Backpressure、Plan Is Disposable、Disk Is State、Steer With Signals、Let Ralph Ralph。

## 7. 可借鉴点（给 harness-kit 的启示）

1. **AGENTS.md 控制在 ~60–100 行 + 渐进式披露**（`concepts/06:30`、`README.md:43-47`）：harness-kit 的入口契约不要写百科全书，子目录各自有自己的 AGENTS.md。
2. **lint 错误必须内嵌修复指令**（`concepts/02-mechanical-enforcement.md:23-35`）：这是把"机械执行"接入 agent 自我纠正闭环的关键设计，比单纯报错强一个量级。
3. **把"漂移"编码成自检脚本**（`README.md:202-221`、`scripts/check-consistency.sh` C1–C7）：harness-kit 也应识别本系统会发生哪些数字/状态漂移，先列清单再脚本化，pre-commit + CI 双层兜底。
4. **Guides×Sensors 2×2 同时铺**（`concepts/06-harness-definition.md:62-74`）：前馈（提示/skills/架构文档）与反馈（linter/judge）缺一不可，并区分"计算性"与"推理性"两种成本档位选择性运行。
5. **承认行为评估是阿喀琉斯之踵**（`thinking/evaluation-elephant-in-the-room.md`）：harness-kit 应明确划出"可机械验证"与"必须人/LLM 判官介入"的边界，不要假装通用 evaluator 已经存在。

## 8. 一句话总结

Harness Engineering 的核心是用**版本化仓库 + 机械化前馈/反馈双回路**把模型的概率性削成可工程化的确定性，让人类只需掌舵、不必划桨。
