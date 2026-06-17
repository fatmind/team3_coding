# Boris 工作流：拆解、批判、迁移验证

> 目的：把 Boris Cherny（Claude Code 作者，Head of Claude Code @ Anthropic）公开分享过的「人 + Agent」工作流拆开看清楚，再用 `team3_coding/example/human_distillation/app_design.md`（xhs 热门人物 Skill）这个具体需求走一遍，验证「他那套到底搬不搬得过来」。
>
> 来源：Pragmatic Engineer 长访谈、YC Lightcone、Lenny's Podcast、Boris 在 X / Threads 的两条主线程（[Cowork 起源](https://x.com/bcherny/status/2010923222813065308)、[隐藏特性 17 条](https://x.com/bcherny/status/2038454336355999749)）。

---

## 一、Boris 工作流概要

### 1. 流程图（按他自己原话简化）

```
[人类] 想法 / GitHub issue / Slack 反馈
   ↓
[Plan Mode × N] 同时启 5 个 tab，每个 tab 跑 plan mode
   ↓        ↓        ↓        ↓        ↓
  plan-1   plan-2   plan-3   plan-4   plan-5     ← 各自独立 worktree，互不污染
   ↓ 人 review，1~3 轮微调
   ↓
[执行] 切到 auto-accept，让 Claude 一把写完
   ↓
[自验] Claude 自己跑测试 / 起 server / 用 Chrome 扩展打开页面 / 调子 agent 检查
   ↓ (失败 → 自己改 → 再跑)
   ↓ (成功)
[PR]
   ↓
[Claude 评审]（CI 里跑 claude -p，覆盖 ~80% bug）
   ↓
[人 review]（最后一道闸，必须有人按 merge）
   ↓
[合并] → /loop /babysit 自动 rebase / 应对 review
```

### 2. 关键动作（一手原话）

| 动作 | Boris 原话 | 含义 |
|---|---|---|
| **并行** | "I have dozens of Claudes running at all times… Use git worktrees." | 同时 5~数十个会话，worktree 隔离 |
| **Plan Mode 优先** | "80% of my sessions I start in plan mode… Once the plan is good, it'll just one-shot the implementation almost every time." | 先把计划聊清楚，再让它写代码 |
| **可验证 = 一切** | "**Give Claude a way to verify its work.** If Claude has that feedback loop, it will 2-3x the quality of the final result." | 这是他公开点名的「最重要一条」 |
| **CLAUDE.md 极简** | "If you hit [token limit], my recommendation would be delete your CLAUDE.md and just start fresh." | 不要过早建脚手架，让新模型自由发挥 |
| **Bash 是第一公民** | "I gave it a bash tool… asked what music am I listening to… that was my first fuel-the-AGI moment." | 给工具，让模型自己想办法用 |
| **Hooks / Loop 自动化** | "/loop 5m /babysit, to auto-address code review, auto-rebase, and shepherd my PRs to production." | 把例行 PR 仪式交给后台 agent |
| **批量分发** | "/batch interviews you, then has Claude fan out the work to as many worktree agents as it takes." | 大规模迁移用 fan-out |
| **人类必须最后看一眼** | "There still has to be a person in the loop approving the change." | 100% 写 = AI；100% 合并审批 = 人 |

---

## 二、批判：为什么他能成功？前置要求是什么？

> 注意：媒体常报道「Boris 一天 20~30 个 PR、100% AI 写」。但这套要复刻，至少要先具备下面这些**条件**。少一个，效果会断崖式下跌。

### 前置条件 1：**任务本身可被机器验证**
这是 Boris 自己反复强调的「最重要那条」。

- ✅ 跑 build / 跑 test / 起 server / 用浏览器看页面 → Claude 能自己判断"成没成"
- ✅ 迁移类工作（类型、语法、API 重命名）→ 有 lint / type check 兜底
- ❌ 「人物画像是否生动」「文案是否吸引人」「Skill 蒸馏得好不好」→ **没有自动判定函数，Claude 无法迭代到「好」**

**这是搬运他工作流时最容易翻车的点**：很多产品任务里，「好」是主观的，Claude 写完之后没人能告诉它该不该再改。

