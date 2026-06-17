# Harness Engineering in 2026.3

![图片](https://mmbiz.qpic.cn/sz_mmbiz_png/AQatuicdEC6XZetvZJZia9NF1GXNrrqpmYdQeb5QERTn20fuxLCAL5Lp70YwupxYPQTH6rRfPiaN5B1ulhtCjicSmVn6FQA27nB4nibDQkNEmEkY/640?wx_fmt=png&from=appmsg&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=0)

**不知道为什么最近 Harness Engineering 突然火了，之前我其实猜到了大家肯定要发明一个新词，但是 Harness 这个词我真的是完全没想到，我觉得咱们这个行业还真是非常爱制造新的概念，也属于制造焦虑的一种了。另外就是我年初的那句：你现在的所有认知，一个月后都会严重过时，到现在还是一语成谶。**

其实大概是今年1月，也就是前两个月，我终于从个人的 Vibe Coding 工作流切换到了多 Agent 的协同。当时的目标非常简单：就是想看看在无人工干预的情况下，能长时间持续燃烧 Token 到一个什么样的量级。

因为当时 [db9.ai](https://mp.weixin.qq.com/s?__biz=MzI3MjI4Njk0Ng==&mid=2247484709&idx=1&sn=6347fb2a22b3495bfc02c8a61b6d1db8&scene=21#wechat_redirect) 的工程正处于快速推进期，我观察到峰值时一天能消耗掉 12 亿 Token。要达到这种量级，必须满足两个条件：

1\. 软件已经进入良好的架构期

工程必须具备良好的架构，清晰的模块划分，能够支持多个 Agent 的分布式高速协同开发，并且有完善的 CI/CD 体系。

2\. 多 Agent 协同工作体系

必须有一套我们现在所说的 Harness Engineering 体系，让大家在没有人工介入的情况下，确保项目能在一个正确的软件工程方向上持续推进，让代码不快速腐化。因为在这种级别的 Token 消耗量下，人是不可能再去看任何的技术细节了。

我是觉得，其实大家现在看着 Harness Engineering 非常神秘，非常高端。但反倒我不这么认为，它还真就是非常朴素的软件工程常识和管理软件团队的一些手段，下面说一下我的实践。

Agent 层级和组织架构

首先我觉得要做好一个 Harness Engineering 的项目，你一定要放弃在“一台机器”或者“一个 Claude Code / Open Code”上面跟它持续聊天布置任务这种模式。

其实我在前两个月写的那篇 Open Code 文章里的实践，我现在已经基本完全放弃了。因为如果你今天还在打开一个具体的 Claude Code，描述具体的工作，那你就要好好考虑一下，因为整个项目的吞吐瓶颈，其实就是你。

第一个你更应该关注的是不同 Agent 的角色划分和通信协同机制。

第二个就是你项目中的“宪法”，即有哪些 Ground Rules 是一定要去遵守的。你可以认为这就是在所有 Agent 开发成员里共享的一套东西，这套东西你在开始每一个任务的时候，都要注入到它的上下文中。

第三，你作为人类，如何纠偏。现在多数的 Coding Agent 工具，底层的工具比如 Claude Code、Codex，仍然时不时会有这种灾难性的 Compaction。

但是现在越来越多的上层 Harness Engineering 实践，慢慢在把 Compaction 这个概念隐藏。因为我觉得多数工具是倾向于自己去管理项目上下文，也就是将单个 Agent 的 Compaction 作为一种自然现象，或者说作为模型内置的一个基础假设，在假设任何时候都可能发生 Compaction 的情况下，你怎么能持续推进当前的工作？

对我来说，这个过程其实也经历了几轮迭代。

最开始我在做 DB9 的时候，是想着让 Agent 完全自组织，人工完全不参与。我甚至做了一个小型的 Agent 协同工具，有点模仿 moltbook 但是作为软件开发专用的工具（开源在： https://github.com/c4pt0r/minibook）。我让 Agent 在里面自发地组队和自发地开发，人类不做引导，如果我有需求的话，就去跟我的 Agent 去沟通，然后让他在这个 minibook 里面引导整个开发团队。但是最后实践的效果不是太好，具体的表现有以下几点：

1\. 它不够实时

因为类似 minibook 或者 GitHub 这种模式，其实都是一个被动的 Pull 模式。更新都是依靠 Agent 自己的 Cron tab 机制去平台上去拉取。

2\. 无用信息爆炸

我个人觉得，这种论坛的模式，让 Agent 在里边直接进行交流，会产生大量的无用信息。而且在这种新的成员加入之后，他其实很容易被误导。简单来说，让 Agent 自己在聊，经常会聊出一些非常车轱辘话的内容。

所以你其实需要不断地去调整整个论坛的方向，这其实是非常累的。而且这跟我当初设计这个系统的理念也有一点不一样——我本来认为人类可以只做观察者，但后来发现不行。

所以我后来开始寻找一些人类和 Agent 团队协同的工具。

这种协同并不是指由我直接去布置具体的编程任务，而是让我能够像一个 HR 或者老板一样，去调整和组织这些 Agent 团队。我也能够及时地发布命令，调整 Team 之间的角色、职级，甚至一些“人设”。

目前我正在使用 slock.ai，这个必须得安利一下，因为这是我最近使用频率最高的软件开发工具（但是其实它不是个软件开发工具）。

它的思路非常简单，类似于 Slack，用过 Slack 的同学都知道它有 Channel（频道）。它是一个团队用的即时聊天工具（飞书应该也是来源于多年前 Slack 在北美的爆火），但 Slock 是专门为 Agent 设计和使用的，与 Minibook 不一样的是，你可以像使用 Slack 一样去跟你的 Agent 同事进行沟通。

我的 Slock 中只有 3 种角色：Dev / Architect / Memory Keeper，我自己更像是 HR 和政委。

为什么没有 QA 人员了呢？Agent 和人不一样，因为我的小型的本地测试，Dev 就能搞定。而一些严肃的大型的回归测试，现在我基本上完全依赖 CI，这个一会儿会说。

我的典型一天：

1\. 我会在 #all 这个 channel 上持续更新 spec，让大家学习。我会让各位去总结昨天的工作以及 Lesson Learned，尤其是要关注 Bad Case，并把这些 Bad Case 分享给大家学习。如果是一些非常重要的信息，就更新到 Spec 里面。

2\. 定期地问一下有没有任何事情需要我来决策或者拍板。因为在我的 Spec 里面已经说了：大多数情况能自己拍板就自己拍板，保证测试通过 CI 全绿就 merge，实在是拍不了板的再来问我。所以像这种情况不会太多。如果有这种情况的话，让他直接 DM 我。

3\. 和 Architect Team 在 #roadmap 里讨论未来一段时间的一些大的 Milestone 和关键功能，我只提我要什么，大概怎么用法，细节由团队讨论细化，这些 Architect 的 Plan/Design 要求多人进行多轮迭代。所有人达成共识后后，在 GitHub 上发布这样的大型计划的 Issue（按照一定格式）。然后开发团队就会去接这些活了。

4\. 每一个活都会先开一个 GitHub issue，这个 GitHub issue 会对应一个 Slock 的 channel。当这个 issue 被关闭或做完的时候，也就代表这个 channel 大家可以解散了，防止 context 污染。

5\. 干活的过程其实也差不多就是：讨论/分工/开发/ CI / PR / merge

每一个 agent 底层都是一个 Claude Code + Opus 4.6，有一些 Agent 是 Codex + Gpt-5.2。这些 Agent 会有一些特性：

1\. 首先 Claude Code 有自己的记忆，

2\. 当它出错多了，或者说一些 spec 更新了，它会自己更新到它的 memory 里面。

Slock 并不去接管具体的某一个 agent 的 memory，我觉得这个设计是对的。

在 Slock 里面的这些讨论，其实充斥了大量的无用信息和车轱辘话，但在这些无用信息里面会有一些“宝藏”，这也是为什么我希望一定要把 Token 的消耗弄上来，而且很有意思的是，这些灵光一闪的时刻只要一出现，你的 agent 马上就会发现这些是有价值的，而且还有一种情况：当一个人（Agent）出幻觉了以后，或者说大家都幻觉了，哪怕有一个人脑子清醒地提出了正确的方案，其他人马上脑子就会清醒过来（毕竟 AI 没有人的 ego）。当讨论完并发现了这些“金子”，我建议一定要在 GitHub 上存档，这就是为什么我一定要要求他们所有的设计，以及所有采取的行动，都要在 GitHub 上面，而且要让 GitHub 作为 the source of truth。

当然还有一种非常糟糕的情况，就是之前我在 minibook 没有解决的问题：大家都被绕圈子带歪了，导致在一个错误的方向上持续走偏。

这时候，就需要人进来点拨一下。但相信我，只要一点拨，大家基本上就会清醒过来。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

（我在 all 里发布 spec）

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

（评选先进，互相学习）

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

（重复讨论/发现新的漏洞）

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

（这个看着很搞笑，都会 PUA 和阴阳同事了。。。。我从来没教过它）

接下来就是为什么没有 QA 的原因：其实不是没有，而是变成 CI/CD 了。

因为我发现到了项目的稳定期，大家其实并不太需要这种纯靠 Agent 每时每刻“自我发挥”去做测试。基本情况是已经有了一个相对成熟、或者说相对持续的回归测试环境。

在这个环境里，其实并不需要大模型做什么，简单来说就是跑各种测试。这就是传统的 CI，有了这个以后，你前面那些发散讨论、计划、黑盒开发的工作，才能有一个放心的收尾。现在 db9 这个项目，它每一次提交都会触发 GitHub Action，会完整地跑完所有之前积累下来的测试，而且每一次遇到新的 bug 或者新的特性，在 spec 里面也都会要求去积累到测试里面，不然的话，Agent 很容易就忘了。

还有最后一段，我写一下 Agent 现在需要哪些 Harness Engineering 工具以及基础设施吧。Sandbox，这个不用说了，我之前的文章提到过，最近也火的一塌糊涂。。。。

今天说点其他的。

slock.ai 其实是一个人和 Agent 协同以及讨论发散的平台。对于 Agent 自己的开发，我觉得首先一个记忆系统，或者说一个准确的记忆系统是非常重要的。

比如我在群里面跟大家发布了 Spec，大家组织去学习，最后你啥也没学下来，那这个问题就挺大的对吧？而且就像我刚才说的，当今的 Harness Engineering 方法论其实已经非常淡化这种 Session 的概念了，它就跟小龙虾一样是一个永续的任务流。所以 Team Memory（团队这些关键信息的记忆存储和查询），我觉得这里面是需要一些新工具的。

第二个就是给 Agent 用的 Dropbox和邮箱，这个是我觉得挺有用的，主要基于两个场景：

1\. 协作文件/数据共享：

Agent 互相之间（不包括人）可能需要共享一些二进制文件或者临时文件，或者数据库访问token，这些数据不能上github，但是又要跨机器同步，这个场景是一定存在的。

2\. 邮箱系统：

对于 Agent 来说，它可能需要一套自己的邮箱，而且这个邮箱人也可以查看，存档。

这种多 Agent 协同的文件/数据共享和消息通知，我知道已经有好几个团队在基于 [db9](https://mp.weixin.qq.com/s?__biz=MzI3MjI4Njk0Ng==&mid=2247484709&idx=1&sn=6347fb2a22b3495bfc02c8a61b6d1db8&scene=21#wechat_redirect) 来做这个场景了，我觉得挺合适的，之后也会持续优化这方面的能力和体验。

今天先写到这吧。