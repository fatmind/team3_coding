# Team3 Self-Improvement 方案

> team3 作为 harness 系统，自身如何持续变好。
> 当前阶段：讨论思路，不是实现。

---

## 一、信号收集

### 三份文件

```
每个项目 spec/decision_log.md
    │（定时异步提取，和项目开发解耦）
    ├──→ ~/.team3/harness_t3_fb.md    team3 系统哪没拦住
    └──→ ~/.team3/human_habit.md      人的决策偏好，跨项目稳定
```

| 文件 | 记什么 | 谁读 |
|------|--------|------|
| `spec/decision_log.md` | 项目内一切偏离理想路径的事：产品决策、踩坑、人类纠偏 | 项目内 Agent |
| `~/.team3/harness_t3_fb.md` | team3 系统层面的失效：谁应该拦住、为什么没拦住、改了什么、验了没 | harness 优化时 |
| `~/.team3/human_habit.md` | 人的稳定偏好：如"e2e 不 mock 被测主体""算法必须真实分布测" | 未来注入 team3.md |

### decision_log 要扩充什么

当前只记大事。改为：**任何偏离理想路径的都记**。

| 信号 | 举例 | 说明什么 |
|------|------|----------|
| Dev 自修复 ≥2 轮 | checkpoint 写太模糊 | checkpoint 粒度不够 |
| Arch 验收秒过 | MODE B 输出"符合预期，通过"，无具体论据 | checklist 走过场 |
| UAT repair ≥3 轮 | 前 3 轮都是选择器失效 | 验证环境有系统问题 |
| 人类打回 | 对阵表没考虑性别约束 | spec 遗漏 |
| 模型假设错误 | Dev 猜 JSON 格式不去看真实 log | 缺"先看样本"约束 |

---

## 二、Harness 可改层面

7 个可改表面。每个只列方向原则 + 一句话举例。

### ① Prompt

**方向**：规则从"要做什么"变成"具体操作序列"，让 Agent 能机械执行。

举例：现在写"验证 e2e 真实端到端"。改为"先 grep mock/stub，再检查 import 路径是否指向 src/ 真实模块"。

### ② CLI

**方向**：确定性内容抽取为脚本，daemon 调时直接用，模型不再自己翻文件。

举例：Dev 每次开始 feature，都要读 module spec → 找 feature → 看 checkpoint。这个动作每次一样，抽成 `cli/dev-start-feature.sh`，输出一份任务书直接喂给模型。

### ③ 上下文裁剪

**方向**：区分"本次任务需要的"和"已落盘结论"，只喂前者，不带历史对话。

举例：Arch 验收 Feature #8 时，#1-#7 的验收对话全在 session 里但已无用。改为每次验收新建 session，只注入当前 feature 的 Dev 交付 + feature_list 状态。

### ④ 卸载内容召回

**方向**：跨角色交接的证据必须落盘为文件，不能只靠 session 内对话传递。

举例：Dev 跑完 e2e 的原始 test output 写到文件，Arch 验收时直接读 log，不只看 Dev 的"已通过"自述。

### ⑤ 技术栈约束

**方向**：项目初始化时版本锁死写入 spec/tech_stack.json，Agent 不得自行替换。

举例：锁定 next@14 + vitest + puppeteer-core。避免模型脑补换 yarn、playwright、jest。

### ⑥ 验证环境

**方向**：标准化 env.json（端口/启停命令/健康检查），所有环境脚本从它派生。

举例：UAT 启动时读 env.json 拿端口和健康检查 URL，不再每个项目硬编码。

### ⑦ 测试集构造

**方向**：module spec 里显式写"测试数据参考"，e2e 和 UAT 从同一份描述出发构造测试，避免各做各的覆盖脱节。

举例：module spec 列了 4 种数据分布场景（正常/冲突/边界/异常），Arch 要求 Dev 的 e2e 必须覆盖这 4 种，UAT story 也从同一组场景出发。验收时对比覆盖率——e2e 和 UAT 互补而不重叠。

---

## 三、端到端验证

### 核心问题

改了 harness 后，怎么确认 harness_t3_fb.md 里的老问题真的不再出现？

### 思路：从已通过项目反向提取 + 分层 + Checkpoint Replay

#### 验证项目怎么来

**从已通过的 example/ 项目反向提取**，不正向从零构造。

做法：拿 badminton_call（已跑通）作为基准。它有完整的 app_design、module spec、feature_list、UAT report、decision_log。从中提取：

- 哪些环节出过问题（decision_log 记了）
- 最终结果是什么样（modules_progress.json + uat_report.md）
- 哪些数据分布/场景覆盖是关键的

基于此，**反向生成验证用的 expected_signals**——"在这个项目里，harness 应该在哪些点拦住什么"。

#### 项目分层

不同 example 项目天然有难度差异：

