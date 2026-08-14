# Team3 Self-Improvement 方案（v3）

> team3 作为 harness 系统，自身如何持续变好。
> 参考资料：https://lilianweng.github.io/posts/2026-07-04-harness/

---

# 目标

让 team3 harness 能够：收集自身问题 → 提炼 root cause → 改进 → 回归验证不倒退 → 通过后续真实项目闭环确认修好。

当前 v3 聚焦的可交付物：
1. decision_log 扩充信号 [已完成]
2. 基于 decision_log，提炼优化动作（受约束的）
3. 回归验证

---

# 设计思路

## 一、信号收集

信号源是各项目的 `spec/experience.md`（Agent 经验）+ `spec/decisions.md`（人类决策），只认这两个文件（旧协议 `spec/decision_log.md` 已不再支持）。人手动触发一次提取，就产生一次**独立迭代**（loop_N），增量只处理新增内容。

```
各项目 spec/experience.md + spec/decisions.md
    │
    │  人手动触发
    │
    ▼  team3/loop/loop_N/（本次迭代的工作目录）
    ├── issues.md          本次提取的系统问题（harness 哪没拦住）← experience.md
    └── habits.md          本次提取的人类偏好 ← decisions.md
```

两类产出、两条下游：

| 产出 | 下游 |
|------|------|
| issues | 人 review → 找 root cause → 改 harness → 回归验证 → pass 后打包升级 team3 |
| habits | pass 后合并写入 `~/.team3/t3_mem.md`，team3 运行时读取 |

经验记录协议（详见 team3.md）：任何偏离理想路径的都记进 `spec/experience.md`（Dev 自修复 ≥2 轮、Arch 秒过、UAT repair ≥3 轮、模型假设错误），每条带 `ref` 指向现场 artifact；人类决策单独进 `spec/decisions.md`（≤20 条生效快照）。

## 二、改进方向

总原则：**prompt → code 的持续迁移**。能用代码确定性保证的不依赖 prompt，判断类的留给模型。

改 harness 落到 4 类：

> **怎么调（prompt / cli）→ 喂什么（上下文）→ 环境确定性（技术栈 / 验证环境）→ 验结果（验证集）**

7 个方向：① Prompt 具体化 ② CLI 脚本化 ③ 上下文的场景拆解 ④ 通用上下文技术 ⑤ 技术栈具体 ⑥ 验证环境标准 ⑦ 验证集覆盖有效

详见附录 A。

## 三、分析：从问题到 root cause

对 issues.md 做跨问题聚类，找共同 root cause。修复不是加 N 条 prompt 规则，是找到一个结构性改动覆盖一类问题。人类 review 拍板。

## 四、端到端验证

两条线，时间尺度不同：

| 问题 | 怎么验 | 何时知道 |
|------|--------|---------|
| 改动没破坏已有流程？ | 回归：选定项目全量重跑 | 即时 |
| root cause 真的不再出现？ | 后续真实项目 experience.md 不再出现同类记录 | 渐进积累 |

## 五、整体循环

```
日常项目 → experience.md / decisions.md 持续积累（~/.team3/projects.json 自动发现）
    ↓ 人手动触发 node extract.mjs
loop_N/issues.md + habits.md（本次新增条目的提取，LLM qodercli）
    ↓ 人 review 提取质量（漏记、归错类就先修 prompt）
    ↓ 人分析 root cause，改 harness
    ↓ 回归（可选，run-regression.mjs，loop/vote-app 全量重跑）
team3/loop/vote-app/regress.<profile>.md
    ├── pass → 打包升级 team3；habits 合并进 ~/.team3/t3_mem.md
    └── fail → 分析写入回归报告，下次迭代继续
    ↓ 闭环
后续真实项目不再出现同类记录 → 确认修好
```

---

# 技术架构

## 目录结构

```
team3/loop/
    ├── run-regression.mjs               # 回归主脚本
    ├── extract.mjs                      # 经验/决策提取脚本（Step 4）
    ├── vote-app/                        # 回归项目
    │   ├── app_design.md / .min.md      # 干净起点设计（full / min 两档）
    │   ├── baseline.full.md / .min.md   # 效率基线（按 profile 分开）
    │   └── regress.full.md / .min.md    # 最近一次回归结果（按 profile 分开）
    ├── loop_001/                        # 第 1 次迭代
    │   ├── issues.md                    # 本次提取的系统问题
    │   └── habits.md                    # 本次提取的人类偏好
    ├── loop_002/                        # 第 2 次迭代
    │   └── ...
    └── .extract-state.json              # extract.mjs 增量状态（per-file 条目 hash 集合）
```

