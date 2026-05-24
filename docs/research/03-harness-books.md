# Harness Books 调研

> 来源：github-repo/harness-books
> 调研者：parallel-agent-3
> 日期：2026-05-02

## 1. 整体内容

仓库收录了同一作者（@wquguru，发布日 2026.04.01）的两本姊妹书，主题都是 Harness Engineering（驾驭工程），共用一个构建工具链（`tools/book-kit/` + Honkit）。

- **Book 1：Harness Engineering — Claude Code 设计指南**。9 章 + 3 篇附录，以 Claude Code 源码为观察样本，讲清"运行时骨架"（控制平面、Query Loop、工具权限、上下文治理、错误恢复、多代理验证、团队制度）。
- **Book 2：Claude Code 和 Codex 的 Harness 设计哲学**。8 章 + 2 篇附录，把 Claude Code 与 OpenAI Codex 并排比较，讨论两套 harness 把"秩序"安放在哪一层（运行时纪律 vs. 显式控制层）。

README 自述："这两本书不打算把源码拆成零件逐条讲解，它们关心的是 harness 怎样组织约束与执行"。

## 2. 对 harness 的定义

作者把 harness 定义为**"一组持续生效的控制结构，用来约束模型在工程环境中的行为边界"**（Book 1 序言）。它与 agent / framework / runtime 的边界如下：

- 模型 ≠ agent。"模型只是 agent 里最会说话、也最不稳定的那个部件"（Book 1 序言）。
- harness ≠ prompt 工程的放大版。"Prompt 决定它怎么说话，Harness 决定它怎么做事"（Book 1 序言）。
- harness 是同一套控制结构的"器官系统"——prompt、工具、权限、状态、恢复、验证、制度都是器官，而非外围配件（README 核心判断）。
- 在 Book 2 的判断里，harness 还是一种**权力分配方式**："谁定义边界，谁解释状态，谁拥有最后的执行解释权——这些事情最后都会体现在架构里"（第 7 章）。

## 3. book1-claude-code 核心方法论

Book 1 围绕"五层 Harness"展开，从源码细节归纳出可复用判断：

1. **Prompt 是控制平面的一部分（第 2 章）**：system prompt 必须分层（default / project / custom / agent / append），用于规定执行边界、失败行为、报告责任，而非"人格设定"。
2. **Query Loop 是代理系统的心跳（第 3 章）**：状态（messages、toolUseContext、autoCompactTracking、turnCount 等）跨轮持久化；轮次内显式处理消息裁剪、tool result budget、microcompact、context collapse、autocompact。
3. **工具调用必须服从调度（第 4 章）**：通过 `partitionToolCalls()` + `isConcurrencySafe()` 判断并发性；高危工具（Bash）必须配高密度规约（不乱改 git config，不跳过 hooks，不随手 push）。
4. **上下文是工作内存，不是垃圾桶（第 5 章）**：memory / CLAUDE.md / compact 是预算制度，目标是"保住继续工作的语义底座"。
5. **错误路径就是主路径（第 6 章）**：prompt too long、max_output_tokens、中断、hook 回环、compact 自身失败都是"日常天气"，恢复 / 熔断 / 限次 / 防死循环必须在设计时就在场。

第 7 章再补一条：**多代理的意义是把不确定性分区**（research / implementation / verification / synthesis 隔离），第 9 章的"十条原则"是全书的速查表。

## 4. book2-comparing 比较结论

Book 2 不做功能对照表，而是比较"骨架"。结论压成一句：**它们殊途同归，也各表一枝**（第 7 章）。

- **同归**：两者都承认模型不可靠，都让 prompt 不等于控制全部、工具受约束、长会话需状态治理、本地规则进入系统、多代理需分工与验证。
- **各表一枝**：Claude Code 是"运行时共和制"——从 query loop 出发，用 compact、工具编排、中断恢复维持秩序；Codex 是"控制面立宪制"——把 instruction 做成 fragment、工具做成 schema、执行边界做成 policy、会话做成 thread/rollout/state、本地规则做成事件系统。
- **第三种危险路线**（第 7、8 章批评的反面案例，作者称之为"OpenClaw 这一类"）：把越来越多 bootstrap、技能说明、身份文本堆进 prompt，靠"先注入，再抢救"维持上下文，结果 token 烧得快、语义信号又稀释。
- **给后来者**（第 8 章）：先识别主矛盾——"模型乱来"先学 Claude Code 的运行时纪律；"团队失序"先学 Codex 的显式控制层；最忌讳"折中失败品"。

