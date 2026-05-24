# Browser Harness 调研

> 来源：github-repo/browser-harness
> 调研者：parallel-agent-2
> 日期：2026-05-02

## 1. 对 harness 的定义

browser-harness 把 harness 定义为：**LLM 与真实浏览器之间一层"薄到几乎没有"的可编辑中间件**（README.md:5："a thin, editable CDP harness"）。它的核心主张写在 README.md:7 与 `posts/bitter-lesson-agent-harnesses` 中——*harness 不是给 agent 套上脚手架，而是给 agent 一根直连原语的电线*：一条 WebSocket 直通 Chrome (CDP)，agent 缺什么就在 `agent-workspace/agent_helpers.py` 里自己写。harness 在每次运行中通过 agent 的"沉淀"自我改善（"The harness improves itself every run"）。SKILL.md:96-100 进一步明确："不要加 manager 层、不要 retry 框架、不要 session manager、不要 config system、不要 logging framework"——harness 越薄越好。

## 2. 核心架构

### 顶层目录

- `src/browser_harness/`：受保护的核心包，~1600 行 Python，agent 不应改。
- `agent-workspace/`：agent 的可写区域，包含空文件 `agent_helpers.py`（让 agent 沉淀任务级 helper）和 `domain-skills/`（按域名组织的站点剧本，需 `BH_DOMAIN_SKILLS=1` 启用）。
- `interaction-skills/`：harness 作者维护的"机制层"知识库（dialogs.md、iframes.md、uploads.md 等 17 个 markdown 文件），每个文件描述一类反复踩坑的 UI 机制。
- `tests/`：unit + integration，规模很小。
- 顶层文档三件套：`README.md`、`SKILL.md`（日常使用）、`install.md`（首次安装与 Chrome attach）。

### agent / harness 边界

边界十分清晰且通过物理目录强制：核心代码 (`src/`) 是只读的、稳定的；agent 只在 `agent-workspace/` 里写代码（agent_helpers.py 与 domain-skills/）。helpers.py 末尾的 `_load_agent_helpers()` 在 `-c` 脚本运行前把 `agent_helpers.py` 注入到全局命名空间，实现"agent 写的 helper 在下次运行立刻可用"。

### 启动入口

`pyproject.toml:18` 把 `browser-harness` 命令绑到 `browser_harness.run:main`。`run.py` 全文仅 95 行：解析 `-c / --setup / --doctor / --update`，调用 `ensure_daemon()` 后用 Python 内置的执行函数运行 agent 提交的脚本。

## 3. 关键模块与抽象

- **`run.py`**（95 行）：CLI 入口。设计原则是"保持极小，no argparse / no subcommands"（SKILL.md:99）。
- **`admin.py`**（700 行）：daemon 生命周期、Chrome 探测、远程云浏览器管理、`--doctor` / `--setup` / `--update` 工具命令、profile sync。是面向"运维"的胖模块。
- **`daemon.py`**（330 行）：长驻中间人进程，持有 CDP WebSocket，通过 Unix socket（POSIX）/ TCP loopback（Windows）转发请求；事件用 `deque(BUF=500)` 环形缓冲。一个 `BU_NAME` 对应一个 daemon，支持并行 sub-agent。
- **`helpers.py`**（389 行）：所有 agent 直接调用的原语——`cdp()`, `js()`, `goto_url()`, `click_at_xy()`, `capture_screenshot()`, `page_info()`, `ensure_real_tab()` 等。这是 agent 的"工具集"。
- **`_ipc.py`**（142 行）：跨平台 IPC 抽象（AF_UNIX vs TCP+token），细致处理路径长度、token 防伪、stale socket 探测。

**没有 workflow / step / state machine 的概念**——这是项目的刻意取舍。没有"agent 框架"，agent 自己用 Python 写顺序代码。**skill 系统**有两层：`interaction-skills/`（harness 作者维护的横向机制）和 `domain-skills/`（agent 自动产出的纵向站点知识），都是 markdown 文件，由 SKILL.md 通过文档索引方式引导查找，而不是代码加载。

