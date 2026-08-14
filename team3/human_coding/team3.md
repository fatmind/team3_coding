# Team3 工作流全局说明

> Architect / Dev / UAT 启动时必须先读取本文件
> 本文件是权威协议定义，与其他文件冲突时以本文件为准

---

## 团队构成

| 角色 | 职责 | 注 |
|---|---|---|
| **人类** | 产品想法、架构设计、规范要求、每日验收反馈 | `spec/app_design.md` 只允许人类维护（或人类明确要求 arch 更新），输入诉求、反馈决策 |
| **Architect** | 需求拆解、任务派发、验收审查（不重复跑测试/审查覆盖度）、状态管理、UAT 触发 | 人类 和 Agent 协作的中枢 |
| **Dev** | 编码、单元测试（依赖全 mock）、集成测试、自验修复、交付 | 不同任务不同 llm session，避免上下文污染 |
| **UAT** | 从用户出发，独立黑盒验证产品（阶段 1 设计用户故事；阶段 2 跑验收。不读 Dev 代码 / feature_list / progress） | 跨 module 串联用户动线，从用户角度独立验证，不允许任何 mock/stub |

---

## 目录结构

```text
user-project/
├── spec/
│   ├── app_design.md                  # 产品架构设计，只允许人类维护
│   ├── module_X.md                    # 模块设计（人类 + Arch 讨论产出）：用户视角功能描述 + 可测试的验收标准 + 技术约束
│   ├── module_X_feature_list.json     # feature 拆解，仅 Arch 可创建/修改
│   ├── module_X_progress.txt          # 进度跟踪，固定四段，Arch 维护、Dev 只追加 Dev Delivery 段
│   ├── uat_stories.md                 # 产品用户故事（UAT，阶段 1）
│   ├── uat_report.md                  # 产品验收报告（UAT，阶段 2）
│   ├── decisions.md                   # 生效的人类决策（Arch + Dev + UAT 都可记），详见补充说明
│   ├── experience.md                  # Agent 经验教训（Arch + Dev + UAT 都可记），详见补充说明
│   ├── actions.jsonl                  # 人和Agent两两沟通（人类 + Arch + Dev + UAT），详见补充说明
│   └── modules_progress.json          # 整体进展总览（pending | in_progress | done），Arch 维护、其他角色只读
├── .team3-project.json                # 项目元数据
├── uat/                               # App 维端到端验收脚本（UAT，阶段 2）
│   └── story_N                        # 一个 story 一个目录
├── init.sh                            # 环境启动脚本（Dev 首次创建）
├── src/                               # 业务源码
├── test/                              # 单元测试
└── e2e/                               # 集成测试，按 feature 隔离（Dev）
    └── feature_X/
```

---

## 核心文件补充说明

### `spec/decisions.md` — 生效的人类决策（唯一权威源）

- 只放**人类拍板过、当前仍生效**的决策；谁收到人类拍板谁当场记（三角色都可写）
- 格式，一条一段：

```markdown
## YYYY-MM-DD | 一句话决策（大白话，≤100 字）
- <像给别人讲述决策逻辑，逻辑自洽；多条分开>
```

- 生效条目 ≤20 条：新决策与旧条目相似 → 合并；决策被推翻 → 删旧条目（rebase 归档留证）
- 与既有条目冲突且自己判不了 → 冲突处标 `//conflict`，通知人类裁决，禁止自行覆盖

### `spec/experience.md` — Agent 经验教训

- 三角色直接按格式追加（写入不走工具），一条：

```markdown
## YYYY-MM-DD | 角色 | 一句话概述（什么时候用 + 能照做的结论）
- 问题: 实际发生了什么
- 原因: 根因
- 应该咋做: 能照做的动作
- ref: 取证（文件路径 / actions.jsonl 编号 / commit）
```

- **入库先分拣**：把项目名、文件名、字段名扒掉后结论仍成立的，才算经验；只有四个固定字段，禁止自由散文
- **读取用 cli 省上下文**：开工 `node cli/experience.mjs list` 查头部索引，需要细节再 `show <序号>`，不全量读
- **触发条件**（任何偏离理想路径的都记，满足任一即写）：
    - 自修复 ≥2 轮（说明 checkpoint/spec 不够清楚，或方向走偏了才发现）
    - UAT 同类失败 ≥2 轮（验证环境有系统问题，或验证集设计有缺陷）
    - 模型做了错误假设（猜格式、猜返回值、没看真实数据就动手）
    - 验收缺乏论据（秒过、没跑测试、没对照 spec）
    - 踩到非显然坑或发现独到调试技巧
    - 发现既有记录需修订或与现状冲突

### `spec/actions.jsonl` - 人和Agent两两沟通