## 回归执行流程

```
run-regression.mjs vote-app
    │
    ├── 1. 准备工作目录、清理残留，检查核心文件 spec/app_design.md、baseline.md（可选）
    ├── 2. 初始化 team3 项目
    ├── 3. 触发 Arch 开始
    ├── 4. 轮询等待完成（`spec/uat_report.md` 存在且结论是 pass）
    ├── 5. 交叉验证 uat_report.md 与 story 是否一致
    ├── 6. 采集效率指标（轮次/时间/token）对比 baseline
    └── 7. 输出回归报告
```

## 三层验证

| 层 | 自动 | 看什么 |
|----|------|--------|
| 流程完整性 | 是 | 全流程走完没，team3 协作规范有没遵循 |
| 效率指标 | 是 | 轮次、时间、token 对比 baseline |
| 产出质量 | 是 | uat_report.md 全 pass，且与 story 交叉验证一致 |

## 产出质量为什么不再用独立 acceptance 脚本

早期给 vote-app 写过一份独立的产品验收脚本（full 用 puppeteer 走三页动线，min 走纯 HTTP），想法是"harness 验过程、acceptance 验产品"，两层解耦。跑下来发现在这个场景不成立，已移除：

- vote-app 每次都是**独立重新生成**的。脚本必须写死 API 路径、`data-testid` 这些 `app_design.md` 根本没钉住的约定，Dev 没有义务命中
- 于是失败绝大多数是**脚本与实现的命名不一致**，不是产品缺陷。2026-08-03 的 full 回归就是：UAT 2/2 pass、产品功能正确，acceptance 却因为等 `[data-testid="survey-title"]` 超时而全挂
- 放宽到只验"最基本的"就没有区分度了，而且和 UAT story 覆盖的动线高度重叠

要让外部验收重新成立，前提是把接口和 DOM 契约写进 `app_design.md` 当硬约束——那是另一个决定，不是给脚本打补丁。当前判据就是 harness 自己的 UAT 结果 + 交叉验证。

---

# 关键细节

> 实现时需要知道的约束。

## 回归 = 正常 team3 项目，只是脚本代替人

vote-app 回归不是什么特殊流程——就是把它当普通 team3 项目从头跑一遍。和人日常用 team3 建项目完全一样：初始化 → Arch 规划 → Dev 开发 → Arch 验收 → UAT 验证。唯一区别是"人在 web 上做判断"变成"一个 human-sim agent（qodercli session）动态做判断"。

所以：
- dev server 是 Dev 在开发过程中通过 init.sh 启动的，和正常项目一样；回归脚本不碰它的启停

## 多方交流靠 actions.jsonl，脚本代替人只是"追加一行"

team3 里 Arch / Dev / UAT / 人之间的所有沟通，都落在项目的 `spec/actions.jsonl`——一个 append-only 的 JSONL 文件，每行一条消息：

```json
{"action":"to_arch","from":"human","to":"arch","ts":...,"message":"..."}
{"action":"dev_do","from":"arch","to":"dev","ts":...,"message":"..."}
{"action":"to_arch","from":"dev","to":"arch","ts":...,"message":"已交付..."}
```

运作机制：daemon 的 ActionWatcher 监听这个文件，出现新行就派对应 agent 执行，agent 把回复也写回这个文件。**Web UI 本质只是这个文件的展示层 + 一个输入框**——人在网页上打字发送，底层就是往 actions.jsonl 追加一行 `from:human` 的记录。

所以"脚本代替人"的机制很清楚：往 actions.jsonl 追加 `from:human` 的行，daemon 就会触发对应 agent。

但人不只是"在固定时机追加固定内容"——看 vote-app 真实流程：Arch 问"单题还是多题？防重复吗？"，人类做产品决策回复；UAT 提 5 个 story 方案，人类说"合并成 3 个"。这些是**动态判断**，写死跑不下来。

**解法**：启一个独立的 qodercli session 当"模拟产品负责人"。它监听 `to_human` 消息，基于 app_design.md 理解项目意图，动态做产品判断并回复追加到 actions.jsonl。和 UAT 的 `simulate_human.mjs` 同一个模式——把需要判断的事交给隔离的 LLM 子空间。

## 需要补的 CLI 能力