### 前置条件 2：**Codebase 干净，技术栈统一**
Boris 自己讲过：他在 Meta 做 code quality 时发现，**部分迁移、多种框架共存的 codebase 会让模型"挑错"**——它会随机选老 API 写代码，得人类纠偏。

- Claude Code 本身就是它自己写的，迭代快、技术栈高度统一（TypeScript + 单一架构）
- 你的项目如果有 3 个状态管理、2 种路由方式、半个旧版组件库 → Claude 大概率给你写第 4 种风格

### 前置条件 3：**强 dogfooding + 即时反馈循环**
Boris 是产品作者本人：

- 他每天在 PR 上 tag 自己写 lint 规则、写 CLAUDE.md 更新
- Anthropic 有一个 Slack 频道专门收 Claude Code 反馈，"within a minute, within 5 minutes" 就修
- 他的 "100%" 是建立在「100% 写代码 + 100% 自己看代码 + 100% Claude 评审 + 100% 人最终批准」之上

**外部团队照搬时常忽略**：他没说他不看代码，他说他不"用键盘改"代码。这两件事很不一样。

### 前置条件 4：**人类本身是顶级工程师**
- 在 Instagram 时是「top 2–3 most productive engineers」
- 在 Meta 负责全公司 code quality
- 在 Anthropic 自己一个人三个月做出 Claude Code 雏形

**所以「Plan Mode」对他来说够用的根因**：他脑子里就有架构，30 秒能判断 Claude 计划好不好。换成新手，plan 怎么也看不出问题，照样翻车。

### 前置条件 5：**任务粒度足够粗 + 真正独立，人脑才切得过来**
Boris 说他"几十个 Claude 同时跑"听起来很爽，但**这件事的前提不是 worktree 隔离，而是任务本身相互独立**。worktree 只解决"文件不打架"，解决不了下面这些：

- **语义耦合**：A 改了某个 helper 的签名，B 那边正在用旧签名写新功能 → 合并时炸
- **语料/数据耦合**：两个任务都依赖同一个 schema / prompt 模板 / config，谁先改谁定义事实
- **人脑切换成本**：5 个任务如果互相纠缠，人在 tab 之间切换时光"回忆这个 plan 是干嘛的"就要 30 秒。5 × 30s = 2.5 分钟纯切换 overhead，并行收益基本被吃掉

所以并行的硬前提是：
1. **粒度粗**：每个 task 是一个能独立验收的 module，不是函数级 / 文件级
2. **依赖图近乎扁平**：拆完之后画一下，N 个 task 之间应当没有强依赖箭头。如果有，说明拆得不对，要么合并、要么串行
3. **每个 task 的上下文人 30 秒能进得去**：plan.md / 验收标准 / 当前进度三件套必须齐全

> 反过来说：**如果任务粒度细到"加个按钮、调个 padding"这种级别，并行多 session 是负收益**——还不如一个 session 串行做完。Boris 自己 20-30 PR / 天里也有大量是"几十行的小 PR"，那些都是串行的，他并行的是"feature 级别"的任务。

**实操建议**：Architect 拆 module 时，验收标准之外额外标一个 `dependencies: []`。如果出现箭头多于 1 条，强制重拆。

### 前置条件 6：**有 token / 算力预算可以「先不省」**
他原话：

> "Start by just giving engineers as many tokens as possible… that's the point to optimize and cost cut."

这意味着他的工作流**默认假设你有充足配额**。Best-of-N、并行 plan、subagent 搜 bug——每一项都在烧 token。

### 前置条件 7：**分级 review，不让人成为卡点**
媒体爱写「100% AI 写代码」，但 Boris 在 Lenny 那期亲口说：

> "I do look at the code… you still want a human looking at the code, unless it's pure prototype code."

但他没说"逐行看 100%"——20-30 个 PR / 天，逐行看根本不可能。真实情况是**分层过滤**，人只看"机器筛剩下的高风险增量"：

