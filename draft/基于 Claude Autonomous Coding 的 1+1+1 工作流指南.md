# 基于 Claude Autonomous Coding 的 1+1+1 工作流指南

结合 Claude 官方 `autonomous-coding` 方案，以及当前设定（1 人类 + 1 Architect + 1 Dev，基于 Claude Code + Git），对工作流进行深度定制。

> https://mp.weixin.qq.com/s/st1yRe_Y_sBBY6bV5BH6KA 参考 dongxu Harness Engineering

**核心观点：**

1.  **Dev 职责**：严格限定在编码、单测、集成测试（Puppeteer 页面验证 / API 接口验证等）、本地自验修复、交付代码。无权修改项目状态文件，无权 Commit。
2.  **Architect 职责**：
   - 面向 Dev：**不重复跑 Dev 已通过的测试**，而是基于原始需求审查测试覆盖度——是否所有验收标准都被测到了。有遗漏时，由 Architect 补充测试用例定义、退回 Dev 补写验证，确认通过后才更新状态、Commit、派发下一个任务。
   - 面向人类：理解架构设计和规范要求，与人讨论并明确需求，重点是定义清楚「怎么算验收通过」。将需求拆分为 feature_list，调度 Dev 执行。讨论结论主动沉淀到文件，作为长期记忆（TODO：区分项目/个人记忆，结合 Slock 的 threads/saved 机制落地）。
3. **人的职责**：
   - 产出产品想法、架构设计、规范要求——这是项目的启动输入。
   - 每天验收成果并反馈调整，和 Architect 一起讨论需求、制定开发 roadmap。
4. 三者交接基于本地文件，通过 git 确保可追溯、可回滚。
5. **module 粒度原则**：module 是大粒度的功能模块，必须从最终用户视角出发，能独立定义完整的验收标准。无法独立验收的功能不应该是 module，而是某个 module 内部的 feature。

---

## 一、 核心问题解答与角色对齐

> 参考 autonomous-coding/prompts/initializer_prompt.md、coding_prompt.md，进行深度优化

**a. `initializer_prompt.md` 是 Architect 应该做的吗？**
**是的。** Architect 承担了 Initializer 的职责，并且是常驻的。针对单个需求 module_1，Architect 和人类一起讨论后，产出 `spec/module_1.md`（需求文档和验收要求）和 `spec/module_1_feature_list.json`（功能清单）。**只有 Architect 有权修改 feature_list.json 的状态**。

**b. `coding_prompt.md` 是 Dev 应该遵循的，对吧？**
Dev 的核心职责是：读取分配的 Feature → 编写业务代码 → 编写单元测试（依赖全 mock）→ 编写集成测试 → 启动服务 → 运行测试 → 自我修复 → 测试通过后关闭服务 → 交付给 Architect。

**c. 基于 Claude Code，Architect 调度 Dev，并在 Session 间重启避免上下文污染。**
每次 Dev 完成 Feature 且通过 Architect 验收后，**必须停止当前 Claude Code session**。下一次派发新 Feature 时启动全新 session。这强迫 Agent 从文件（Source of Truth）中重建状态，避免幻觉。如果验收不通过，可通过记录的 session_id 恢复 Dev 继续修复。

**d. Dev 只给 Architect 结果，通过文件跟踪进度。**
Dev 的输出是 STEP 8 的交付总结。Architect 从整体视角审查后，验收通过则更新状态文件、执行 Git Commit，并选择下一个 Feature 派发给 Dev。

---

## 二、 目录结构与核心文件定义