1. **项目初始化 CLI**：创建 .team3-project.json、注册到 projects.json、启 daemon
2. **human-sim agent**：一个 qodercli session，system prompt 注入 app_design.md 内容，角色是"产品负责人"。它监听 actions.jsonl 中 `to_human` 的新行，读懂上下文后追加人类回复行。回归脚本启动它，整个项目期间持续运行直到完成

## 已定的实现决策

- **loop 触发入口**：当前为 `node loop/extract.mjs`（`team3 loop` 子命令暂未实现，loop 目录不随包分发），由它创建并编号 `loop_N/`。增量边界用**条目内容 hash**（`.extract-state.json` 里 `project_list[].seen`）：每条 `## 日期 | ...` 条目归一化后取 hash，没见过的才是新增。不用行号——decisions.md / experience.md 都允许修订/删除旧条目（rebase 局部清理、经验修订），行号会错位；修订旧条目 = 新 hash = 重新提取，正是想要的行为。
- **提取方式**：`经验/决策 → issues.md + habits.md` 用 **LLM（qodercli）** 做提取，不是正则。
- **多项目遍历**：提取时读 `~/.team3/projects.json` 列表，逐个项目发现其 `spec/experience.md` / `spec/decisions.md`（旧协议 `decision_log.md` 不再支持）。
- **habits 注入**：合并进 `~/.team3/t3_mem.md` 后，在 **package 打包时注入，作为 system prompt** 生效。
- **打包升级**：regress pass 后走**现有 `build/` + `pkg/` 链路**打包上线（版本标记 / 回滚同此链路）。
- **human-sim**：**全新**实现，借鉴现有 `simulate_human.mjs` 的"子空间隔离判断"模式，但独立、必须用 **qodercli**。
- **回归超时**：按 profile 定——min 60min、full 360min（full 范围大，60min 跑不完），超时判失败，避免流程卡死时无限等。
- **qodercli 使用文档**：https://docs.qoder.com/zh/cli/quick-start

---

# 开发计划

> 原则：先解决"回归到底能不能自动跑起来"这个最大不确定性，再做提炼和闭环。每步都有明确的验证方式，验不过不往下走。

## Step 0：项目初始化 CLI + human-sim agent

回归的两个前提能力：

**a) 项目初始化 CLI**
- 更新 .team3-project.json、注册 projects.json、启 daemon、追加首条 to_arch 消息
- **验证**：CLI 建完项目，daemon 起来，arch 开始规划（actions.jsonl 出现 arch 回复）

**b) human-sim agent**
- 一个 qodercli session，system prompt 注入 app_design.md，角色"产品负责人"
- 监听 actions.jsonl 中 `to_human` 新行，读懂上下文做产品判断，回复追加到 actions.jsonl
- **验证**：手动触发一次 arch 的 to_human 提问，human-sim 能给出合理的产品决策回复，actions.jsonl 中出现对应的 from:human 行

## Step 1：写 acceptance.mjs（独立产品验收）— 已废弃

原计划单独写一份 vote-app 验收脚本，作为独立于 harness 的产出质量判据。已实现过（`acceptance.mjs` / `acceptance.min.mjs`），后因误报远多于真问题而移除，理由见前文「产出质量为什么不再用独立 acceptance 脚本」。产出质量现在由 harness 的 UAT 结果 + 交叉验证承担。

## Step 2：写 run-regression.mjs（串起全流程）

串起 Step 0：清理 → 初始化项目 → 启动 human-sim → 等待完成 → 交叉验证 → 采集指标 → 出报告。

- **验证**：不改任何 harness，完整跑一次 vote-app，从只有 app_design.md 的干净起点一路到 UAT 全 pass，产出回归报告。这步跑通 = 回归基础设施完成
- **提醒**：为了快速验证这过程，第一次执行时，可以简化 vote-app/app_design.md 设计，加速跑，等稳定后再跑完整的

## Step 3：跑基线

Step 2 跑通的那次就是 baseline。记录轮次/时间/token。

- 一个项目跨很多次 session、执行时间长，单次波动被整体拉平，单次基线足够用
- **验证**：baseline.md 有值；后续回归对比，明显退化（如轮次翻倍）才报警
- 已完成：min / full 基线均已建立（baseline.min.md / baseline.full.md）

## Step 4：decision_log 扩充 + 提取

这步相对独立，可和 Step 0-3 并行。

