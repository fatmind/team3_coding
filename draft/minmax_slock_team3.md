# MiniMax / Slock / Team3 对比

参考：

- MiniMax Agent Team: https://agent.minimax.io/docs/techblog/agent-team
- Slock - Is Having Agents in the Room Meant to Be Chaotic?: https://slock.ai/resources/blog/is-having-agents-in-the-room-meant-to-be-chaotic/
- Slock - Agents Need Names: https://slock.ai/resources/blog/agents-need-names/
- Team3 v2: `team3/spec/app_design_v2.md`

## 1. MiniMax Agent Team

### 想解的问题

MiniMax 先从单 Agent 的几个问题出发：

- 长任务中途停下来，问人要不要继续
- 越跑越容易丢约束，自己 review 自己也不可靠
- 任务跑很久时，人还在聊天窗口里等，不知道它到底有没有在做
- 一个 agent 什么都做，研究、写作、排版、验收都挤在同一个上下文里

它想解决的是：复杂任务不能只靠一个 agent 一口气做完，需要有人拆任务、有人执行、有人验收，还要能随时告诉人进展。

### 整体思路

MiniMax 的答案是 Team Engine。

一个 Leader 接住人的请求，把任务拆给 Worker；Worker 做事；Verifier 检查；失败就回到 Worker 修改。系统负责记录状态、状态流转、日志、验收结果。人不是每一步都盯着，但关键状态要能看到，关键决策要能接管。

它不是把几个 agent 拉进一个群聊，而是把多 agent 当成一个运行时来管：谁在做、做到哪、谁验收、失败后去哪一步，都由系统保存和推进。

### 关键点

- **Worker 和 Verifier 要分开**：写的人和验的人不能是同一个视角。Verifier 的价值是把 "done" 变成 "ready to ship"。
- **Team 不是越多 agent 越好**：简单任务不该开 Team。Team 只适合复杂、长链路、高风险、需要验收的任务。
- **多 Agent 会变贵**：上下文交接、共享、结果汇总都会增加时间和 token。要问清楚：多花的钱和时间，换来了什么。
- **验收、重试、人类决策都有成本**：Verifier 如果只是表演，就是假安全；重试如果没有上限，就会打转；高风险决策最后要人签字。
- **Agent 产品最后是 runtime，不只是 prompt**：靠 prompt 写几个角色只能做 demo。要跑真实任务，需要状态机、日志、权限、可恢复、可追溯。

说明：MiniMax 文章讲了很多行业对比，本文只抽和 Team3 相关的部分。

## 2. Slock

Slock 两篇文章其实在讲同一个问题：Agent 不是持续在线的人，但现在很多工作区是按持续在线的人设计的。

### 想解的问题

第一篇讲共享房间里的混乱。

人在群聊里是持续感知的：谁刚说了什么、谁正在接话、话题有没有变，人可以自然判断。但 agent 是一回合一回合工作的：读一个快照、思考、提交动作，然后停。它写回复时，房间可能已经变了。于是就会出现重复回复、抢任务、过时回复、错过上下文。

第二篇讲名字。

当 agent 多起来以后，只有角色名不够。`QA`、`frontend engineer` 是类型；`Noel`、`Bugen` 这种名字代表一个具体成员。名字会带着历史：它过去擅长什么、抓过什么问题、你对它有什么期待。

Slock 想解决的是：人和 agent 在同一个协作空间里工作时，agent 要有适合自己的界面，也要能被人稳定地识别和路由。

### 整体思路

Slock 的答案是 agent-native workspace。

它不是把 agent 塞进传统 IM，而是重新设计 agent 会接触的界面。它提出 AX，也就是 Agent Experience。AX 不是问人看得顺不顺，而是问 agent 能不能正确看见、记住、恢复、决定。

它把 AX 拆成四个问题：

- agent 行动时看见什么
- agent 两次调用之间带着什么状态
- 状态过期或失败后，agent 能怎么恢复
- agent 被允许自己决定什么

Slock 的两个例子很具体：

- **agent inbox**：消息不直接塞进 agent 当前上下文，而是变成 agent 可以查询的 inbox。agent 自己决定哪些消息值得读进当前任务。
- **held draft**：agent 写好回复后，如果房间已经变了，消息先不发。系统告诉 agent 期间发生了什么，让它选择重写、照发、沉默，或明确知道过期后仍发送。

### 关键点

- **Agent 是回合式的，不是持续在线的人**：所以工作区必须显式处理 "读到的状态" 和 "提交动作时的状态" 之间的差异。
- **不要把所有消息都塞进上下文**：上下文是稀缺资源，agent 应该能选择什么值得读。
- **动作选项要显式给 agent**：人可以自然决定沉默、修改、照发；agent 需要系统把这些选项摆出来。
- **名字是路由工具，也是信任缓存**：当团队里有多个 agent，名字让人知道该找谁，也让反馈沉淀到具体成员上。
- **名字也会过期**：如果大家对某个 agent 的印象不更新，名字会变成旧标签，限制它接新类型的活。

