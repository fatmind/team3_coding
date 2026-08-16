# team3 — AI Agent 驱动的软件开发工作流

> 1+1+1+1 人机协作：**Human + Architect + Dev + UAT** 四个角色，围绕「app → module → feature → uat」流水线持续协作开发产品。

team3 是一套让「人类 + 多个 AI Agent」像一支真实团队一样协作开发产品的系统。人类只负责定方向、拍决策；Architect 负责需求拆解、任务派发与验收审查；Dev 负责编码与自测；UAT 从用户视角做独立的黑盒验收。所有角色通过 `spec/actions.jsonl` 两两通信，由 daemon 统一调度各 Agent session。

## 解决什么问题

用 AI coding 工具（Claude Code / Cursor / Codex 等）做「商业化」产品开发时的三个痛点：

- **人成了调度器** —— 多个 session 靠人脑协调上下文、复制需求；team3 由系统承担 Agent 间的上下文协调与消息传递
- **验收靠人肉** —— 没有 checkpoint / UAT，人类逐个功能手测跟不上 AI 生产速度；team3 把 checkpoint 与黑盒验收内置进流程
- **没法持续协作** —— 一次性、单 feature 的编码，无法像人和人协作一样长期配合；team3 支持跨 feature、跨 module 长期迭代

## 核心概念

| 角色 | 职责 |
|---|---|
| **人类** | 产品想法、架构设计、规范要求、每日验收反馈（`spec/app_design.md` 只允许人类维护） |
| **Architect** | 需求拆解、任务派发、验收审查、状态管理、UAT 触发（不写业务代码） |
| **Dev** | 编码、单元/集成测试、自验修复、交付（不同任务用不同 session，避免上下文污染） |
| **UAT** | 从用户出发，独立黑盒验证产品，不读 Dev 代码，禁止任何 mock/stub |

## 特性

- **四角色协议**：角色边界清晰，人类决策有唯一权威源（`spec/decisions.md`），经验教训沉淀为 `spec/experience.md`
- **daemon 调度器**：action 监听、session 队列/调度、消息路由、rebase、状态持久化、看门狗
- **CLI 工具链**：`init` / `write-action` / `experience` / `simulate_human` / `validate-uat-evidence` 等
- **Web 控制台**：Next.js 面板，实时查看进度、收发消息
- **评估体系**：`loop/` 提供 eval / regression / badcase 工具，持续评估 Agent 表现
- **打包发布**：`build/build.sh` 产出可全局安装的 tgz 包，`team3 start` 一键启动

## 目录结构

```text
team3_coding/
├── README.md
├── LICENSE
├── draft/                # 早期想法与讨论笔记（过程文档）
└── team3/
    ├── bin/              # team3 CLI 入口
    ├── build/            # 打包脚本
    ├── cli/              # 工具链（init / write-action / experience ...）
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
- `draft/` — 早期想法与讨论笔记（过程文档，见 [draft/README.md](draft/README.md)）

## License

[MIT](LICENSE)
