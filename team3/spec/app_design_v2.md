# Team3 Coding — v2 迭代设计

> 在 `app_design.md`（v1）基础上，用 opus 4.6 跑了几个真实项目后的迭代。
> 调度稳定性（超时、重试、dead letter、消息不丢）已由 `app_stability.md` 覆盖，不在本文重复写。
> 暂时不做与 Claude Code CLI 解耦，现在还在验证 mvp。

## 产品目标

**当前完成（v1 已验证）**：

- 流程能跑通：人类 + Arch 定设计，Arch / Dev 做 feature，最后 UAT 从用户角度验一遍
- 调度层已有兜底：超时、重试、dead letter、消息不丢这些问题，放在 `app_stability.md`

**接下来要优先解决什么**：

取舍还是按 `decision_log.md` 2026-05-29 的产品优先级：先让首次成果可信，再让过程稳定、简单好用，最后看 token 是否失控。这里的"成果可信"，不是一句空话，要拆成三个能检查的点：

1. **做出来的东西好看不（代码很便宜、好看很关键）**
   - 问题 5：新项目 UI 质量不稳定，还没有把 `app_ux_awesome.md` 那套方法带过去【重点】
2. **验收是不是真的能发现问题**
   - 问题 4：Arch 验收有效性存疑，已有 checklist，但还不知道是否稳定执行、是否真能发现问题
   - 问题 6：UAT 还会走捷径，失败后也不会先自己判断原因【重点】
3. **换个价格低的模型，这套流程还能不能跑通**
   - 验证项：换 qwen3.7 跑一遍，看看流程是不是只靠 opus 4.6 撑着【重点】注：已在验证中

成果可信之后，再看过程是否简单好用，以及上下文怎么处理：

4. **任务跑起来后，人能不能及时知道进展、必要时能不能插手**
   - 问题 7：PC Web 已能看实时 agent log，但移动侧还不能及时通知和干预
   - 问题 3：Agent 执行中，人类的新要求进不去【重点】
5. **上下文怎么处理**
   - 问题 1：e2e 每次全量跑，验收越来越慢【重点】
   - 问题 2：Arch 上下文越积越多，缺少裁剪


---

## 一、先让成果可信

### 问题 5：新项目 UX/UI 质量不稳定【重点】

**现象**：Team3 自己的 Web UI 能做到还不错，是因为有一套 UI 协作方法：先给交互草稿图和品牌方向，再让 AI 在真实页面截图自查；复杂 UI 还会先用外部 AI 生成原型，人类确认后再合并。

但被管理的新项目没有自动继承这套方法。结果是 Dev 会直接开写 UI，写完看起来能用，但布局、比例、状态、交互细节不一定靠谱。

**思路**：
- 在 app 设计完成，若明确有界面，必须先和人类讨论交互，这是开发的第一步。
- 要求人给交互草稿图和品牌方向，这个不能让 AI 猜。
- 交互草稿图和其它 spec 文档一样，保存在 `spec/` 下（如 `spec/ux_xxx.png`），后续 Dev / UAT 都能引用
- 简单 UI：Dev 直接按 `app_ux_awesome.md` 开发，首个 UI feature 用 CLI 初始化 `DESIGN-LANGUAGE.md`、`ss-*` skills、品牌 token。
- 复杂 UI 初始建设 / 局部大重做：默认先走 `app_ux_prototype.md` 的 **HTML 原型包（方案二）**。这个方案已经验证可行，合并代码稳定；外部 AI 生成 HTML 比生成 Next.js 工程更稳定，修改也更简单。
- Dev 做 UI feature 时，必须打开真实页面截图，检查比例、溢出、可点击状态，再交给 Arch

AI 先截图自查，把明显问题修掉，人最后看整体观感。什么叫"好看"，仍然由人来判断。

### 问题 4：Arch 验收有效性存疑

**当前实现**：`arch_prompt.md` 的 MODE B 已经要求 Arch 做对抗式 checklist：
- 先读 module spec 和关键 `src/`，检查 e2e 是否真实、是否 mock 了被测主体、是否有 tautology 测试、是否复用已有接口，最后才看 Dev Delivery，并抽跑 1 个 e2e。
- 通过时还要把 checklist 结论、抽测脚本名和 1 个疑点写进 progress。