//todo Slock 的 "名字" 对 Team3 很有启发，但 Team3 当前的 Arch / Dev / UAT 更偏角色，还没有真正形成 named agent 的长期信任记录。

## 3. Team3

### 想解的问题

Team3 的问题更窄：人和 AI 一起做软件产品时，如何把 AI coding 从单次 feature 推进到持续协作。

现在的痛点是：

- 人变成多个 AI session 的调度器
- AI 写得很快，但人验不过来
- 长周期开发时，上下文、经验、进度都容易散
- 产品成果要可信：UI 要像样，验收要真能发现问题，换低价模型后也要能跑

Team3 不想做一个通用 agent team，而是先做一个 coding 流水线：人定方向，Arch 拆，Dev 做，UAT 从用户角度验。

### 整体思路

Team3 用本地文件系统做协作底座。

人、Arch、Dev、UAT 之间不是靠脑子记，也不是靠一个长聊天窗口记，而是把结论写到 `spec/`、`actions.jsonl`、`progress.txt`、`uat_report.md`、`decision_log.md`。daemon 负责转发消息、启动 agent、记录日志、处理超时和重试。

v2 现在的重点不是重新设计，而是修几个真实 dogfood 后暴露的问题。主线是：流程跑起来了，但证据、通知、上下文和回归成本还没管住。

- UI 方法没有自动带到新项目
- Arch 验收已有 checklist，但不知道是否真起作用
- UAT 黑盒规则主要靠 prompt，还缺证据和归因
- PC Web 能看 agent log，但手机上还不能及时通知和干预
- e2e 全量回归越来越慢
- Arch 上下文越积越多，需要裁剪

### 关键点

- **成果可信排第一**：先看做出来的东西像不像样、验收能不能发现问题、换模型能不能跑通。
- **文件是交接物**：spec、progress、report、decision_log 是外部状态，不把长期协作押在一个 session 的上下文里。
- **UAT 是产品视角**：UAT 不读代码，不读 progress，用用户故事和 UI 操作验主流程。
- **稳定性已经有一层基础设计**：超时、重试、dead letter、消息不丢放在 `app_stability.md`。
- **现在很多约束还靠 prompt**：Arch checklist、UAT 不走 API、截图自查等都需要变成更可检查的证据。
- **Team3 还在 demo 验证期**：CLI 解耦、多模型支持、复杂中断机制都不是当前优先级。

//todo Team3 是否应该保留固定 Arch / Dev / UAT 三角色，还是按任务复杂度决定？team3 定位针对的是商业化产品，不是简单 vibe coding，需要保留

## 4. 三者对比

### 共同点

三者都在处理同一个底层问题：单 agent 做长任务不稳定。

它们都没有把答案押在 "模型更聪明" 上，而是把工作拆开，把状态放到外部，把验证做成流程，把人的关键决策保留下来。

具体说：

- MiniMax 强调 Leader / Worker / Verifier
- Slock 强调 agent 看到什么、带什么状态、能怎么行动
- Team3 强调 spec 文件、agent 分工、UAT、daemon 调度

它们的共同判断是：多 agent 的价值不在 "多开几个模型"，而在能不能把复杂任务变成可推进、可验收、可恢复的流程。

### 差异

MiniMax 更像是在做通用 Team Engine。

它关心的是：复杂任务是否值得开 Team，如何拆，谁验，失败怎么回滚，人什么时候决策。

Slock 更像是在做 agent-native workspace。

它关心的是：agent 和人在同一个房间里怎么不乱。它不从任务流水线出发，而是从 agent 的交互界面出发：消息怎么进上下文、回复过期怎么办、名字怎么路由、身份怎么积累。

Team3 更像是在做 coding 场景的本地协作流水线。

它关心的是：一个产品从 app design 到 module、feature、UAT 怎么持续推进。它不追求通用 Team，而是先把 coding 这条链路跑通。

### 对 Team3 的直接启发

从 MiniMax 看，Team3 要警惕三件事：

- Arch / UAT 如果发现不了问题，就是白花时间和 token
- 重试和自修要有上限，否则会打转
- 简单任务不一定值得走完整 Arch / Dev / UAT

从 Slock 看，Team3 要补三件事：

- Agent 的输入不要只是 "把所有文件塞进去"，要设计它这次该看什么
- 人类中途补充要求时，当前任务要能被告知、暂停或改向
- Arch / Dev / UAT 如果长期使用，可能不该只是角色名，也要有自己的历史记录和信任记录

Team3 当前最实际的下一步，不是把 MiniMax 和 Slock 全学一遍，而是选和当前问题最贴近的部分：

- UAT report 证据化
- Arch 验收记录可检查
- 移动 / IM 通知和轻量干预
- Arch 上下文裁剪

这些做好后，Team3 的重点才会从 "让多个 agent 接力" 变成 "让产品开发过程可验收、可恢复"。
