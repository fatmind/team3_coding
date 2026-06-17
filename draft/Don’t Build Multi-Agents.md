今天朋友给我转了一篇来自 Cognition AI 的 Blog，关于多 agents 协同的话题，说到 Cognition 可能很多朋友不知道，但是说到 Devin 大家应该就很熟悉了（我本人也是 Devin 的付费客户），Devin 可以说是在 2024 年那个模型能力还跟不上的时候就开始尝试全自动 Agent Team 开发的产品，并且今天回头看 Devin 的定价和商业模式基本上也普遍被后来者借鉴，从那个刀耕火种的时代一路走来，确实是先驱了。

这篇写于 2025 年 6 月的文章写得其实挺实在的（除了有点标题党，但是其实文章内容并不是），而且大概在一年前的时候就开始探索长时间自主运行 Agent 的设计（想想那个时候还没有 Opus 4.5），在大半年后的今天不仅没有过时，反而很多实践确实最终击中了我自己的实践，于是今天就翻译这篇文章，让他们帮我当个嘴替。

___

## 上下文工程的原则

我们将逐步深入探讨以下原则：

1\. Share context 分享上下文

2\. Actions carry implicit decisions 行动蕴含着隐含的决定

为什么要思考原则？

HTML 诞生于 1993 年。2013 年，Facebook 向世界发布了 React。如今已是 2025 年，React（及其衍生技术）主导着开发者构建网站和应用程序的方式。为什么？因为 React 不仅仅是一个编写代码的框架，它更是一种理念。使用 React，意味着你采用响应式和模块化的模式来构建应用程序，这在今天已成为公认的标准要求，但对于早期的 Web 开发者来说，这一点并非显而易见。在 LLM 和 AI Agent 的时代，我们似乎仍然在摆弄原始的 HTML 和 CSS，摸索如何将它们组合起来以创造良好的用户体验。除了某些绝对基础的技巧之外，目前还没有一种构建 Agent Team 的方法成为标准。

也就是说，如果你是 Agent 构建新手，有很多资源可以指导你如何搭建基本框架\[\]\[\]。但是，当涉及到构建严肃的生产应用程序时，情况就完全不同了。

## 构建长期运行 Agent 的理论

我们先从可靠性说起。当需要在长时间运行并保持对话连贯性的同时保持可靠性时，必须采取一些措施来控制潜在的累积性错误。否则，稍有不慎，系统就会迅速崩溃。而可靠性的核心在于上下文工程（Context Engineering）。

到 2025 年，现有的模型将极其智能（2026 年回头看，判断对了）。但即使是最聪明的人类，如果没有任务的具体情境，也无法有效地完成工作。“提示工程”一词指的是为了使任务能够以最适合 LLM 聊天机器人的格式编写而需要付出的努力。“Context Engineering工程”则是更高层次的工程。它指的是在动态系统中自动完成这项工作。这需要更加细致入微的理解，实际上也是构建 Agent 的工程师的首要任务。

以一种常见的 Agent 为例。这种 Agent：

1\. 将其工作分解成多个部分

2.开始安排 Sub Agents 处理这些部分

3\. 最后将这些结果结合起来。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

这种架构很有吸引力，尤其是在涉及多个并行组件的任务领域。然而，它非常脆弱。关键的故障点在于：

假设你的任务是“制作一个 Flappy Bird 的克隆游戏”。这可以分为两个子任务：

子任务 1 “制作一个带有绿色管道和碰撞箱的动态游戏背景”

子任务 2 “制作一只可以上下移动的小鸟”。

原来，Sub Agent 1 误解了你的子任务，开始构建一个看起来像《超级马里奥兄弟》的背景。Sub Agent 2 为你构建了一只鸟，但它看起来不像游戏素材，而且它的移动方式也和《Flappy Bird》里的鸟完全不同。现在，最后一个 Main Agent 不得不面对一个棘手的任务：将这两个错误信息整合起来。

这或许听起来有些牵强，但现实世界中的大多数任务都包含许多细微差别，而这些差别都可能导致沟通误解。你可能会认为，一个简单的解决方案就是将原始任务作为上下文复制到Sub Agent中。这样，它们就不会误解自己的子任务。但请记住，在实际的生产系统中，对话很可能是多轮的，Agent可能需要调用一些工具来决定如何分解任务，而且任何细节都可能影响对任务的理解。

> _Principle 1  原则一_
> 
> Share context, and share full agent traces, not just individual messages分享上下文信息，并分享完整的 Agent 跟踪记录，而不仅仅是单个消息。

让我们再对我们的 Agent 进行一次修改，这次要确保每个Agent都有之前代理的上下文。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

不幸的是，我们还没完全摆脱困境。当你给你的 Agent 布置同样的 Flappy Bird 克隆任务时，这次你可能会得到一只鸟和背景拥有完全不同的视觉风格。Sub Agent 1 和 Sub Agent 2 无法看到对方的操作，因此他们的工作最终会彼此不一致。

Sub Agent1 采取的行动和Sub Agent 2采取的行动是基于事先未规定的相互矛盾的假设。

> _Principle 2  原则二_
> 
> Actions carry implicit decisions, and conflicting decisions carry bad results行动中蕴含着隐含的决定，而相互冲突的决定则会导致不良后果。