**现在的问题**：要求写在 prompt 里，实测 Arch 仍然很少发现问题。但要先判断：是 checklist 本身没抓到问题，还是 Arch 没稳定执行 checklist，或者就是没问题。

**思路**：
- 不是当前卡点，先保持当前方案不动，还没有更好的思路

### 问题 6：UAT 黑盒约束未落地，失败后缺少自查【重点】

**当前实现**：`uat_prompt.md` 已经写得比较明确：
- UAT 不读代码，不读 feature_list / progress；
- 人类操作要用 `simulate_human.mjs` 生成内容，再由 Puppeteer 在 UI 上输入；
- 禁止退化为 API 调用；story 之间不清环境，用 `uat/state.json` 持久化跨 Story / 跨 `uat_check` 的进展与自查轮次（见 @spec/module_4_hardening.md §3.D）；
- UAT session id 不在 `uat/state.json`，Daemon 和 Dev 一样只读 `.team3-project.json` 里的 `uat_agent.session`；
- UAT 不验 UI 样式，只验主流程。

**当前失败处理**：不是一遇到问题就立刻通知人。`uat_prompt.md` 要求：
- `simulate_human` 超时会重试，未知异常尝试恢复 2 次；
- 某个 story 失败后记录现象、期望、实际，继续跑后面的 story；
- 最后写 `spec/uat_report.md`，再 `to_human` 通知人。

**现在的问题**：这些还是主要靠 prompt 约束，代码层没有检查它是否真的用了 Puppeteer，也没有自动判断失败到底是脚本问题还是产品问题。

**思路一：把已有要求变成证据**（详见 @spec/module_4_hardening.md §3.A）：
- 每个 Story 独立一节：目标、结果、用户动线（逐步 pass/fail）、结构化 `uat-evidence` JSON
- JSON 含 verify 脚本路径、截图列表、simulate_human / Puppeteer 使用标记、`uat.log` 锚点
- UAT 写完报告后自己跑 `cli/validate-uat-evidence.mjs`；v1 只校验文件存在、代码有 import、log 有对应标记

**思路二：失败后先分清原因，再找人**（详见 @spec/module_4_hardening.md §3.C）：
- Story 失败 → 分类 → **只重跑该失败 Story**（不重跑全量）
- **只有 UAT 自身脚本/报告问题可自修**；daemon / web / agent / 业务均属产品问题 → `to_arch`
- UAT 用户故事设计用 `uat_design` 新 session；新 Story 验收用 `uat_check` 新 session；product_issue 修复后的重验用 `uat_fix` 复用 session。Daemon 和 Dev 的 `dev_do` / `dev_fix` 一样，只按 action 区分新 session / 复用 session
- 单 Story 最多 **3 轮**（每轮 = 分类 → 处置 → 重跑该 Story）；3 轮仍失败记入 report，继续其它 Story，最后 `to_human` 带完整自查记录

//todo story 之间是尽量独立，还是允许有依赖链？在设计中已经写的很清楚，有些 story 之间是要依赖的，所以环境并没有清理，目前没看到有什么问题。

### 验证项：换 qwen3.7 跑一遍

现在"整体还可以"是在 opus 4.6 上得到的。换模型后还行不行，不知道，需要具体项目来测试。注：已经在测试中，由人来验。

## 二、再让过程简单好用

### 问题 7：PC Web 能看实时 log，但移动侧还不能及时通知和干预

**当前实现**：PC Web 已经能看 agent log。
- daemon 会把 claude 的 `stream-json` 输出写入日志，并通过 WebSocket 推到 Agents 面板；人主动打开 Web 页面，可以看到 Arch / Dev / UAT 当前在输出什么。

**现在的问题**：这解决了"主动看进展"，但还没有解决"及时知道和及时干预"。如果人不在 PC 前，就不知道任务失败、卡住、需要决策；也不能在手机上直接补一句要求或让它停下来。

**思路**：
- 保留 PC Web 的实时 log，作为查看入口
- 增加移动侧/IM 通知：阶段完成、失败、需要人类决策时，推到微信/飞书/钉钉一类通道（思路可借鉴 openclaw 接 IM），只支持对话干预