## 5. 关键设计原则

作者反复强调的原则（每条标出处）：

- **模型当不稳定部件，不当同事**（Book 1 第 9.1 节）——可靠性不能寄托在模型身上，要做进 harness。
- **错误路径要按主路径设计**（Book 1 第 1.6、6 章；第 9.6 节）——失败是结构性条件，不是异常事件。
- **能力越强，控制越细**（Book 1 第 1.5 节）——高风险接口需要高密度约束。
- **验证必须独立**（Book 1 第 7、9.9 节）——verifier ≠ implementer，否则"完成"会退化为"我觉得没问题"。
- **上下文是资源，可治理 > 够多**（Book 1 第 5 章；第 9.5 节）——分层、分寿命、分入口成本。
- **个人经验制度化**（Book 1 第 8、9.10 节）——分层 CLAUDE.md、明确 approval、可执行 skill、生命周期 hook、可追踪 transcript、统一验证定义。
- **显式 ≠ 僵硬，灵活 ≠ 混乱**（Book 2 第 8.4 节）——必须明确区分"哪些先写死、哪些留给运行时、哪些必须持久化"。
- **设计顺序按事故发生顺序排**（Book 2 第 8.5 节）：高风险动作 → 主循环/线程 → 上下文与恢复 → 技能/hook → 多代理与生态。

## 6. 与 coding agent harness（PI 框架）的关联

**直接适用**：

- 主循环 + 跨轮状态心智（messages / context / turnCount / compactTracking）——PI 框架的 query loop 可以直接照抄这套不变式。
- 工具调度纪律（并发分组 + concurrency-safe 判断 + Bash 高密度规约）——是任何 harness 的底盘。
- 错误即主路径（recover / terminate_clean 路由）——PI 框架的 error handling 应当在 day-1 就在场。
- 验证独立（verifier ≠ implementer）——PI 框架若做多 agent，必须从一开始就拆 verification 角色。

**需要改造**：

- Prompt 分层（default/project/custom/agent/append）需结合 PI 框架自身的角色 / 项目 / 会话三层语义重新映射。
- 上下文治理（memory + compact + collapse）的阈值表要根据 PI 自身的 token 预算和模型能力重定。
- Hook 事件系统（SubagentStart/Stop、pre/post）若直接照搬 Codex 风格，可能比 PI 框架的复杂度更高，需裁剪。

**不适用 / 需谨慎**：

- 书里大量结论基于 Claude Code / Codex 的特定源码结构（`src/query.ts`、`core/src/lib.rs`），不能机械套用文件名或接口。
- 书里批评的"prompt 容器扩容"路线（OpenClaw 式），如果 PI 框架走插件 / skill 堆叠路线，需特别留意上下文治理主轴别再退化成"先注入，再抢救"。

## 7. 可借鉴点（给 harness-kit 的启示）

1. **先选主矛盾再动手**（Book 2 第 7、8 章）——harness-kit 应明确自己解决"运行时失控"还是"组织失序"，用主矛盾决定第一根骨头。
2. **把不变式写进控制平面**（Book 1 第 1.2 节的三条 invariants：prompt 分层、工具受调度、错误进主路径）——可以做成 harness-kit 的初始化自检。
3. **采用 Book 2 第 8.2 节的分阶段 builder checklist** ——按 Week 1 / Week 2 / Week 3 + Gate 验收，可以直接拿来当 harness-kit 的 onboarding 模板。
4. **把"完成"的定义统一**（Book 1 第 9.10 节）——把 verification 写进 Definition of Done，避免 agent 自评。
5. **上下文当工作内存而非 prompt 容器**（Book 2 第 8.3 节）——harness-kit 的 memory / skill / compact 设计起手即按"什么必须保住"而不是"还能再塞什么"立项。

## 8. 一句话总结

> Harness Engineering 关心的是：在模型并不可靠的前提下，系统仍然能表现出工程系统应有的行为；harness-kit 的真正任务，不是让 agent 更聪明，而是把不确定性关进合适的笼子里。
