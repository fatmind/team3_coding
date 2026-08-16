# draft/ — Early-stage Ideas & Discussion Notes

> **Note:** These are *process documents* produced during the early ideation phase — **not** the official project documentation and **not** representative of the final design. Each file is an independent piece of thinking, kept by topic, useful for tracing how team3 evolved. For the authoritative design, see `team3/spec/` and `team3/human_coding/team3.md`.

> 特别提醒：这是项目**前期想法讨论期间**产生的过程文档，不是正式项目文档，不代表当前实现的最终设计。
> 每篇都是一段独立的思考过程，按时间与话题沉淀，适合了解 team3 的思路演进；阅读时请以 `team3/spec/` 与 `team3/human_coding/team3.md` 的权威定义为准。

---

## Document List / 文档列表

| 文档 Document | 一句话介绍 Description |
|---|---|
| [42章_0328_aicoding_纪要.md](42章_0328_aicoding_纪要.md) | 0328 AI Coding 会议纪要（问答实录）：验证集、客户确认、减少人肉环节等讨论 · Meeting notes (Q&A) on AI coding: validation sets, customer sign-off, reducing manual steps |
| [boris_workflow_analysis.md](boris_workflow_analysis.md) | 拆解 Boris Cherny（Claude Code 作者）的「人 + Agent」工作流并批判性迁移验证 · Breaking down Boris Cherny's human–agent workflow and validating whether it transfers |
| [Don’t Build Multi-Agents.md](Don’t%20Build%20Multi-Agents.md) | 翻译+评论 Cognition AI「别急着做多 Agent」一文，结合自身长时间自主 Agent 实践 · Translation & commentary on Cognition AI's "don't build multi-agents", grounded in our own long-running autonomous agent practice |
| [Harness Engineering in 2026.3.md](Harness%20Engineering%20in%202026.3.md) | 2026.3 对「Harness Engineering」的观察：从 Vibe Coding 切换到多 Agent 协同的实践 · Notes on the "Harness Engineering" trend and the switch from vibe coding to multi-agent collaboration |
| [human_focus_what.md](human_focus_what.md) | 「人类该聚焦什么」：一次"Arch 验收形同虚设"的教训，提炼人-AI 分工做法 · What humans should focus on: lessons from a hollow architect review, and concrete human–AI division of labor |
| [Lilian_Weng_Self-Improvement.md](Lilian_Weng_Self-Improvement.md) | Lilian Weng 两篇文章（Self-Improvement / Scaling Laws）的大白话总结 · Plain-language summary of Lilian Weng's two posts (Self-Improvement / Scaling Laws) |
| [minmax_slock_team3.md](minmax_slock_team3.md) | MiniMax Agent Team / Slock / Team3 三方多 Agent 方案对比 · Comparing MiniMax Agent Team / Slock / Team3 multi-agent approaches |
| [slock_my_pmf_idea.md](slock_my_pmf_idea.md) | 「面向编程的结构化 Agent 工作系统」产品设计思路（PMF 早期想法） · Product design thinking for a structured agent work system for coding (early PMF ideas) |
| [slock_轮询消耗.md](slock_轮询消耗.md) | 调研 Slock Agent 空闲轮询（每 5s 一次 LLM 请求）的 Token 消耗 · Investigating token burn from idle polling (an LLM request every 5s) in Slock agents |
| [t3_self_improvement.md](t3_self_improvement.md) | team3 作为 harness 系统「自身如何持续变好」的 self-improvement 方案思路 · How team3 itself keeps improving — a self-improvement design sketch |
| [uat_issue_opt.md](uat_issue_opt.md) | UAT 需求总结与 `uat_prompt.md` 优化方案 · UAT requirements summary and `uat_prompt.md` optimization |
| [ui_v0_refactor.md](ui_v0_refactor.md) | v0 ↔ 代码双向流转方案：web UI 低成本的持续迭代机制 · Bidirectional v0 ↔ code flow for low-cost, continuous web UI iteration |
| [基于 Claude Autonomous Coding 的 1+1+1 工作流指南.md](基于%20Claude%20Autonomous%20Coding%20的%201+1+1%20工作流指南.md) | 结合 Claude 官方 autonomous-coding 方案定制「1 人类 + 1 Architect + 1 Dev」工作流 · A 1 Human + 1 Architect + 1 Dev workflow guide based on Claude's official autonomous-coding approach |