- decision_log 扩充信号 [已完成]
- 提取脚本 `team3/loop/extract.mjs`：
  - 源：默认从 `~/.team3/projects.json` 自动发现各项目的 `spec/experience.md` / `spec/decisions.md`；也可用 `--source <path>` 指定单个文件（文件名为 decisions.md 按人类决策处理，其余按经验处理）
  - 增量：`.extract-state.json` 记录每个源 `{project, kind, path, seen[]}`，seen = 已见条目的内容 hash 集合，两类源统一；条目被修订/删除不影响其他条目判新旧（旧行号 offset 状态首次运行自动迁移）
  - 输出：`loop_N/issues.md` + `loop_N/habits.md`，编号自动递增
  - 提取方式：两次 qodercli 调用——issues（带 7 方向分类，源 experience.md）+ habits（按 5 条规则，源 decisions.md）
  - `--reset` 清空增量状态重新处理；`--dry-run` 只展示待处理内容不调 LLM
- **聚类 root cause 不在脚本里**：human review issues.md 后人工分析根因、改 harness——这是 manual step，不生成 analysis.md
- **验证**：拿现有 decision_log 跑一次提取，人 review 提取质量——漏记、归错类就先修 prompt

## Step 5：走通第一个完整 loop_x

端到端验证整个机制。

- 提取 → 人 review → 改 harness → 局部 check → 回归 → 出回归报告
- **验证**：loop_001/ 文件齐全；回归 pass 且效率没退化；改动打包上线；habits 合并进 t3_mem.md

## 已知风险（开发时要正视，不要假装没有）

1. **回归覆盖窄**：vote-app 只能验"基础流程没搞坏"。算法 / 多 module / 外部数据格式这类 root cause 它触发不到——改这些的时候，回归 pass **不代表**修复有效，只能靠后续闭环。
2. **升级回滚**：team3 升级自己要有版本标记，坏了能退回上一版。

---

# 附

## 附录 A：改进方向 7 条详细展开

> 下面每条的"例子"都来自真实项目的 decision_log（team3 自身 + badminton_call / human_distillation / vote-app / hero_accessories 等），不是编的。
> 真实例子列表：team3/spec/decision_log_all.md

### 第一类：怎么调 Agent

#### ① Prompt

规则从"要做什么"变成"具体查什么、按什么顺序、留什么证据"，堵住 Agent 走捷径的空间。!!!特别提醒!!!：LLM 训练时目标就是追求 "快"、"完成"，缺少辩证判断、会非常自信，一个模糊目标是非常危险的。

- 光写目标（"验证 e2e 真实"）没用，Arch 倾向信任 Dev "通过" 就放行，证据要明确：先抽查代码、抽测至少 1 个
- 结果交付要交叉抽查，不能自己验自己：Arch 验 Dev 交付时，独立读代码/跑测试得出自己的结论，再和 Dev 的自述对比，不一致的地方才是重点。同理 UAT 验产品也不看 Dev 实现，从用户视角独立跑。谁交付、谁验收，视角必须错开

例子：
- Arch 验收 Feature #1/#2/#3 时没做对抗式检查，直接抄 Dev 交付的"全部通过"——回头发现 #2 的 e2e 全 mock 了 spawn 还带 tautology、#3 重复实现了 buildClaudeArgs。改后 MODE B 写死：独立审 src 在前、检查是否 mock 被测主体、抽跑 1 个 e2e。

#### ② CLI

确定性的活（调 skill、读写文件、拼 prompt）交给脚本，Claude 只做判断。这条是 prompt→code 迁移最实的落点。

- 判断标准：动作每次一样、没有判断空间 → 抽成脚本，省 token、不漏步骤、不膨胀 prompt
- 脚本分两种：一种是纯代码（调 skill、读写文件、拼 prompt、跑测试），确定性执行、要么成功要么明确报错；另一种是代码里再调 LLM——把一个需要判断但边界清晰的小任务，拆到独立子空间去做，不污染主 agent 上下文

例子：
- hero_accessories 早期是"orchestrator 拼 prompt → Claude 一把干完"，把上一步产出内联进 prompt，到 step5 累积 59KB 超了 `claude -p` 参数长度限制，Claude 直接收不到 prompt 超时。重构成 run.mjs 架构：run.mjs（代码）调 skill、读写文件、拼 prompt，Claude 只读数据做业务判断。上一步产出改成传文件路径，不再塞进 prompt。（纯代码脚本）
- UAT 的 `simulate_human.mjs` 是第二种：UAT agent 要模拟真实用户在页面上输入什么内容（活动信息、报名数据），这需要 LLM 判断"真人会怎么填"。做法是 UAT 自己写 puppeteer 操作页面，但"填什么内容"调这个脚本——脚本内部起一个带独立 session 的 `claude -p` 生成用户内容，返回给 UAT 去 type。判断被隔离在子空间，UAT 主上下文不被"扮演用户"的对话污染。（代码里调 LLM）