**字段约定**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `action` | ✅ | `to_arch` / `to_dev` / `to_uat` / `dev_do` / `dev_fix` / `to_human` / `uat_design` / `uat_check` / `uat_fix` / `note`（仅落盘、不转发），代表不同含义 |
| `from` | ✅ | 发起方：`arch` / `dev` / `uat` / `human` |
| `to` | ✅ | 接收方 |
| `ts` | ✅ | unix 秒级时间戳 |
| `message` | ✅ | **发送给对方的消息**（人类可读） |

```jsonl
{"action":"dev_do","from":"arch","to":"dev","ts":1779067112,"message":"请实现 Feature #6 #7"}
{"action":"uat_check","from":"arch","to":"uat","ts":1779067700,"message":"stories 已确认，开始全量验收"}
```

>**action 分类说明：**
> - `to_human`：Agent 发给人类
> - `to_arch` / `to_dev` / `to_uat`：发给对应 Agent 的消息——内容混合（提问/交付/反馈/补充信息），接收方自己判断怎么处理，daemon 复用当前 session。其中 `to_dev` / `to_uat` **仅人类可发**（write-action 强制校验）
> - `dev_do` / `dev_fix` / `uat_design` / `uat_check` / `uat_fix`：明确任务。`dev_do` / `uat_design` / `uat_check` 是新任务，daemon 新建对应 Agent session；`dev_fix` / `uat_fix` 是当前任务修复/重验，daemon 复用当前 session

---

## 公共协议

### 发出消息

1. Agent 间消息保持简洁、大白话、先结论后逻辑（保持逻辑分步、严谨），详情通过文件传递（如「请实现 module_X Feature #N，详见 spec/module_X.md」），不要在 message 里重复文件中已有的完整描述。**Agent 间消息少于 350 字**
2. 若本轮修改了 `spec/*` 任一文件（除 `actions.jsonl` 和 `agents/*` 外）→ message 末尾加 `[reread: <逗号分隔的文件清单>]`，如 `[reread: spec/foo.md, spec/bar.md]`——一切交接基于本地文件，文件变了对方必须重读
3. **同步**通过 `node cli/write-action.mjs spec/actions.jsonl --action <type> --from <你的角色> --to <target> --message "<内容>"` 写入，禁止 echo / printf / python 直接写、禁止绕过工具直写文件

#### to_human 特殊要求

- 保持简洁、大白话、先结论后逻辑（保持逻辑分步、严谨），长度少于 350 字
- 对 `to_human` 消息会用独立 LLM 判卷 —— 未过则本条不写入、exit 1 并在 stderr 列出未过项，按未过项改 message 后重新调用
- 三类消息各有固定开头，不得混用：要人决策 `【老板你定】`；要人给输入（信息/资料/权限/review）`【求你补充】`；纯通知 `【随带说下】`
- 不给选项让人选 —— 只给一个最优建议，人类要么回「同意」要么大白话反驳
- 需人类决策的消息固定格式：

  ```
  **老板你定**
  <大白话一句，带上"不这么做会怎样">
  **思考逻辑**
  1~3 条，每条一行
  **自查约束**
  ①~⑧ 过
  ```

- 可逆小事不问：直接干，之后在交付消息里报备一句
- **发出前自查 ①~⑧**（judge 按同一标准复核，拍板消息全查；【求你补充】查①③④⑥⑦⑧，①改判"这东西自己真拿不到吗"；【随带说下】查⑤⑥⑦⑧）：
  - ① 值得问：不问直接干，人类事后会发火/返工吗？不会 → 别问，干完报备
  - ② 敢质疑：同一问题修复多轮 / 前提被人类否定过 → 该拍的板是"方向还继不继续"，不是请批下一个补丁
  - ③ 一次一个决策点：多个问题先问最上层那一个，拍完再往下拆
  - ④ 分析做完：出现"或者/都可以/看你/方案A方案B" = 把选择推回人类，不合格
  - ⑤ 不套模板：每条理由必须从"当前阶段要什么"推出；通用最佳实践/上线级机制塞进早期阶段即不合格
  - ⑥ 新人能懂：不了解项目的新人能复述"要决定什么、不这么做会怎样"
  - ⑦ 无细节稀释：删掉这句人类也不会判断错的都删；文件名/函数名/字段名/代码/表格默认全是细节
  - ⑧ 排版分行：超过两句话必须按要点分行，不许挤成一整段


### 收到消息

先检查 message 末尾是否有 `[reread: <files>]`，有 → **必须先按列表重读对应文件**，再处理任务（不重读直接开干 = 协议违规）


### 文件写入

Edit / Write 覆盖已有文件前，必须先在本轮用 Read 工具读过该文件（Bash 的 cat/grep 不算，工具层只认 Read）；需要改多个文件时，先一次性 Read 所有目标文件，再发 Edit