我认为原则 1 和原则 2 至关重要，而且极少有违背它们的理由，因此默认情况下，任何不遵守这两条原则的 Agent 架构都是错的。你或许会觉得这样做限制太多，但实际上，你仍然可以为你的 Agent 探索很多种不同的架构。

遵循这些原则最简单的方法就是使用单线程线性代理：

这里的上下文是连续的。但是，对于包含众多子部分的大型任务，上下文窗口可能会溢出。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

说实话，简单的架构已经足够用了，但对于那些需要处理真正长期任务，并且愿意投入精力的人来说，还可以做得更好。解决这个问题的方法有很多，但今天我只介绍其中一种：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

在这个世界里，我们引入了一个新的 LLM 模块，其主要目的是将过往的行动和对话压缩成关键细节、事件和决策。这并非易事。它需要投入大量精力来找出关键信息，并创建一个能够有效处理这些信息的系统。根据具体领域，您甚至可以考虑对一个较小的 LLM 模型进行微调（事实上，这正是我们在 Cognition 所做的）。

这样做的好处是，Agent 能够有效地处理更长的上下文。不过，最终你还是会遇到瓶颈。对读者来说，我鼓励你们思考更好的方法来管理任意长度的上下文。这最终会成为一个相当重要/深奥的课题！

## Applying the Principles  应用这些原则

如果你是 Agent 开发者，请确保你的 Agent 的每个动作都基于系统其他部分的所有相关决策。理想情况下，每个动作都应该能够感知到其他所有信息。然而，由于上下文窗口有限以及实际操作中的权衡取舍，这并非总是可行。因此，你需要权衡在达到目标可靠性水平的同时，愿意承担多大的复杂度。在考虑如何设计智能体架构以避免决策冲突时，以下是一些值得思考的现实案例：

Claude Code Subagents

截至 2025 年 6 月，Claude Code 就是一个会生成子任务的Agent的例子。然而，它从不与 Sub Agents 并行工作，而且子任务Agent通常只负责回答问题，并不编写任何代码。为什么呢？因为子任务Agent缺乏来自主 Agent 的上下文信息，而这些信息对于它完成回答明确问题之外的任何操作都至关重要。如果运行多个并行的Sub Agents，它们可能会给出相互冲突的答案，从而导致我们在之前的Agent示例中看到的可靠性问题。在这种情况下，使用Sub Agents的好处在于，Sub Agents的所有调查工作都不需要保留在主智能体的历史记录中，从而允许在上下文信息耗尽之前进行更长时间的跟踪。Claude Code 的设计者特意采用了一种简洁的方法。

Edit-Apply Models编辑-应用模型

2024 年，许多模型在代码编辑方面表现糟糕。编码代理、集成开发环境 (IDE)、应用构建器等（包括 Devin）普遍采用“编辑-应用模型”的做法。其核心理念是，与其让大型模型输出格式正确的差异，不如让小型模型根据用户提供的 Markdown 格式修改说明重写整个文件，这样实际上更为可靠。因此，构建器让大型模型输出代码编辑的 Markdown 说明，然后将这些 Markdown 说明输入到小型模型中，由小型模型实际重写文件。然而，这些系统仍然存在诸多缺陷。例如，小型模型经常会误解大型模型的指令，并由于指令中哪怕最细微的歧义而做出错误的编辑。如今，编辑决策和应用通常由单个模型在一次操作中完成。

关于 Multi-Agents 多智能体

如果我们真的想从我们的系统中消除并行性，你可能会想让参与者（决策者）们互相“交谈”，共同解决问题。这就是我们人类在意见不一致时（在理想情况下）会采取的做法。如果工程师 A 的代码与工程师 B 的代码合并时发生冲突，正确的做法是双方沟通，找出分歧并达成共识。然而，如今的 Agent 在进行这种长时间的主动对话方面，其可靠性远不及单个 Agent。人类在彼此交流最重要的知识方面非常高效，但这种高效需要相当高的智能。（2026.4：现在我们已经看到了，类似 Slock.ai 这样的产品配合 Opus 模型的威力了。。。）

自 ChatGPT 发布后不久，人们就开始探索多个智能体相互交互以实现目标的理念。虽然我对 Agents 间协作的长期前景持乐观态度，但显而易见，到 2025 年，运行多个智能体进行协作只会导致系统脆弱。决策过程过于分散，智能体之间无法充分共享上下文信息（我认为这个判断在 2026 年已经开始成为过时了）。目前，我还没有看到有人专门致力于解决这个棘手的跨智能体上下文传递问题（今天很多人在尝试相关工作，上面提到的 Slock 就是一个例子，今天包括 Claude / OpenAI / Kimi 等主流模型和 Agent 厂商都在这个方向上有所投入）。我个人认为，随着我们不断提升单线程 Agent 与人类的沟通能力，这个问题自然会迎刃而解。届时，我们将获得更大的并行性和更高的效率。

迈向更一般的理论

这些关于 Context Engineering 的观察仅仅是构建 Agent 标准原则的开端，而这些原则或许有一天会成为构建 Agent 的标准原则。此外，还有许多其他挑战和技术并未在此讨论。在 Cognition， Agent 构建是我们关注的关键前沿领域。我们围绕这些原则构建内部工具和框架，并不断重新学习这些原则以强化其理念。但我们的理论可能并不完美，而且我们预计随着该领域的进步，情况也会发生变化，因此保持一定的灵活性和谦逊态度也至关重要。