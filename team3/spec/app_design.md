# Team3 Coding — 产品架构设计

## 一句话

人 和 AI 高效 coding 协作：人类定方向和思路，和多个 Agent 一起协作，按 app → module → feature → uat 的流水线推进。

## 解决什么问题

当前用 AI coding 工具（Claude Code / Cursor / Codex），去做 "商业化" 产品开发的痛点：

1. **人成了调度器**：多个 session 之间靠人脑协调上下文、切换窗口、复制需求，Boris 模式只有极少数人能做好
2. **验收靠人肉**：没有 checkpoint、uat，人类自己逐个功能验，AI 生产速度太快、根本做不到
3. **没法持续协作**：是一次性、单 feature，完成 coding 开发，没法像人和人的协作一样，持续配合、越来越顺

## 目标用户

会写代码、产品型开发者，需要一个系统帮他们，和 AI 高效协作

## 产品动线

```
======== 人类重度投入（初始阶段）========

项目初始化完成，启动 agent
    ↓
人类在 Web 输入产品想法，或编辑文件
    ↓
人类 + Arch 对话 → 结论写入 spec/app_design.md
    ↓
人类 + Arch 拆 module → 每个写入 spec/module_X.md
    ↓
人类 确认：发两条消息 "module 设计完毕 @Arch" 、"开始 uat_design @Uat" 

======== 多个 Agent 自主并行推进 ========

=== UAT 阶段 1：设计用户故事（并行 1） ===

Daemon 转发给 Uat
  ↓
UAT 读 app_design.md + 所有 module_X.md → 写 spec/uat_stories.md（按用户故事验证产品功能）
  ↓
人类 review stories，和 UAT 对话修改
  ↓
人类 确认 uat_stories，等待开发完成

=== Arch 和 Dev 开发（并行 2） ===

Daemon 转发给 Arch
    ↓
Arch 创建 modules_progress.json
    ↓
Arch 开始一轮工作 → 拆解 module_x feature，写 feature_list.json + progress.txt
                  → dev_do: 请实现 Feature #N ...
    ↓
Daemon 转发给 Dev
    ↓
Dev 开发代码 + 自测 → 写 progress.txt
                → to_arch: Feature #N 已交付 ...
    ↓
Daemon 转发给 Arch
    ↓
Arch 验收 → 更新 feature_list.json + 更新 progress.txt + 更新 modules_progress.json + git commit
          → dev_do: 验收通过，请实现下一个 ...
          → to_human: 验收通过 Feature #N，开始下一个 ...
    ↓
module 所有 feature 完成 → Arch 写: "to_arch: module_x 已开发完，请开始下一个 module feature 拆解"
    ↓
Arch 开始下一轮工作 → 拆解 module_x feature，写 feature_list.json + progress.txt
                  → dev_do: 请实现 Feature #N ...
...
    ↓
所有 module 完成 -> Arch 写: "uat_check: 所有 module 已开发完和验收，请开始用户故事的验证"

=== UAT 阶段 2：验证用户故事 ===

Daemon 转发给 Uat
  ↓
UAT 读 spec/uat_stories.md（注：黑盒验证，不读 Dev 代码 / feature_list / progress） 
  ↓
UAT 在 uat/ 下写 story 验证脚本（跨 module 串联用户故事，从用户角度独立验证）
  ↓
UAT 全自动执行
  ↓
全部通过 → to_human : 产品 UAT 验收通过 + spec/uat_report.md
失败 → 先自查、找 arch 解决 → 3 轮没搞定，再 to_human 通知人类

======== 人类轻度投入（验收阶段）========

人类在 Web 群聊收到 UAT 完成通知，查看 spec/uat_report.md
    ├── OK → 项目完成
    └── 不 OK → 在群聊补充人类决策，@Arch 解决 UAT 失败问题 → Arch 走 MODE C 处理
```

## 架构思路：纯本地三件套

**这是一个用户本地部署产品**——web、daemon、claude code 一起安装在用户的电脑上，访问用户本地文件系统。**没有远端服务器**。这一点决定了所有架构选型。