```
所有 PR
  ↓
[第 0 层] lint / type check / unit test / e2e test —— 不过直接打回
  ↓
[第 1 层] Claude 用 Agent SDK 在 CI 里跑 code review —— 挡掉约 80% bug，自动评论
  ↓
[第 2 层] 风险打分：动了核心 API？改了 schema？引入新依赖？删除>200 行？跨 module 改动？
  ├─ 低风险 → 自动 merge（或同事 1 个表情即可）
  └─ 高风险 → 必看，且要看 diff 中标红区域
  ↓
[第 3 层] 人看的是"机器无法判断的事"：架构决策、安全、产品意图是否对齐
```

**前置条件**是：
1. 第 0/1 层必须真的拦得住——否则人 review 没意义
2. "风险打分"要被显式定义。Boris 团队的做法是：让 Claude 自己在 PR 里产出一个 risk summary，Architect 看 summary 决定要不要 deep dive
3. 人 review 的不是"代码是否正确"，而是"**这个改动配不配得上 merge**"——意图、命名、是否过度工程、是否引入隐藏假设

> 这条对 1+1+1 工作流的直接含义：Architect 的"验收"不应该等同于"逐行读 Dev 的代码"，而是"读 Dev 的交付总结 + 看自动化结果 + 抽查高风险点"。否则 Architect 就是新瓶颈。

### 失败模式 Checklist（搬运时自查）

| 信号 | 含义 |
|---|---|
| 任务输出无法自动判定好坏 | Claude 不会知道何时停 |
| Codebase 多种风格并存 | Claude 选错 API 概率高 |
| 上下文超过单窗口（如要看 10 个文件 + 一个 50k 文档） | Plan Mode 也救不了，需要人拆 |
| 任务依赖外部不稳定接口（爬虫、第三方 API） | 自验循环跑不起来 |
| 没有清晰的"验收标准" | Claude 无止境 over-engineer |
| 一个会话搞所有事 | 上下文污染，越改越差 |

---

## 三、用 xhs 影响人 Skill 这个需求走一遍

> 需求文件：`team3_coding/example/human_distillation/app_design.md`
>
> 一句话：监控小红书热点 → LLM 蒸馏成人物 Skill（Markdown）→ 用户在 Web 选 Skill 对话。
>
> 技术栈：Next.js 全栈，LLM 调用走服务端。

### 步骤 0：先识别这个需求的特殊性（critical）

| 子模块 | 直接的自动验证 | 是否需要"造一个验证函数" |
|---|---|---|
| **xhs 抓取** | ⚠️ 结构能验，"数据够不够好"不能 | 需要：抽样规则 + 质量打分（互动度/时效/字段完整度） |
| **LLM 蒸馏** | ❌ skill 文本本身没法直接判分 | 需要：评测集（对话对 ground truth）+ LLM-as-judge |
| **Web 对话 UI** | ✅ 浏览器自验直接跑 | 不需要，Boris-原教旨主义直接用 |

> **结论先抛**：3 个模块都能跑通 Boris 那套"自验循环"，但 UI 是天生有验证函数，抓取和蒸馏需要**自己造验证函数**。"造验证函数"才是这类产品最关键的工程动作，做不好，所有自动化都是空中楼阁。人在这个动作里是不可替代的——但人只在"造"的时候投入，造完之后回到杠杆位。

---

### 步骤 1：人 + Architect Plan Mode 对齐（人类必须介入）

**输入给 LLM**：
- `app_design.md` 全文
- 一句追问：「按这个需求，先别写代码。请帮我拆成可独立验收的 module，列出每个 module 的：输入、输出、验收方法（必须可机器或人快速判定）、风险点。」

**LLM 期望输出**（plan.md，由 Architect 起草）：
```
module-1 抓取层
  输入: 关键词（如人物名 / 话题）
  输出: 原始笔记 JSON (title, summary, tags, signals)
  验收: 存到本地文件 + 数量 >=N + 字段非空
  风险: xhs 反爬、签名变化

module-2 蒸馏层
  输入: module-1 的 JSON
  输出: Skill markdown (人物画像/表达习惯/常见话题)
  验收: ❌ 无机器判定 → 必须人评分（1-5 分，<=3 退回）
  风险: 主观，LLM 可能跑偏

module-3 对话层
  输入: 选中的 Skill markdown
  输出: 渲染 + 对话框 + 流式回复
  验收: Puppeteer 跑通"选人→发消息→收回复"
  风险: 小
```

