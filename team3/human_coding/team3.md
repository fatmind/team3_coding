# Team3 工作流全局说明

> Architect / Dev / UAT 启动时必须先读取本文件
> 本文件描述 canonical 协议

---

## 团队构成

| 角色 | 职责 | 注 |
|---|---|---|
| **人类** | 产品想法、架构设计、规范要求、每日验收反馈 | `spec/app_design.md` 只允许人类维护，输入诉求、反馈决策 |
| **Architect** | 需求拆解、任务派发、验收审查（不重复跑测试，审查覆盖度）、状态管理、UAT 触发 | 人类 和 Agent 协作的中枢 |
| **Dev** | 编码、单元测试（依赖全 mock）、集成测试、自验修复、交付 | 不同任务不同 claude session，避免上下文污染 |
| **UAT** | 从用户出发，独立黑盒验证产品（阶段 1 设计用户故事；阶段 2 跑验收。不读 Dev 代码 / feature_list / progress） | 跨 module 串联用户动线，从用户角度独立验证，不允许任何 mock/stub |

---

## 目录结构

```text
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

---

## 核心文件说明

### 临时文件规则
- e2e / UAT 执行过程中产生的临时文件、截图、运行日志、调试输出，写到 `/tmp/<project>/`
- 项目目录只放长期交付物：源码、测试脚本、spec 文档、最终报告，不要把临时输出散落到项目目录

### `spec/module_X.md` — 模块设计
人类和 Architect 讨论产出，包含：
- 功能描述（从用户视角）
- 验收标准（必须明确、可测试）
- 技术约束（如有）

### `spec/module_X_feature_list.json` — 功能清单
```json
[
  {
    "id": 1,
    "description": "...",
    "checkpoint": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
    "passes": false,
    "depends_on": []
  }
]
```
- `description` 和 `checkpoint` 一旦创建**不可修改**，只能改 `passes` 字段
- 只有 Architect 有权修改
- 验收通过 <"passes": true> 后，若未来需要回滚/修改时，需新增 feature

### `spec/module_X_progress.txt` — 进度跟踪
```
## Current Feature
feature_id: 5
status: in_progress | done | rejected

## Dev Delivery
（Dev 在这里追加交付总结，包括如下内容）
  - 实现了什么功能
  - 修改/新建了哪些文件
  - 集成测试脚本（`e2e/feature_X/test1_xxx.js`...）
  - 发现并修复的问题（如有）

## Architect Notes
（Architect 在这里记录验收结果、退回原因等）

## History
- [日期] Dispatched feature #1 to Dev
- [日期] Feature #1 accepted, committed as abc1234
```

### `spec/modules_progress.json` — 整体进展总览

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

### `spec/decision_log.md` — 经验沉淀
- 满足触发条件才写，写入前合并同主题、冲突标 `//conflict` 不自行裁决，且通知人类去判断
- Arch、Dev、UAT 三个角色都可以独立写入
- **触发条件**（任何偏离理想路径的都记，满足任一即写）：
    - 人类做出决策（方向、取舍、打回）
    - 自修复 ≥2 轮（说明 checkpoint/spec 不够清楚，或方向走偏了才发现）
    - UAT 同类失败 ≥2 轮（验证环境有系统问题，或验证集设计有缺陷）
    - 模型做了错误假设（猜格式、猜返回值、没看真实数据就动手）
    - 验收缺乏论据（秒过、没跑测试、没对照 spec）
    - 踩到非显然坑或发现独到调试技巧
    - 发现既有记录需修订或与现状冲突
- decision_log.md 格式要求
```markdown
## YYYY-MM-DD HH:mm:ss | 记录者 | 类型（人类决策/经验教训）
**背景**
...描述...
ref: module_X feature_N | commit abc1234 / 文件路径 / session id
**结论**
```
- `ref` 行写在**背景**末尾：标明所属 module/feature + 可追溯的 commit、文件路径或 session id（有就写，没有可省略）

### `spec/actions.jsonl` - 人和Agent两两沟通

**字段约定**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `action` | ✅ | `to_arch` / `dev_do` / `dev_fix` / `to_human` / `uat_design` / `uat_check` / `uat_fix`，代表不同含义 |
| `from` | ✅ | 发起方：`arch` / `dev` / `uat` / `human` |
| `to` | ✅ | 接收方 |
| `ts` | ✅ | unix 秒级时间戳 |
| `message` | ✅ | **发送给对方的消息**（人类可读） |

```jsonl
{"action":"dev_do","from":"arch","to":"dev","ts":1779067112,"message":"请实现 Feature #6 #7"}
{"action":"to_arch","from":"dev","to":"arch","ts":1779067512,"message":"Feature #6 #7 已交付，checkpoint 全部通过，等待验收"}
{"action":"dev_fix","from":"arch","to":"dev","ts":1779067512,"message":"Feature #6 验收不通过，请修复 xxx"}
{"action":"to_human","from":"arch","to":"human","ts":1779067700,"message":"module 1 xxx，Feature #6 #7 通过"}
{"action":"uat_design","from":"human","to":"uat","ts":1779067700,"message":"所有 module 设计完成，请基于 app_design.md 和所有 module_X.md 设计 产品用户故事 stories"}
{"action":"uat_check","from":"arch","to":"uat","ts":1779067700,"message":"请验收 Story 1 [uat-story: 1]"}
{"action":"uat_fix","from":"arch","to":"uat","ts":1779067800,"message":"Story 1 的产品问题已修复，请重验 [uat-story: 1]"}
```

>**action 分类说明：**
> - 混合任务执行：to_arch / to_human
> - 单一任务执行：dev_do / dev_fix / uat_design / uat_check / uat_fix
> - `dev_do` / `uat_design` / `uat_check` 是新任务，daemon 新建对应 Agent session；`dev_fix` / `uat_fix` 是当前任务修复/重验，daemon 复用当前 session

**message 末尾 reread 协议**：
- **触发**：除 actions.jsonl 和 agents/ 之外，修改 spec/* 任一文件
- **格式**：`[reread: spec/foo.md, spec/bar.md]`，追加在 message 末尾
- **用途**：人类、Arch、Dev、Uat，一切交接基于本地文件，当文件变化时需重读

**写入方式**：Agent 写 actions.jsonl 必须通过 `node cli/write-action.mjs` 工具，禁止 echo / printf / python 直接写。工具自动校验字段、生成时间戳、保证单行 JSON。