```text
your-project/
├── spec/
│   ├── team3.md                       # 工作流全局说明（Architect/Dev 启动时先读）
│   ├── app_design.md                  # 架构设计（人类维护，后续由 人类和 Architect 一起维护）
│   ├── roadmap.md                     # 功能里程碑（人类和 Architect 一起维护）
│   ├── module_1.md                     # 需求文档：人 + Architect 讨论产出，含验收标准
│   ├── module_1_feature_list.json      # 任务拆解与验收清单（Architect 维护，Dev 只读）
│   └── module_1_progress.txt           # 进度跟踪、session 记录、交接文档（Architect 维护）
├── e2e/
│   └── module_1/                       # 按 module 隔离的集成测试
│       ├── feature_01.test.js         # Web 页面类：Puppeteer 等
│       └── feature_02.test.js         # API 类：curl 等
├── init.sh                            # 环境启动脚本（Architect 首次创建）
└── src/                               # 业务代码（含单元测试）
```

> **说明**：`ARCHITECT_PROMPT.md` 和 `DEV_PROMPT.md` 是独立的 Prompt 模板，不放在项目目录中。启动 Agent 时通过 `claude -p <prompt_file>` 指定。

---

## 三、 角色 Prompt 设计

Prompt 文件独立维护，不在项目目录内。详见：
- **`ARCHITECT_PROMPT.md`** — Architect 的系统提示词
- **`DEV_PROMPT.md`** — Dev 的系统提示词
- **`team3.md`** — 两个 Agent 共读的全局上下文（放入项目 `spec/team3.md`）
- **`check.sh`** — 项目目录结构检查脚本

---

## 四、 Slock.ai 集成：为每个项目配置独立 Agent