**人调整什么**：
- 验收能不能再具体？比如 module-1 改成「拿到 ≥30 条、互动数 ≥1000、最近 7 天内」
- module-2 的「人评分」流程要不要做成一个内部小页面，能批量打分？
- 取舍：先做哪个 module？建议 **3 → 1 → 2**（先有看得见的壳，再灌真数据，最后调蒸馏）

**这一步能不能完全自动？**
- ❌ **不能**。Architect 拆完之后，需要人决定优先级、确认"哪个验收标准是合理的"、决定 module-2 这种主观环节怎么收口。
- Boris 自己讲：「Plan 是否够好，是 80% 的成败」。Plan 错了，后面 20 个 PR 全是错的。

---

### 步骤 2：并行开搞——按 Boris 风格，开多个 worktree（多数可自动）

启 3 个 Claude（每个独立 worktree）：

```
worktree-1: module-3 对话 UI（壳）
worktree-2: module-1 抓取
worktree-3: module-2 蒸馏（先 stub）
```

每个会话**都从 plan mode 起步**：

**输入给 Claude（worktree-3, UI）**：
```
读取 spec/module-3.md。
进入 plan mode：
- 列出文件清单
- 说明数据流（mock skill 列表 → 选中 → 调 /api/chat）
- 说明你要怎么用浏览器自验（点击 → 发消息 → 看回复出现）
不要写代码。
```

**Claude 输出**：plan.md（文件结构、API 形状、自验脚本）

**人调整**：可能要纠正一个错误——比如它打算把 Skill 列表硬编码到前端，你要它走 `/api/skills` 拿。

**切到 execute**：
- Claude 写完代码 → 起 dev server → 用 Chrome 扩展（或 Puppeteer）自己点页面 → 验证文字出现 → 改 bug → 再验 → 通过
- 这一段**可以完全自动**，因为有客观验收（页面渲染、API 返回）

✅ **UI 模块：Boris 工作流 100% 适用，可全自动到"PR 待人 review"为止**。

---

### 步骤 3：抓取模块（半自动，外部依赖是地雷）

**输入给 Claude（worktree-2）**：
```
Plan mode。任务：实现一个 Next.js Server Action / API route，
输入关键词，输出最近 7 天热门笔记 JSON。
要求：
- 只读公开数据
- 写一个集成测试：跑一次，必须拿到 >=10 条
- 字段：title/summary/tags/likes/comments
```

**Claude 输出 plan**：列出抓取策略（cheerio / playwright / 官方未公开 API），说明可能踩的坑。

**人必须介入的点**：
1. **风控判断**：你接受用哪种抓取方式？要不要 cookie？要不要登录态？——Claude 不知道你能接受多少灰度。
2. **失败时怎么办**：xhs 改了页面结构，自验失败。Claude 自己改？还是停下来等人？——必须人定。
3. **数据是否"够好"**：抓到 30 条，但全是几年前的旧文。机器看着 `likes >= 1000` 通过了，**实际没用**。

⚠️ **结论**：这一环节**不能完全自动**。Claude 可以把代码写出来跑通，但「数据可用性」需要人抽查。
- 折中做法：把"人抽查"做成 Architect 的固定动作——每次跑完抓取，输出 10 条样本到 `samples/`，让人扫一眼。

---

### 步骤 4：蒸馏模块——靠"评测集 + LLM-judge + 人看分歧"建自验循环

> 此前一版我写"必须人评 1-5 分退回"是偷懒。这种做法**人马上变成瓶颈**：30 个 skill / 天，每个看 5 分钟就是 2.5 小时纯打分，根本跑不动。**正确做法是先把"主观判断"工程化成一个自验循环，让人只在杠杆点上工作。**

#### 4.1 关键洞察：人无法"光看 skill 文本"打分

设想你拿到一份 skill.md，写了"语气活泼、爱用感叹号、关心母婴话题"——你能判断它好坏吗？
- 单看文本：判断不了，只知道"看起来像那么回事"
- 真正能判断的是：**用这个 skill 去对话，回复像不像那个人**

所以人也不是直接看 skill，而是**通过对话来反向验证 skill**。这件事完全可以工程化。