## 4. 解决了什么、避免了什么坑

- **状态可靠性**：daemon 单点持有 CDP 连接，`ensure_real_tab()` / 自动重连 stale session 处理 Chrome 内部 tab（omnibox popup、devtools://）干扰（connection.md）。
- **验证手段**：`page_info()` 返回视口/对话框信息作为"活检"；SKILL.md 反复强调"every meaningful action 后再 capture_screenshot 验证"——把验证压到 agent 的工作流中而非框架中。
- **antibot/兼容性**：默认走合成器层坐标点击穿透 iframe/shadow DOM/cross-origin（SKILL.md:96-98、helpers.py:181 `click_at_xy`），避开 Playwright/CDP 注入式自动化的指纹。
- **学习闭环**：agent 解决一个站点的怪癖后写入 `domain-skills/<site>/`，下次 `goto_url` 自动暴露文件名（SKILL.md:120）。这是 harness "自我改进"的核心机制。
- **避坑**：明确拒绝 retry 框架、session manager、配置系统、logging 框架（SKILL.md:99-100），把复杂度让给 LLM 处理，由 SKILL.md 的"Gotchas"列表把经验前置成 prompt。

## 5. 与 coding agent harness 的关联

**可迁移的范式**：
- 双层目录边界（`src/` 锁定 vs `agent-workspace/` 可写）正是 coding agent harness 应抄的——稳定原语 + agent 累积的项目知识分离。
- daemon + IPC 模式：长驻进程持有"昂贵的、有状态的资源"（浏览器、语言服务器、REPL），让 agent 的每次工具调用变成无状态轻请求。对应到 coding agent，可以是 LSP daemon、test runner daemon、build watcher。
- 双层 skills（mechanic/horizontal vs domain/vertical）模型几乎可直接对应到 coding agent：interaction-skills ≈ "通用机制（git 冲突、依赖锁、CI 失败）"，domain-skills ≈ "项目特定知识（这个 repo 的怪癖）"。
- "沉淀机制" — agent 解决疑难后必须 PR 一份 skill — 把 LLM 探索成本一次性化。

**不适用部分**：
- 坐标点击 / screenshot-driven 验证只在视觉 UI 场景成立；coding agent 用 AST/编译器/测试更可靠。
- "极薄"哲学在 coding 场景需要重新校准：编译错误恢复、文件锁、并发编辑等不容许"完全交给 LLM 用 Python 写"。

## 6. 可借鉴点（给 harness-kit 的启示）

1. **物理目录强制 agent/harness 边界**：参考 `src/browser_harness/` vs `agent-workspace/`（README.md:49-51）。harness-kit 应该有 `core/`（锁定）和 `workspace/`（agent 可写、agent 沉淀的 helper / 项目知识）。
2. **入口极薄 + auto-bootstrap**：`run.py:88-91` 用 `ensure_daemon()` 在第一次调用时自检并起 daemon，agent 不需要管 setup。harness-kit 的 CLI 应同样做"按需自启"。
3. **SKILL.md 是 prompt 也是文档**：SKILL.md 把"What actually works / Design constraints / Gotchas"作为 prompt 注入 agent 上下文（install.md:31-33 通过 CLAUDE.md import 加载）。harness-kit 应该有一份"工程经验前置"的 SKILL.md。
4. **沉淀机制**：domain-skills/ 由 agent 写、PR 合并（README.md:53-62）。harness-kit 可以让 coding agent 在解决疑难 PR 后自动产出 `workspace/project-skills/<repo>/notes.md`。
5. **拒绝 manager 层**：SKILL.md:96-100 明确禁止 retry 框架、session manager、配置系统。harness-kit 应坚守"原语暴露而非封装"原则——retry 由 LLM 在脚本里写，不在 harness 里写。

## 7. 一句话总结

browser-harness 是一份"反框架宣言"——**给 agent 一组稳定的 CDP 原语 + 一个可写的工作区 + 把工程经验直接当 prompt**，让 agent 用 Python 而不是 DSL 自己组装行为，并通过沉淀 skill 实现 harness 自我演化。