### 问题 3：Agent 执行中无法打断、插入最新要求【重点】

**现象**：任务一旦派发给 Agent，人类的新输入只能等本轮结束才会被看到。如果这一轮很长，就会出现"我已经知道方向要改，但 Agent 还在按旧方向跑"。
- 注：team3 只考虑 coding，所以还不需要复杂到 slock agent-native workspace，从产品设计上控制 "Agent 间是有序进行的"，但会存在 "人类" 突然插入新要求，需要能中断 

**思路**：
- 注：Claude Code / Codex 的交互式 CLI 里可以用 Esc / Ctrl+C 中断当前操作，**停止当前回合，保留已写文件**，人补充输入后继续
- Team3 现在是 daemon 用 `claude -p` 启动非交互进程，人类新消息优先入队，同时能不能发送中断信号（待调研）

## 三、处理上下文

### 问题 1：e2e 每次全量跑，验收越来越慢【重点】

**现象**：dev 每开发一个 feature 后，回归时全量跑一遍 e2e。feature 多了后，越到后面、回归时间越长。

**思路**：
- 先跑这个 feature 的 e2e，再跑 "受影响" 的
- 关键在"受影响范围"怎么判断：改了哪些文件、影响哪些、是否动了依赖接口等。我判断分 3 步
   - 第一步：在初始拆 feature 时，必须先从 "高维度" 分析依赖关系，作为基准（保存在 feature_list.json）
   - 第二步：回归时，只跑依赖 feature
   - 第三步：防止遗漏，当一个 module 整体都开发完成时，由 arch 触发跑一次全量 e2e 测试

### 问题 2：Arch 上下文持续累积，缺裁剪

**现象**：Arch 长期 resume 一个 session，项目越跑，上下文越长。很多已完成 feature 的过程其实不用再留在 session 里，因为结果已经写进 `feature_list.json`、`progress.txt` 等。

**思路**：daemon 按 module 粒度切换 Arch session，详见 @spec/module_4_hardening.md [问题 2]。hook 已调研不支持 transcript 裁剪，不采用。


## 体验 Tips

- e2e、uat 执行过程中，产生的临时文件，要求写入到 /tmp/xxx/，跑完归档方便人类查，不允许写入到项目目录
- 人类发送消息后，daemon 调度/转发给 agent 后，以目标 agent 身份写一条 note 到 actions.jsonl（`from`=目标 agent，`to`=human，`message`="get，开始处理中，稍等"），经统一 WS 通道推送到 Web，切换页面后仍可从 history 恢复


## 关键技术方案

### 1、Agent 执行中插入人类新要求

目标不是把消息塞进一个正在运行的 `claude -p` 进程里，而是模拟人按 Ctrl+C：

1. 人类对正在执行的 Agent 发新消息
2. daemon 判断该 Agent 当前是否还在运行
3. 如果还在运行，先给当前 `claude -p` 发送 `SIGINT`，让它停止当前回合
4. 当前回合退出后，用同一个 session `--resume` 重启
5. 重启 prompt 前，daemon 自动追加一段说明：上一轮是被用户中断，不代表任务完成；当前工作区可能已有部分改动；请先检查现状，再按用户新消息继续

判断 Agent 是否正在运行，不看 `.team3-project.json` 里的 `session.runing`。这个字段只是当前 session id，不代表进程活着。实际以 daemon 内存状态为准：

- `queue.busy = true`
- 当前 role 有正在运行的 child process
- process 还没有 exit / close

Dev 要特别处理。现在 `dev_do` 默认会创建新 session，但“被人类中断后继续”不能走新 session，否则上下文会断。中断恢复时要强制复用当前 Dev session，用 `--resume` 继续。

进程退出后的处理也要区分原因：用户中断不是失败，不走 timeout retry / dead letter。它只是把当前回合停掉，然后把“中断说明 + 人类新要求”作为下一次输入继续执行。

子进程处理先用 `SIGINT`，尽量让 Claude Code 和它启动的命令自己退出。若后续实测有残留进程，再补进程组级 `SIGINT` 和兜底清理。