#### 4.2 蒸馏模块的自验循环（关键设计）

```
[一次性建] 评测集 eval_set.json
   ├─ 输入：从 module-1 抓取的笔记里挑 N 条"原文片段"
   ├─ 加工：对每条原文，构造一个"问题→该人物会怎么回答"的对话对
   │        （用 LLM 半自动生成候选，人抽查/微调，最终留 30-50 对）
   └─ 这是 ground truth，一次性投入，后续都用它

[每次蒸馏后] 自动跑评测
   ├─ 用蒸馏出的 skill.md 去回答 eval_set 里的所有"问题"
   ├─ 用一个 LLM-as-judge（独立、强模型）对比：
   │   候选回答 vs ground truth 回答
   │   打分维度（每个 0-3 分）：
   │     - 语气还原度
   │     - 话题/口头禅命中
   │     - 事实/人设一致性
   ├─ 输出：分项均分 + 低分 case 列表
   └─ 阈值（如均分 < 2.0 或低分率 > 30%）→ 蒸馏失败，自动退回 prompt 改写

[人介入] 只看三件事
   1. eval_set 本身的质量（一次性，建完就稳定）
   2. judge 给的分数分布是否合理（抽查 5-10 个"高分"和"低分" case）
   3. 当 judge 与你的直觉**冲突**时（judge 说好你说差 / 反之），裁决 + 修 judge prompt
```

> 这就是 Boris 那条「**give Claude a way to verify its work**」在主观场景下的落地：你不是没有验证函数，是**自己造一个验证函数**。

#### 4.3 但这里有几个真问题，别假装不存在

1. **eval_set 的 ground truth 从哪来？**
   - 公开访谈/视频字幕里挖原话最准（如果有）
   - 半自动：让 LLM 基于原始笔记生成「问题 + 候选回答」对，人快速过一遍删掉不像的
   - **粒度建议**：30-50 对就够起步，不要追求 500 对再开工——评测集本身也要迭代

2. **LLM-judge 自己也会错**：
   - 它和被评的模型同源时（比如都用 Claude），有同构偏好——容易给同样"AI 腔"打高分
   - 缓解：judge 用不同家的模型；judge prompt 里强制要求引用 ground truth 的具体片段做对比；定期人抽查校准

3. **eval_set 会过拟合**：
   - 蒸馏 prompt 改着改着可能就是在"针对评测集刷分"
   - 缓解：留 20% holdout，迭代时不看；每 N 轮换一批

4. **冷启动的鸡生蛋问题**：
   - 没有 ground truth 之前，第一版 skill 怎么验？
   - 务实做法：第一个人物**人工写一遍 skill** 作为对照基准，先跑通整条 pipeline，再让 LLM 蒸馏去逼近这个基准。后续人物就不用人写了。

#### 4.4 这一步能不能完全自动？

- **流程上可以**：eval 跑、judge 评、低分退回、prompt 自动改写——闭环可建
- **冷启动和定标必须人**：eval_set 的初版、judge prompt 的校准、阈值的拍板，这几件人必须做
- **稳态后人变成杠杆**：人不再逐个 skill 看，而是看"分布异动 / judge 分歧"。每周 30 分钟就够维护一个人物大类

> 修正之前的结论：**Boris 工作流没有"失效"，是需要你把"验证函数"自己造出来。** 造完之后，这套循环和他的"写代码 → 跑测试 → 自改"在结构上完全一样——只是测试不是 pytest，是 LLM-judge。

> **真正的盲区在哪？** —— 在 judge 也判不出的更深层主观（比如"这个 skill 有没有灵魂"）。这种就别强求自动了，接受它需要人，并把"人需要看的总量"压到最小。

---

### 步骤 5：PR / 评审 / 合并（分级，不让人成卡点）

按"分层过滤、人看杠杆点"的原则：

