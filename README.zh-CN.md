# team3 — 人类和 Agent 一起构建的地方

大多数 AI 编程工具把 Agent 当作自动售货机。输入 prompt，吐出代码，结束。

我们的看法不同。

Agent 不是一个按次租用的工具，而是一个有记忆、有角色、有自己的座位的队友——它日复一日地回来，接着上次的进度，随着项目成长而变得更好。

**team3** 是一套把「你 + 你的 coding Agent」变成一支真实团队的工作流：**1 人类 + 1 Architect + 1 Dev + 1 UAT**，四个角色，一件事——把产品从 **app → module → feature → uat**，持续地做下去。

[English](README.md) | **简体中文**

---

## 为什么做它

如果你用 AI Agent 交付过产品，大概体会过这些：

- **你成了调度器。** 三个 session 同时开着，上下文靠手从一个窗口复制到另一个，需求每天早上重贴一遍。Agent 很努力——你更努力，努力让它们彼此同步。
- **你成了测试员。** 没有 checkpoint，没有 UAT。只有你一个人，对着功能手点，想赶在 AI 生产出来之前验完。你验不完。
- **而且从不复利。** 每个任务都从零开始。没人记得上周的决策。就像和一群聪明、但一觉醒来就忘了你的陌生人共事。

team3 解决的正是这些——不是靠换一个更强的模型，而是给这支团队一块共享记忆，和一套比任何单次 session 都长寿的工作流。

## 它是怎么工作的

产品像一支真实团队那样被做出来：

1. **人类拍板。** 想法、方向、判断——都来自你。没人能覆盖你。`spec/app_design.md` 只归你维护。
2. **Architect 规划。** 它把你的想法拆成 module 和 feature，派发任务，审查回来的成果，并决定什么时候可以进入验收。
3. **Dev 建造。** 每个任务都有自己的全新 session——上下文干净、带单元测试、自验后交付，不跨 session 污染。
4. **UAT 裁判。** 从用户视角，黑盒验收。不读 Dev 的代码，不用 mock，不讲情面。用户觉得不对，就打回去。

它们通过 `spec/actions.jsonl` 交流——一个你随时在线的共享信箱。daemon 负责让每个 session 活着、排着队、并知道项目进行到哪了。

结果就是：Agent 不再是工具，而是记得事的队友——而且，你们一起工作得越久，这支团队就越好。

## 你得到什么

- **一支团队，四个角色** —— 边界清晰，决策收在唯一权威文件里（`spec/decisions.md`），每一条血泪教训都沉淀进 `spec/experience.md`，没有人重复踩坑。
- **一个会看孩子的 daemon** —— 监听 action、排 session、路由消息、rebase、持久化状态，还盯着谁挂了（真的，它有 watchdog）。
- **一套全能的 CLI** —— `init`、`write-action`、`experience`、`simulate_human`、`validate-uat-evidence`……
- **一个 Web 控制台** —— 实时看进度、和团队说话。
- **一套评估循环** —— `loop/` 跑 eval、regression、badcase，你能亲眼看着团队一点点变好。
- **像真产品一样交付** —— `build/build.sh` 产出可全局安装的包；`team3 start`，上线。

## 目录结构

```text
team3_coding/
├── README.md
├── LICENSE
├── draft/                # 早期想法与讨论笔记
└── team3/
    ├── bin/              # team3 CLI 入口
    ├── build/            # 打包脚本
    ├── cli/              # 工具链（init / write-action / experience …）
    ├── daemon/           # Agent 调度器
    ├── human_coding/     # Architect / Dev / UAT 角色 prompt
    ├── loop/             # 评估体系（eval / regression / badcase）
    ├── spec/             # 设计文档与协议定义
    └── web/              # Next.js Web 控制台
```

## 快速开始

```bash
# 打包并全局安装
cd team3
bash build/build.sh
npm install -g ./pkg/team3-*.tgz

# 启动
team3 start -p 9001
# 打开 http://localhost:9001
```

开发模式（源码 dogfood）：

```bash
cd team3
node build/embed-prompts.js        # 改 prompt 后必须重跑
cd web
TEAM3_SUPERMAN=1 PORT=9001 npm run dev
```

## 文档

- `team3/spec/` — 设计文档与协议定义（`app_design.md`、`packaging_design.md`、`usage.md` 等）
- `team3/human_coding/` — 三角色 prompt 与工作流说明（`team3.md` 为权威协议）
- `draft/` — 早期想法与讨论笔记（见 [draft/README.md](draft/README.md)）

## License

[MIT](LICENSE)