通过 [Slock.ai](https://slock.ai/)，将 Architect 和 Dev 变成**常驻的、有记忆的、可对话的队友**，在 Channel 中自然协作。

### 1. Agent 配置

每个项目创建独立的 Architect 和 Dev Agent：

| 项目 | Architect Agent | Dev Agent | 说明 |
|---|---|---|---|
| project-x | architect-x | dev-x | Agent Description 中写入对应 Prompt 内容 |
| project-y | architect-y | dev-y | 每个项目完全隔离，避免上下文串扰 |

### 2. Channel 结构（每个项目 3 个）

```
#project-x-main        ← 人类 + Architect + Dev，整体沟通、进度可见
#project-x-architect    ← 人类 + Architect，讨论需求 / 架构 / 验收标准
#project-x-dev          ← Architect + Dev，任务派发 / 交付 / 退回
```

### 3. 协作流程

```
人类在 #project-x-architect 中 @architect-x "我有一个新需求，我们讨论下验收标准"
  → 人 + Architect 讨论，产出 spec/module_2.md
  → Architect 生成 module_2_feature_list.json
  → Architect 在 #project-x-dev 中 @dev-x 派发任务
  → Dev 编码、测试、在 #project-x-dev 中交付
  → Architect 审查、通过则 commit，在 #project-x-main 中汇报
  → 人类随时在 #project-x-main 中查看进展、给反馈
```

### 4. 注意事项

- 多项目场景下，每个项目的 Agent 完全独立，不共享上下文。
- 交付和验收仍需要写入文件（`progress.txt`），文件是 Source of Truth，Channel 对话是辅助。

---

## 五、 总结

1. **Dev 是纯粹的执行者**：编码 → 单元测试（全 mock）→ 集成测试 → 自验修复 → 关服交差。没有权限改状态文件，没有权限 Commit。
2. **Architect 是管理者与质检员**：不重复 Dev 的劳动，从整体视角审查交付。负责更新状态文件、Git Commit、派发任务。
3. **人类是产品设计者**：初始化 `spec/app_design.md`，与 Architect 一起定义需求和验收标准。
4. **module 是大粒度功能**：从最终用户视角，能独立定义验收标准。
5. **Slock.ai 是协作基础设施**：每个项目独立的 Agent 和 Channel，常驻、有记忆、可随时唤醒。

---

## 附录：Slock.ai 概念梳理与 Slack 对比

> 基于实际登录 app.slock.ai 调研（2026-04-13）

### 核心概念

| Slock 概念 | 是什么 | 对应 Slack |
|---|---|---|
| **Server** | 顶层容器，类似团队/组织。一个 Server 内有 Channel、Agent、Machine | Workspace |
| **Channel** | 公开对话频道，内含 **CHAT** 和 **TASKS** 两个 tab | Channel（但 Slack 无原生 Tasks tab） |
| **Agent** | AI 队友，有 Description（角色定义）、Model（如 Sonnet）、Workspace（文件系统，含 `MEMORY.md`）、Skills 目录。状态：Online/Thinking/Working/Offline | Bot（但 Slack Bot 无持久记忆、无本地执行） |
| **Machine** | 用户自有的物理机器，通过 `npx @slock-ai/daemon` 连接。Agent 在 Machine 上执行，代码和数据不离开本地 | 无对应（Slack 是纯云端） |
| **Threads** | 消息的子对话，可标记"done"隐藏直到有新消息 | Thread（基本相同） |
| **Saved** | 书签功能，对任意消息点收藏 | Saved Items（基本相同） |
| **Tasks** | Channel 内的任务面板，发消息时可勾选"As Task" | 无原生对应（需 Asana/Jira 集成） |
| **DM** | 与 Agent 或人类的私聊 | DM（相同） |

### Slock 独有的关键能力

1. **Agent Workspace**：每个 Agent 有独立的文件系统，内含 `MEMORY.md`（持久记忆）和 `notes/` 目录。Agent 跨 session 保持记忆靠的就是这个。
2. **本地执行**：Agent 跑在你自己的 Machine 上，代码不上云。
3. **Skills 加载**：Agent 可读取 `~/.claude/skills` 目录下的 Skill 文件。
4. **Tasks 原生支持**：不需要第三方集成，消息直接可转为任务。

### 当前用法评估

当前方案（第四节）设计的是「每个项目 2 个 Agent + 3 个 Channel」。基于实际产品能力，有几点可以优化：

**可以保留的**：
- 每项目独立 Agent（Architect / Dev）——合理，Agent 有独立 Workspace 和记忆，天然隔离。
- Agent Description 写入 Prompt——这就是 Slock 设计的用法。

**附：目前不考虑的**：
- 3 个 Channel 可能偏多。Slock 的 Thread 可以在单 Channel 内隔离讨论主题（需求讨论开一个 Thread、验收开一个 Thread），不一定要分 3 个 Channel。一种更轻量的方案：**1 个项目 Channel + DM**（人→Architect 用 DM 讨论需求，Architect→Dev 用 DM 派发任务，Channel 做整体进度公告）。
- **Tasks tab** 可以补充甚至替代 `progress.txt` 的部分功能——feature 派发和状态跟踪直接在 Channel Tasks 面板可视化。评估 Slock Tasks 能否替代文件级的进度跟踪，或者两者互补（Tasks 做可视化，文件做 Source of Truth）。
- **Skills** 可以把 ARCHITECT_PROMPT 和 DEV_PROMPT 做成 Skill 文件放到 `~/.claude/skills/`，比 Description 更结构化。

---

## TODO

- [ ] **长期记忆落地**：让 Architect Agent 主动将关键决策写入自己的 `MEMORY.md`（Slock Workspace 内置），定义什么内容应该沉淀（架构决策、命名约定、验收标准共识、踩坑记录），需要区分 项目记忆、团队记忆，待调研 https://mem9.ai/docs/#what-is-mem9
- [ ] **用 example/app_design.md 跑通验证**：在 Slock 中创建项目 Server，配 Architect + Dev Agent，从 app_design.md 开始走完整的讨论→拆分→开发→验收流程。

> 注意：~/.slock/agents/uuid/ 是 Agent 的记忆空间（MEMORY.md），和项目代码目录是两回事。项目目录需要在 Agent Description 指定（如下举例）

```
你是 Dev。

1、启动后先读取以下文件，严格遵循其中定义的工作流和角色边界：
- /Users/shijian/dev/open/claude-quickstarts/team3_coding/team3.md
- /Users/shijian/dev/open/claude-quickstarts/team3_coding/DEV_PROMPT.md

2、你的项目工作目录：
/Users/shijian/dev/open/claude-quickstarts/team3_coding/example
```