---

### 第二类：喂什么进上下文

③ 是结合 team3 流水线阶段做的上下文架构（场景特定），④ 是任何 agent 都适用的通用上下文技术。

#### ③ team3 流程特定的上下文架构

利用 team3"阶段分明"的特点：一个阶段收尾时把过程沉淀成结论，下一阶段只带结论、不背过程。

- team3 有 feature / module / 验收这种明确阶段，通用 agent 没有，所以这种"按阶段沉淀"的上下文安排是 team3 独有的

例子：
- 一个 feature 验收完，验收对话和自测细节就没用了，结论已经进 feature_list.json 和 progress.txt。做下一个 feature 时 Arch 不该继续背上一个 feature 的完整对话——新建 session，只注入当前 feature 的 Dev 交付 + feature_list 当前状态。

#### ④ 通用上下文技术：5 个动作

业界（manus / cursor / oneday）提炼的通用手法，什么 agent 都适用。下面对照 team3 举例，但需进一步优化。

- **Offload 卸载**：大的、暂时不用的内容存外部，上下文只留引用/占位符，要用时再唤回。
  team3：spec/*.md 文件就是卸载态，但 bash read 文件目前未细化。
- **Reduce 精简**：信息进上下文前先压成摘要。
  team3：基本没做——progress.txt 越滚越长还全量读。注：此方案有副作用，暂时不考虑。
- **Retrieve 检索**：按需取相关内容，不全量塞。
  team3：有 reread 协议（整文件读），没有语义检索。注：此方案有副作用，暂时不考虑。
- **Isolate 隔离**：拆子 agent 隔离干扰，用共享内存 + 强约束返回格式。
  team3：有角色隔离（Arch/Dev/UAT）和 UAT 黑盒。
- **Cache 缓存**：稳定公共前缀，降延迟降成本。
  team3：用了 --resume，但 '跨session' KV cache 未实现。

补两条通用原则：**分层**（L1 每次必带的实时信息 / L2 任务骨架 / 完整历史压缩 / 硬盘外部检索）；**结构化摘要**（不说"请总结"，给预定义 schema 让模型填，manus 迭代多次后的最终方案）。

---

### 第三类：环境确定性

#### ⑤ 技术栈约束

初始化时把版本和环境锁死，Agent 不许自己选。这是被踩得最多的一类。

- 不锁版本 → 每个项目重踩一遍环境坑，浪费大量轮次
- 不光锁版本号，还要锁住那些"隐形环境变量"

例子：
- human_distillation：`create-next-app` 拉到 Next.js 16 + React 19，build 反复失败，最后被迫降到 14.2 才通过。
- vote-app / game_loopit：本机 `npm config omit=dev` 会跳过 devDependencies 导致 vitest/tsx 全缺；父进程还泄漏了 `__NEXT_PRIVATE_STANDALONE_CONFIG`、`TURBOPACK=1`、`NODE_ENV=production` 给子进程，把 `next dev` 搞崩。修法是 init.sh 里 `env -u` 清掉这些变量 + `npm install --include=dev`。
- 这些坑每个新项目都重踩一次 → 应该固化进初始化，而不是靠 Dev 每次现场排查。

#### ⑥ 验证环境

启停、端口、隔离标准化，从一份配置派生，别每个项目硬编码。也是后面 checkpoint replay 的前提。

- 和 ⑤ 的分界：⑤ 是开发前锁死"用什么"（版本、包管理器、框架），⑥ 是运行时"怎么把它跑起来、怎么排查"（端口、启停、隔离、日志）。⑤ 定死清单，⑥ 定死怎么拉起和观察
- 配套还要有可观测性：过程日志统一输出到固定位置，验证失败时能顺着日志排查，而不是两眼一抹黑重跑

例子：
- badminton_call：停服务用 `killall node` 误杀了 daemon 和别的项目，改成 `lsof -ti:$PORT | xargs kill` 按端口杀。
- game_loopit：puppeteer-core 要指到本机 Chrome、离线时远程 Google Fonts `@import` 会 404 报 console error、Next 16 从 127.0.0.1 访问要配 `allowedDevOrigins`——全是 UAT 真实浏览器验证时反复踩的环境细节。

---

### 第四类：验结果

#### ⑦ 验证集有效

盯 e2e / UAT 的测试集本身：主路径覆盖够不够、和真实场景对不对得上、有没有过度重叠。当前还太笼统。

- 核心不是"数据量够不够"，是"覆盖的分布对不对"
- e2e 和 UAT 要从同一份场景描述出发，互补而不是各造各的
- UAT story 现在写得啰嗦、彼此重叠：多个 story 反复验同一个功能点。应按"用户完整动线"拆，不按功能点拆，一条 story 走一条端到端路径，story 之间尽量不重叠
- checkpoint 只写目标（"消息能发送"），不写判据。要写清输入、输出、可观测的判断标准——这和 ① 是同一个病：目标模糊，Agent 自己就糊弄过去了

例子：
- badminton_call：算法 e2e 用了"干净分布"（10男5女），22/22 全绿；UAT 用真实混合分布（有人选了男双但性别不符、有绑定报名）一跑，直接暴露严重回归（3 轮变 22 轮、gap 2 变 11）。
- team3 module_3：e2e 只覆盖 happy path，异常场景全没测，靠人 hands-on 才发现。
- hero_accessories 的"自动补全"按钮其实只解析了文本，8 个字段全空，Arch 只查了"HTTP 201 + 文件建了"就通过。

---

## 附录 B：验证方案的思路演变

> 记录 v3 "端到端验证" 设计过程中的思路变化，避免后续重复踩坑。

### 第一步：最初想法——问题注入 + Checkpoint Replay

最初设想：从 decision_log 提炼 root cause 后，针对每个 root cause 构造"有缺陷的 Dev 交付"注入到项目特定阶段，验证新 harness 能否拦住。

流程设计：基准项目 git worktree → 按 replay 设计有序推进 → 到达注入点时替换缺陷制品 → 跑 Arch/UAT → 检查 expected_signal。

### 第二步：识别核心困难

讨论后发现问题注入的难度被低估了：

1. **注入物难造**——你要自动造出"逼真但有特定缺陷的 Dev 交付"，这本身需要一个足够聪明的 agent，太刻意测不出真问题，太隐蔽验不了是否被拦住
2. **分两类验法不同**——"拦截类"（Arch/UAT 该发现的）可以静态注入，但"预防类"（Dev 不该犯的）只能让 Dev 真跑一遍观察行为，成本高且不确定
3. **expected_signal 定义难**——Arch 输出是自然语言，判断"拦住了"需要人看或复杂的语义匹配

### 第三步：分清两件事

关键认知转变：**回归 ≠ 验证 root cause 已修**。

- **回归**：改了 harness 后没倒退（即时可知）
- **闭环**：root cause 真的不再出现（靠后续真实项目渐进积累）

这两个时间尺度不一样。纠结在"怎么一次性证明 root cause 修好了"是把两件事混在一起了。

### 第四步：务实方案

接受这个节奏：

1. 改动后跑回归——确保没搞坏（即时反馈）
2. root cause 是否修好——靠后续真实项目运行中 experience.md 不再出现同类记录（渐进闭环）
3. 问题注入——留到积累了足够真实失败样本后再投入（天然素材比人造的好）

### 第五步：回归怎么自动验

回归跑完后，"产出质量好不好"如果人必须看一遍就不算自动化。

当时的解法是给回归项目写一份独立的验收脚本（puppeteer 从用户视角操作页面），和 harness 内部的 Arch/UAT 验证解耦——harness 验过程，脚本验最终产品。

**后来推翻了**：被测项目每次都是重新生成的，外部脚本只能靠猜接口和 DOM 命名，误报远多于真问题（详见前文）。现在的判据是 harness 自己的 UAT 结果 + `uat_report.md` 与 story 的交叉验证；真正的"解耦"靠视角错开——UAT 不读 Dev 实现，从用户动线独立设计验收。

### 经验总结

1. 先做能落地的，复杂方案等条件成熟再说。问题注入需要的前提（真实失败样本、成熟的 harness）现在都不具备
2. 区分"即时回归"和"渐进闭环"，不要试图用一个机制同时解决两个时间尺度的问题
3. 真实项目本身够复杂，只要 harness 有漏洞跑起来就会暴露——但这个信号体现在 experience.md 里，不是体现在"某次回归是否 pass"里
4. 验证层和被验对象要解耦，但解耦靠**视角错开**（谁交付、谁验收分开），不是靠一份写死的外部脚本——被测产物每次重新生成时，脚本钉的是设计从没约定过的实现细节，只会制造误报