| 项目 | 难度 | 核心验证点 |
|------|------|-----------|
| game_loopit | L0 | 基础流程跑通（只有 spec，还没完整跑完） |
| human_distillation | L1 | 多 module 依赖、有 UI 重构流程 |
| badminton_call | L2 | 算法 + UI + 数据分布约束 + UAT 复杂 story |

改 harness 后：小改跑 L0 验证不退步，中改跑 L1，大改/换模型跑 L2。

#### Checkpoint Replay：怎么仿造已知问题

关键洞察：**不是重跑整个项目，而是在特定环节制造"之前会漏的条件"，看新 harness 能不能拦住。**

做法分三步：

**1. 从 harness_t3_fb.md 选一条要验证的问题**

如："Arch 验收时没对比 e2e 数据分布和 spec 场景描述"

**2. 判断适合在哪个验证项目中做**

这条问题涉及算法 + 数据分布 → 适合在 badminton_call（L2）上验证。如果是基础的"Dev prompt 没要求先看真实 log" → 可以在 game_loopit（L0）上验证。

**3. 构造验证环境，跑完恢复**

这是一个独立能力：
- 从基准项目 checkout 出一个临时分支/worktree
- 把项目状态**回退到"出问题前"的那一步**（比如把 feature_list 里那个 feature 标回 in_progress，准备好"Dev 的有缺陷交付"）
- 用当前 harness（新 prompt）跑那个环节
- 检查结果是否命中 expected_signals
- 跑完后丢弃临时分支，不影响基准项目

```
构造验证环境的流程：

基准项目（已通过，在 example/）
    │
    ▼ git worktree / 临时目录
验证环境（回退到"出问题前"的状态）
    │
    ▼ 注入当前 harness prompt
跑被测环节（只跑 Arch 验收 / 只跑 UAT story）
    │
    ▼ 对比 expected_signals
结果 → pass / fail
    │
    ▼ 清理临时环境
```

**"构造验证环境"本身是 team3 需要新增的一个能力**——类似 CI 里的 fixture setup。每次验证都是：snapshot 项目状态 → 注入条件 → 跑 → 检查 → 恢复。

#### 降低成本

| 手段 | 说明 |
|------|------|
| 只跑出问题的环节 | 改了 Arch prompt 就只跑 Arch 验收，不跑 Dev/UAT |
| mock Dev 交付 | 预先准备"含缺陷的 Dev 交付"，直接喂 Arch，不让 Dev 真写代码 |
| 便宜模型先筛 | qwen3.7 先过，过了再 opus 确认 |
| 跑 3 次取多数 | 消除非确定性 |

---

## 四、整体循环

```
日常项目开发
    │
    │ decision_log（扩充记录）
    │
    ▼ [异步提取]
~/.team3/harness_t3_fb.md
~/.team3/human_habit.md
    │
    ▼ [分析 → 确定改哪个层面]
prompt / cli / 上下文 / 卸载召回 / 技术栈 / 验证环境 / 测试集
    │
    ▼ [做改动]
    │
    ▼ [checkpoint replay]
选验证项目（按难度匹配）→ 构造验证环境 → 跑被测环节 → 检查信号 → 恢复
    │
    ├── pass → harness_t3_fb 标"已验证"
    └── fail → 改动不够，继续迭代
```

---

## 五、什么离得远、什么离得近

| 近（现在可以动手） | 远（等条件成熟再做） |
|---|---|
| 扩充 decision_log 记录范围 | meta-review agent 自动分析 |
| 从 3 个 example 项目提取初版 harness_t3_fb.md + human_habit.md | 自动构造验证环境的 CLI 能力 |
| CLI 剥离确定性内容（dev-start-feature.sh 等） | 验证项目的 expected_signals 自动生成 |
| 手动跑一次 checkpoint replay 验证 Arch MODE B | 全自动 replay 流水线 |

---

## 六、对照 Lilian Weng Harness 文章框架