```
┌───────────────────────────────────────────────────────┐
│                  用户开发机（macOS / Linux）             │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │   Web (Next.js)                                  │   │
│  │   - 人类操作界面                          │   │
│  │   - 直接读写本地 fs    │   │
│  └────────▲─────────────────────────▲────────────────┘   │
│           │ ws / api                │ 读写本地文件        │
│  ┌────────▼─────────────┐    ┌──────▼─────────────────┐  │
│  │  Daemon (Node 常驻)   │    │   本地文件系统          │  │
│  │ - 人/Agent两两间沟通桥梁     │   project_dir/        │  │
│  │ - 操作 claude code      │  └─────────────────────────┘  │
│  └────────┬─────────────┘             ▲                   │
│           │ stdin / stdout            │ 读写本地文件        │
│  ┌────────▼───────────────────────────▼─────────────┐    │
│  │   Claude Code（1 个 agent 1 个 session）       │    │
│  │   Arch 实例 / Dev 实例 / UAT 实例                  │    │
│  └──────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

### 设计哲学

- 人类 和 Agent 是一样的，只是发挥各自优势、完成不同阶段任务
- 长时间持续配合、积累经验与默契，要求 Agent 每次执行任务时，在最后自我总结、更新
- web 是人类参与进来的一种通道形式，如：群聊讨论、编辑文件等，未来还可以是 钉钉/discard 等
- 文件系统，对人和Agent没区别，都可以读写，**人类、Arch、Dev、Uat的一切交接基于文件，通过 Git 可追溯、可回滚**
- 人 和 Agent、Agent 和 Agent 之间沟通，消息持久化写入文件、在群聊展示，消息通过 daemon 转发，人类消息走实时 ws，Agent 消息写文件监测变化
- .team3-project.json 定义项目元信息，partner 是 "人类和Agent" 伙伴列表
- 所有 module 在拆分 feature 时，严格要求每个 feature 可以自验证、自修复
- uat 是跨 module、App-wide 的，按用户故事、独立去验证整体产品，必须和用户使用产品一样去操作，不允许任何 mock/stub 等
- web 只有一个实例，是用户开发项目入口，在 web 创建项目，每个项目 1:1 Deamon 1:3 Agent（arch/dev/uat）

### 原则 1：文件交接 + Git 可追溯

**人类、Arch、Dev、Uat，一切交接基于本地文件，通过 Git 确保可追溯、可回滚。**

- 人类和 Arch 的讨论结论 → 写入 `spec/app_design.md`、`spec/module_x_*.md`
- Arch 的任务拆解 → 写入 `spec/*_feature_list.json`
- Dev 的交付报告 → 写入 `spec/*_progress.txt`
- UAT 设计产品故事（阶段 1）→ 写入 `spec/uat_stories.md`
- UAT 验证用户故事（阶段 2）→ 写入 `spec/uat_report.md`
- 人类决策和 Agent 经验 → 写入 `spec/decision_log.md`
- 人和Agent两两沟通 → 写入 `spec/actions.jsonl`

文件是 Source of Truth，**且不引入数据库**。

### 实体概念

```
App（产品）
  ├── Module（模块）       <- 人类 + Arch 讨论定义
  │     └── Feature（功能） <- Arch 拆解，Dev 实现
  │           ├── Checkpoint（验证标准）<- 必须可追溯回所属 module 的【验收场景】表
  │           └── e2e（feature 维集成测试）<- Dev 写
  └── Uat Story（用户故事）<- UAT 阶段 1 设计、人类 review、UAT 阶段 2 自动化跑通，产品视角
```

## 项目工作目录结构

被管理的目标项目，遵循以下目录约定：

```
user-project/
├── spec/
│   ├── app_design.md                  # 产品架构设计（人类）
│   ├── module_X.md                    # 模块设计 + 【验收场景】（人类 + Arch）
│   ├── module_X_feature_list.json     # feature 拆解（Arch）
│   ├── module_X_progress.txt          # 开发进度跟踪（Arch + Dev）
│   ├── uat_stories.md                 # 产品用户故事（UAT，阶段 1）
│   ├── uat_report.md                  # 产品验收报告（UAT，阶段 2）
│   ├── decision_log.md                # 人类决策和 Agent 经验（Arch + Dev）
│   ├── actions.jsonl                  # 人和Agent两两沟通（人类 + Arch + Dev + UAT）
│   └── modules_progress.json          # 整体开发进展（Arch）
├── .team3-project.json                # 项目元数据
├── .claude/                           # 本地 claude 配置
├── uat/                               # App 维端到端验收脚本（UAT，阶段 2）
│   └── story_N                        # 一个 story 一个目录
├── init.sh                            # 环境启动脚本（Dev 首次创建）
├── src/                               # 业务源码
├── test/                              # 单元测试
└── e2e/                               # 集成测试，按 feature 隔离（Dev）
    └── feature_X/
```

## 模块拆分

```
Module 1: Web UI 交互
  人类交互界面：对话、编辑 spec、看板、验收 等

Module 2: Web 项目初始化（项目目录结构、Daemon、Agent）
  定义 Arch、Dev、UAT 的 prompt 模板（含 team3.md 全局说明）
  初始化项目本地目录结构
  初始化启动 Daemon 和 各 Agent

Module 3: Daemon
  与 Web 互通、与 Claude Code 互通
  调度 Agent
  消息转发
  claude code 执行 log 记录
```

**模块依赖**：Module 3 是基础，Module 1 和 Module 2 都依赖它
注：team3 工具自身当前代码放在 `team3/web` 与 `team3/daemon`，这是工具实现目录，不是被管理项目的目录模型。

## 关键技术思路

### 如何判断 Agent 一次任务执行成功

claude -p 是非交互模式，任务完成后进程自动退出，"exit code 0 = 成功完成"，--output-format stream-json 可结构化获取输出结果，官方 cli 文档 https://code.claude.com/docs/en/cli-reference

```
claude -p "query weather ..." --resume "b9f7e67b-6fa2-47ed-91d3-3d9b4c9b8ea3" --output-format stream-json
# 注：sessionId 必须是合法 uuid，claude code `--session-id` / `--resume` 不接受其它形式
```

### actions.jsonl 消息定义

**字段约定**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `action` | ✅ | `to_arch` / `dev_do` / `dev_fix` / `to_human` / `uat_design` / `uat_check` / `uat_fix` / `note`，代表不同含义 |
| `from` | ✅ | 发起方：`arch` / `dev` / `uat` / `human` |
| `to` | ✅ | 接收方（`note` 时可为空串） |
| `ts` | ✅ | unix 秒级时间戳 |
| `message` | ✅ | **发送给对方的消息**（人类可读，在 timeline 直接展示） |

```jsonl
{"action":"uat_design","from":"human","to":"uat","ts":1779067700,"message":"所有 module 设计完成，请开始 uat_design"}
{"action":"dev_do","from":"arch","to":"dev","ts":1779067112,"message":"请实现 Feature #6 #7"}
{"action":"to_arch","from":"dev","to":"arch","ts":1779067512,"message":"Feature #6 #7 已交付，checkpoint 全部通过，等待验收"}
{"action":"dev_fix","from":"arch","to":"dev","ts":1779067512,"message":"Feature #6 验收不通过，请修复 xxx"}
{"action":"to_human","from":"arch","to":"human","ts":1779067700,"message":"module 1 xxx，Feature #6 #7 通过"}
{"action":"uat_check","from":"arch","to":"uat","ts":1779067700,"message":"module 1 已完成，请你开始 uat 验证"}
{"action":"uat_fix","from":"arch","to":"uat","ts":1779067800,"message":"UAT Story #2 的产品问题已修复，请重验 [uat-story: 2]"}
{"action":"note","from":"arch","to":"","ts":1779067900,"message":"note ..."}
```

>**action 分类说明：**
> - 混合任务执行：to_arch / to_human —— human/arch 是系统中枢角色，用通用 to_xx 表达
> - 单一任务执行：dev_do / dev_fix / uat_design / uat_check / uat_fix —— daemon 据此调度 session，任务明确
> - `dev_do` / `uat_design` / `uat_check` 表示新任务，daemon 新建对应 Agent session；`dev_fix` / `uat_fix` 表示当前任务修复或重验，daemon 复用当前 session
> - 如果 `--resume` 失败且提示 session 不存在，daemon 替换当前无效 `runing`，生成新 session id，并用同一条消息以 `--session-id` 重试
> - note：daemon 记录信息、通知人类，保留作为未来扩展

**message 末尾 reread 协议**：
- **触发**：除 actions.jsonl 和 agents/ 之外，修改 spec/* 任一文件
- **格式**：`[reread: spec/foo.md, spec/bar.md]`，追加在 message 末尾
- **用途**：人类、Arch、Dev、Uat，一切交接基于本地文件，当文件变化时需重读

### `modules_progress.json` —— module 间关系数据

**位置**：`spec/modules_progress.json`

1. 创建：由 Arch 创建，当和人类讨论完 module 拆分后写入
2. 更新：由 Arch 更新，当 Arch 每次验收 feature，仅 "通过后" 更新

**结构**：

```json
{
  "modules": [
    {
      "id": "module_1",
      "name": "日程前端交互",
      "status": "in_progress",
      "features": [
        { "id": 1, "description": "事件 CRUD", "status": "done" },
        { "id": 2, "description": "重复事件规则", "status": "pending" }
      ]
    },
    {
      "id": "module_2",
      "name": "日程后端服务",
      "status": "pending",
    }
  ],
  "dependencies": [
    { "from": "module_2", "to": "module_1" }
  ]
}
```

### .team3-project.json 项目元数据定义

```json
{
  "name": "<项目名，仅支持英文>",
  "createdTime": "<创建时间，yyyy-MM-dd>",
  "workspace": "<绝对路径>",
  "init_workspace": "<初始化目录结构是否成功>",
  "init_daemon": "<daemon 进程 PID>",
  "daemon_heart": "<最近一次更新时间>",
  "partner" { //人类 和 Agent 是等同的，一起合作伙伴
    "human": {
        "name":"石建",
        "avtar":"<图像>"
    },
    "arch_agent": {
        "name":"张三丰",
        "avtar":"<图像>",
        "session":{
            "runing":"<当前 sessionId>",
            "done":["", ""] // 历史 session
        }
    },
    "uat_agent": {
        "name":"白帽",
        "avtar":"<图像>",
        "session":{
            "runing":"<当前 sessionId>",
            "done":["", ""] // 历史 session
        }
    },
    "dev_agent": {
        "name":"多隆",
        "avtar":"<图像>",
        "session":{
            "runing":"<当前 sessionId>",
            "done":["", ""] // 历史已完成 session
        }
    }
  }
}
```


## 技术栈

| 层 | 技术 | 备注 |
|----|------|------|
| **Web**（一个 Next.js 工程） | Next.js (App Router) | / |
| 本地常驻进程 | Node.js Daemon | / |
| Agent 执行 | claude code | claude -p 和 --resume 配合 |
| 浏览器验证 | Puppeteer | UAT 跑在本地 |
| 数据存储 | Git 本地文件 | / |
| CI/CD | 本地脚本 | npm test / pytest，未来 GitHub Actions |