| 动作 | 谁做 | 备注 |
|---|---|---|
| Claude 提 PR、写 commit message、附 risk summary | Claude | 自动 |
| `/loop 5m /babysit` 自动 rebase / 改 lint / 应对评论 | Claude | 自动 |
| 第 0 层：lint / type / unit / e2e | CI | 自动，不过就打回 |
| 第 1 层：`claude -p` code review，挡 ~80% bug 并留评论 | Claude | 自动 |
| 第 2 层：风险打分（动核心 API / schema / 删>200 行 / 新依赖） | Claude 自评 + Architect 复核 | 半自动 |
| **第 3 层：人 deep dive** | 人 | 只看高风险 + 抽样低风险，30s-2min/PR |
| 验证 UI 模块：Puppeteer | Claude | 自动 |
| 验证抓取模块：质量打分通过 + 异常样本告警 | Claude | 自动；只在告警时人介入 |
| 验证蒸馏模块：eval_set + judge 跑分 + holdout 监控 | Claude | 自动；人只在分歧/分布异动时介入 |
| 最终 merge 按钮 | 人 | Boris 也是；但他不"逐行看"，他"逐 PR 决策" |

---

## 四、对 1+1+1 工作流的启发

回到 `team3_coding/human_coding/基于 Claude Autonomous Coding 的 1+1+1 工作流指南.md` 里现有的 Architect / Dev 设定，Boris 的实践告诉我们几件事：

1. **Architect 的核心价值在 Plan，且在"造验证函数"上**：Boris 说「once the plan is good, it'll just one-shot」。Plan 里最重要的不是"任务清单"，而是「**这个 module 怎么算通过**」——能机器判就给机器判，不能机器判就负责设计评测集 + judge。

2. **验收三分，不是二分**：建议 `module_X_feature_list.json` 里每个 feature 标：
   - `verify_by: "machine"` —— Dev 自验闭环
   - `verify_by: "judge"` —— 需要先建 eval_set，judge 跑分（蒸馏类）
   - `verify_by: "human_sampling"` —— 机器先过，人抽样（如抓取数据可用性）
   - 纯 `verify_by: "human"`（人逐个看）应当被视为**Architect 拆解不到位的信号**，要追问能不能转成上面三种。

3. **拆 module 时加 `dependencies` 字段**：并行的硬前提是依赖图扁平。如果一个 module 依赖另一个 module 未完成，必须串行。Architect 不能因为想"凑并行数"就硬拆。

4. **Architect 自己也要分层 review，不能逐行看**：Architect 是质检员不是抄写员。看 Dev 的交付总结 + risk summary + 自动化结果，**只对高风险点 deep dive**。否则 Architect 就是新瓶颈。

5. **人 review 不是"看代码对不对"，是"看意图配不配 merge"**：架构、命名、过度工程、隐藏假设——这些自动化兜不住。剩下的交给机器。

6. **蒸馏/抓取类主观模块要专设 eval 资产**：在 spec 目录加 `eval/` 子目录，存评测集、judge prompt、历史分数。这些是**和代码同等地位的产物**，要进 git，要 review，要迭代。

---

## 五、一图回答原始问题

```
                         ┌──────────────────────────────────────────┐
                         │ 主观判断密度        ←──────→         客观可验密度 │
                         │ (蒸馏 skill / UX 决策)              (代码、UI 渲染)│
                         └──────────────────────────────────────────┘

[人类]
  ↑ 杠杆位（投入要少而准）：
    1. 拆 module、定验收口径
    2. 造验证函数（评测集 / judge prompt / 风险打分规则）
    3. 看自动化结果中"分歧 / 异动 / 高风险"那部分
    4. 最终 merge 决策
  ↑
[Architect]
  ↑ Plan、追问"怎么算通过"、设计三类 verify_by、维护 eval 资产
  ↑
[Dev × N（独立 module）]
  ↑ plan mode → write → 自验循环 → PR + risk summary
       ↑
       └─ 自验循环 = Boris 工作流的灵魂
          客观场景用测试/浏览器；主观场景用"评测集 + judge"
```

> **一句话总结**：Boris 工作流不是"AI 取代人"，是"**AI 把可验证的部分吞掉了**"。在主观场景下，关键工程动作是**自己造一个验证函数**——一旦造出来，闭环和写代码一样可以自动跑。人不是兜底打分员，是验证函数的**设计者**和**异动裁决者**。这两个角色都是高杠杆，省不掉，但不应该让人沦为流水线上的逐个 review 工人。