> 参考 [Harness Engineering for Self-Improvement](https://lilianweng.github.io/posts/2026-07-04-harness/) (2026-07-04)
> 逐项对照 team3 当前做法。没有的就说没有。

### Harness 设计模式

| Lilian 的模式 | team3 当前 | 差距 |
|---|---|---|
| **工作流自动化**：plan→execute→observe→improve 循环 | 有。Arch 拆→Dev 做→checkpoint 自测→Arch 验收→UAT 验证，完整流水线 | 循环是单次的——跑完一轮不会自动改进下一轮的做法 |
| **文件系统做持久记忆**：状态落盘，不压在上下文里 | 有，且是核心设计。spec/ 文件是 Source of Truth，actions.jsonl 做消息持久化，progress.txt 做进度 | 做得不错，但 Dev 的 e2e 执行结果没落盘（见第二节④） |
| **Sub-agent / 后台任务**：并行执行、日志可查 | 有限。UAT 阶段 1 和 Arch/Dev 是并行的。daemon 管多个 claude -p 进程 | 但没有真正的"多 sub-agent 并行做同一个 module"。也没有"启动后台 job 定期检查状态"的能力 |
| **Coding Agent 标准工具集**：文件系统/shell/git/MCP 等 | 有。claude code 自带完整工具集，team3 不限制 | team3 没有在工具层做额外封装或限制 |

### Harness 优化方法

| Lilian 文章讲的方法 | team3 有没有 | 说明 |
|---|---|---|
| **上下文工程（ACE/MCE）**：自动从轨迹中提炼经验，写入结构化手册 | 没有自动的。decision_log 是手动记录，不会自动从执行轨迹中提炼 | 这是本文第一节"信号收集"想做的事，但目前是人工异步提取，不是自动 |
| **工作流搜索（ADAS/AFlow）**：自动搜索更好的工作流 | 没有。team3 的流水线（Arch→Dev→UAT）是手工设计固定的 | team3 不打算做工作流自动搜索——场景太窄、项目量不够大，人工迭代就够 |
| **自改 Harness 代码（Self-Harness）**：挖弱点→提修改→回归验证 | 没有自动的。人发现问题→人改 prompt/流程→没有回归验证 | 本文第三节"Checkpoint Replay"就是想补回归验证这一环 |
| **进化搜索（AlphaEvolve/DGM）**：进化式搜索 harness 代码 | 没有，也不打算做 | 需要大量 eval 跑通才有意义，team3 项目量级不到 |
| **联合改权重（SIA）**：同时改 harness 和 finetune 模型 | 没有 | team3 用的是通用模型（opus/qwen），不做 finetune |

### Self-Improvement 循环对照

Lilian 文章描述的完整循环：

```
执行任务 → 收集轨迹 → 挖弱点 → 提修改 → 回归验证 → 合入
```

team3 对照：

| 环节 | team3 现状 | 缺什么 |
|------|-----------|--------|
| 执行任务 | 有。项目正常跑 Arch/Dev/UAT 流水线 | — |
| 收集轨迹 | 部分有。actions.jsonl + progress.txt + agent log 是流水账；decision_log 记大事 | 缺"中间信号"的自动记录（Dev 返工轮数、Arch 验收耗时等） |
| 挖弱点 | 人工。人看 decision_log 或 dogfood 时发现 | 没有自动聚类/分析机制 |
| 提修改 | 人工。人改 prompt 或流程 | 没有 agent 辅助提修改建议 |
| 回归验证 | 没有。改了 prompt 没办法验证"之前的问题不再出现" | 这是本文最核心的缺失 |
| 合入 | 人直接改文件，没有 gate | — |

### 七个瓶颈对照

Lilian 文章最后列了 7 个未解决的瓶颈，对照 team3：

| 瓶颈 | team3 有没有这个问题 | 说明 |
|---|---|---|
| 1. 评估器弱/模糊 | 有。Arch 验收和 UAT 的"通过/不通过"判断靠 prompt 约束，不够硬 | e2e 是硬的（跑过就是过），但 Arch 的 MODE B 审查是软的——它说"通过"不代表真的查了 |
| 2. 上下文和记忆管理 | 有。Arch session 越积越长（已识别，v2 有方案） | — |
| 3. 不会放弃 | 轻微。Dev 卡住会上报 Arch，不会无限循环。但 UAT repair 有时会反复重试同一个策略 | UAT 有 3 轮上限后转人类 |
| 4. 多样性坍缩 | 不适用。team3 不做进化/RL 搜索 | — |
| 5. Reward hacking | 有。Dev 可能写"通过性 e2e"——e2e 写得太弱，看着绿了但没验到关键逻辑 | 这就是"tautology 测试"问题，已在 Arch MODE B checklist 里加了对抗 |
| 6. 只优化短期 | 有。当前 feature 通过了但代码可维护性/未来迁移成本没人管 | 没有好办法，暂时靠 Arch 拆 feature 时留 refactor 空间 |
| 7. 人的角色 | 做得还行。人类定方向+最终验收，中间不当调度器 | 但"人什么时候该下潜看"没有系统化触发——还是靠直觉 |

### 总结：team3 在 Lilian 框架里处于什么位置

team3 做到了：
- 完整的 workflow automation（流水线跑得通）
- 文件系统做持久记忆（设计哲学对齐）
- 人在慢环、AI 在快环的分工

team3 没做到：
- 自动从轨迹提炼经验（ACE/MCE 那套）→ 靠人异步提取
- 自我改进的闭环验证（Self-Harness 的回归测试）→ 本文第三节想补
- 自动挖弱点和提修改建议 → 目前全靠人

一句话：**team3 的 pipeline 能跑，但 pipeline 自身不会自动变好。** 变好的循环目前卡在"回归验证"——改了不知道有没有效、有没有退步。这是下一步最该补的能力。
