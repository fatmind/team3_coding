# 产品用户故事

## Story 1: 新项目启动与首次 AI 协作

### 故事概述：
我是一名产品型开发者，第一次使用 Team3 Coding，我想要创建一个新项目、让系统自动完成初始化，并与 Architect Agent 成功建立对话，确认人机协作链路畅通。

### 用户动线和验收标准

#### 场景1 创建项目并初始化目录结构
**1、步骤**
用户在 Web UI 输入项目名称（英文），点击"创建项目"按钮。

**2、验证**
- 页面跳转到 Page 1（主工作台），左侧群聊区和右侧文档展示区正常渲染，无报错
- 本地文件系统创建完整骨架：`spec/`、`cli/`、`uat/`、`logs/` 目录存在；`.team3-project.json` 文件存在且 `init_workspace` 字段标记为成功

#### 场景2 Daemon 启动与 Arch Agent 上线
**1、步骤**
系统自动启动 Daemon 进程、调用 init_agent 初始化 Arch 和 UAT Agent。

**2、验证**
- 群聊区出现 Arch 的第一条消息（角色头像和名称渲染正确），内容为类似"我已在线，我们开始讨论吧"
- `.team3-project.json` 中 `init_daemon` 写入进程 PID，`daemon_heart` 有时间戳；`partner.arch_agent.session.runing` 为合法 UUID
- `spec/actions.jsonl` 中有一行 from=arch、action=to_human 的记录

#### 场景3 用户发送第一条消息给 Arch
**1、步骤**
用户在群聊输入框输入"我想做一个本地日程管理工具"，确认发送目标为 Arch（默认），点击发送。

**2、验证**
- 输入框清空，群聊区立即显示用户自己发的消息（human 角色样式）
- `spec/actions.jsonl` 新增一行：`action=to_arch, from=human, to=arch`，message 内容匹配

#### 场景4 Arch 回复并展示在群聊
**1、步骤**
等待 Arch 处理后回复（Daemon 检测 actions.jsonl 新行 → 投递 Arch 队列 → spawn claude → Arch 写回 actions.jsonl → Daemon ws 推给 web）。

**2、验证**
- 群聊区增量出现 Arch 的回复消息（Arch 角色样式），内容为关于日程管理工具的讨论回应
- `spec/actions.jsonl` 新增 Arch 回复行（from=arch, to=human）
- Arch 的 agent 执行日志文件（`logs/` 目录下）记录本次调用

#### 场景5 文档区浏览与编辑
**1、步骤**
用户在右侧文档展示区查看默认展示的 `spec/app_design.md`（preview 模式）。然后切换到 edit 模式修改内容并保存。

**2、验证**
- 右侧以 markdown 渲染 app_design.md 内容；左侧文件树展示 spec/ 下所有文件
- 切 edit 后可编辑，保存成功后自动切回 preview 显示新内容
- 本地 `spec/app_design.md` 文件内容与编辑后一致

#### 场景6 WebSocket 断线重连
**1、步骤**
模拟 Web 页面关闭后重新打开（或网络中断恢复），WebSocket 自动重连。

**2、验证**
- 重新打开后群聊区正常显示历史消息（从 actions.jsonl 重新加载），无消息丢失
- 后续 Agent 的新消息仍能实时推送到群聊区

---

## Story 2: 产品设计定稿到多 Agent 自主并行

### 故事概述：
我是一名已经和 Arch 讨论了产品想法的开发者，产品设计基本确定，我想要完成 module 拆分、让系统进入自主开发阶段（Arch 拆 feature + 派发 Dev），同时 UAT 并行设计用户故事。

### 用户动线和验收标准

#### 场景1 与 Arch 完成 module 拆分
**1、步骤**
用户在群聊中告诉 Arch "我们拆分为 3 个 module：Web UI、项目初始化、Daemon"，Arch 处理后创建 module spec 文件和 modules_progress.json。

**2、验证**
- 群聊区出现 Arch 确认拆分方案的回复消息
- 右侧文档区通过 mtime 重载（切换回来或焦点触发）可以看到新文件：`module_1.md`、`module_2.md`、`module_3.md`
- `spec/modules_progress.json` 被创建，包含 3 个 module 条目（status 均为 pending），依赖关系正确
- `spec/actions.jsonl` 中 Arch 回复消息末尾带 `[reread: ...]` 后缀

#### 场景2 用户确认设计并触发双线并行
**1、步骤**
用户发送两条消息：1）"module 设计完毕，开始开发" 发给 Arch；2）切换发送目标为 UAT，发送"开始 uat_design"。

**2、验证**
- 群聊区依次显示两条用户消息（human 角色）
- `spec/actions.jsonl` 写入两行：第一条 action=to_arch，第二条 action=uat_design, to=uat
- 随后 Arch 和 UAT 各自开始响应（两者不互相等待，先完成的先出现在群聊）

#### 场景3 Arch 自主拆解 feature 并派发 Dev
**1、步骤**
Arch 收到消息后，读取 module_1.md，拆解 feature 列表，派发第一个任务给 Dev。

**2、验证**
- 群聊区出现 Arch 消息：告知拆解结果和派发情况（如"module_1 拆解 N 个 feature，已派发 Feature #1 给 Dev"）
- `spec/module_1_feature_list.json` 被创建，包含 feature 数组（每项有 id/description/checkpoint/passes 字段）
- `spec/module_1_progress.txt` 被创建
- `spec/actions.jsonl` 新增 action=dev_do, from=arch, to=dev 的行
- `.team3-project.json` 中 `dev_agent.session.runing` 更新为新的合法 UUID

#### 场景4 UAT 并行设计用户故事
**1、步骤**
UAT 收到 uat_design 消息后，设计用户故事并写入 uat_stories.md，通知人类 review。

**2、验证**
- 群聊区出现 UAT 消息：通知人类 stories 设计完成
- `spec/uat_stories.md` 被创建，内容包含多个 Story，格式正确
- UAT 在 actions.jsonl 中的消息末尾带 `[reread: spec/uat_stories.md]`

#### 场景5 查看 Module 进度看板
**1、步骤**
用户点击"查看 Agent 工作"按钮进入 Page 2。

**2、验证**
- Page 2 展示 module 卡片：数量与 modules_progress.json 中 modules 数组一致
- 每张卡片显示：module 名称、状态（如 in_progress / pending）、feature 完成比（如 1/5 done）
- 点击 module_1 卡片后，下方展示 module_1_feature_list.json 中的 feature 列表详情，默认选中 module_1

---

## Story 3: 开发迭代监控与异常修复

### 故事概述：
我是一名已经进入自主开发阶段的开发者，Arch 和 Dev 在自动协作，我想要监控开发进展，并确认当 Arch 验收不通过时系统能自动驱动 Dev 修复、不需要我手动介入。

### 用户动线和验收标准

#### 场景1 Dev 交付 Feature 成功
**1、步骤**
Dev 完成 Feature #1 编码和自测，写入 progress.txt 交付总结，向 Arch 报告。

**2、验证**
- 群聊区出现 Dev 消息（Dev 角色样式）：告知 Feature #1 已交付
- `spec/actions.jsonl` 新增 action=to_arch, from=dev 的行
- `spec/module_1_progress.txt` 中 Dev Delivery 区域有实现摘要

#### 场景2 Arch 验收通过并推进下一个
**1、步骤**
Arch 审查后判定 Feature #1 通过，更新状态，派发下一个 feature。

**2、验证**
- 群聊区出现 Arch 消息：告知"Feature #1 验收通过，派发 Feature #2"
- `spec/module_1_feature_list.json` 中 Feature #1 的 `passes` 变为 `true`
- `spec/modules_progress.json` 中 module_1 对应 feature status 更新为 done
- `spec/actions.jsonl` 新增：to_human 通知人类 + dev_do 派发下一个任务
- `.team3-project.json` 中 Dev session：旧 UUID 归入 `done[]`，`runing` 更新为新 UUID

#### 场景3 Arch 验收不通过并退回 Dev
**1、步骤**
Dev 交付 Feature #2 后，Arch 审查发现问题，判定退回修复。

**2、验证**
- 群聊区依次出现：Dev 的交付消息 → Arch 的退回消息（明确说明不通过原因和修复要求）
- `spec/actions.jsonl` 新增 action=dev_fix, from=arch, to=dev 的行（注意不是 dev_do）
- `spec/module_1_progress.txt` 的 Architect Notes 区域记录退回原因
- `spec/module_1_feature_list.json` 中 Feature #2 的 `passes` 保持 `false`

#### 场景4 Dev 修复并重新交付（复用 session）
**1、步骤**
Dev 在同一 session 中修复问题并重新交付。

**2、验证**
- 群聊区出现 Dev 消息：确认已修复并重新交付
- `.team3-project.json` 中 `dev_agent.session.runing` 与场景3 中相同（未变化 = 复用 session）
- Dev 的 agent 执行日志中记录了本次修复调用

#### 场景5 消息队列合并（Dev 执行中收到多条消息）
**1、步骤**
Dev 正在执行任务（未完成），此时 Arch 连续发出两条消息给 Dev。

**2、验证**
- 群聊区正常显示 Arch 发出的两条消息
- Dev 在后续回复中，内容涉及两条消息中的要点（证明消息被合并投递、未丢失）
- 无消息被丢弃

#### 场景6 查看 module 工作过程 timeline
**1、步骤**
用户进入 Page 3 查看 module_1 的工作过程。

**2、验证**
- 页面展示 `module_1_progress.txt` 的完整文本内容
- 内容包含：Dev 的多次交付记录、Arch 的退回记录、以及最终通过记录（能看到完整开发迭代历史）

---

## Story 4: 正常推进，完成所有开发

### 故事概述：
我是一名已启动自主开发的开发者，Arch 和 Dev 正在自主协作迭代（无需我介入），我想要确认系统能自主完成所有 module 的全部 feature 开发，直到 modules_progress.json 中所有 module 状态变为 done。

### 用户动线和验收标准

- 本 story 验证的是「自主开发持续运转，直到全部完成」这条最长链路
- 用户无需操作，只是观察系统自主推进

#### 场景1 Module 1 剩余 feature 全部完成
**1、步骤**
系统自主运行：Dev 完成当前 feature → Arch 验收通过 → 派发下一个 → 循环，直到 module_1 所有 feature 完成。

**2、验证**
- `spec/modules_progress.json` 中 module_1 的 status 变为 `done`，所有 feature status=done
- `spec/module_1_progress.txt` 中有每个 feature 的 Dev Delivery 记录和 Architect Notes 验收记录
- `spec/module_1_feature_list.json` 中所有 feature 的 `passes` 为 `true`
- 群聊区显示了完整的 Dev 交付 → Arch 验收 → 派发下一个 消息序列

#### 场景2 Module 2 feature 拆解与开发完成
**1、步骤**
Module 1 完成后，Arch 自动拆解 module_2 的 feature list 并逐个派发 Dev 实现。

**2、验证**
- `spec/module_2_feature_list.json` 被创建，包含合理数量的 feature（与 module_2.md 需求对应）
- Dev 逐个完成 feature，Arch 逐个验收通过
- `spec/modules_progress.json` 中 module_2 的 status 最终变为 `done`
- `spec/module_2_progress.txt` 中有完整的开发迭代记录

#### 场景3 Module 3 feature 拆解与开发完成
**1、步骤**
Module 2 完成后，Arch 自动拆解 module_3 并派发开发，直到全部完成。

**2、验证**
- `spec/module_3_feature_list.json` 被创建
- 所有 feature 开发+验收通过
- `spec/modules_progress.json` 中 module_3 的 status 变为 `done`
- 至此 modules_progress.json 中所有 module 的 status 均为 `done`

#### 场景4 全局完成状态一致性
**1、步骤**
用户在 Web UI Page 2 查看 module 进度看板，确认全部完成。

**2、验证**
- Page 2 展示的所有 module 卡片状态均显示 done / 完成
- 每个 module 的 feature 完成比为 N/N（全部完成）
- `spec/actions.jsonl` 中包含完整的 dev_do → to_arch → dev_do 循环链（无断裂），覆盖每个 module 的每个 feature
- 无遗留的 in_progress 或 pending 状态

---

## Story 5: UAT 产品验收全流程

### 故事概述：
我是一名关注产品质量的开发者，所有 module 开发完成，我想要 UAT 独立验证整个产品按用户故事工作，验收通过则项目完成，失败则由我决策后驱动修复。

### 用户动线和验收标准

#### 场景1 人类 review 并确认 UAT 用户故事
**1、步骤**
用户在文档区打开 `spec/uat_stories.md` 查看 UAT 设计的用户故事。如需修改，在群聊中给 UAT 反馈（如"Story 2 需补充异常场景"）。

**2、验证**
- 文档区展示 uat_stories.md 完整内容，格式正确
- 若反馈给 UAT，UAT 回复确认后更新文件，文档区 mtime 重载显示最新版本
- 人类确认满意后，stories 内容固定（后续验收依据此版本）

#### 场景2 Arch 完成所有开发并触发 UAT 验收
**1、步骤**
Arch 验收完最后一个 module 的最后一个 feature，判定全部开发完成，发出 uat_check。

**2、验证**
- 群聊区出现 Arch 消息："所有 module 已开发完成，触发 UAT 验收"
- `spec/modules_progress.json` 中所有 module 的 status 均为 `done`
- `spec/actions.jsonl` 新增 action=uat_check, from=arch, to=uat 的行
- UAT 开始响应（后续出现 UAT 相关消息）

#### 场景3 UAT 编写并执行验收脚本
**1、步骤**
UAT 读取 uat_stories.md（不读 feature_list / progress / 业务代码），在 `uat/` 目录下编写并执行验证脚本。

**2、验证**
- `uat/story_1/`、`uat/story_2/` 等目录被创建，包含验证脚本文件
- 验收以黑盒方式执行：通过浏览器操作 / 文件系统检查 / ws 通信验证产品，不使用任何 mock
- UAT 在群聊中报告进度

#### 场景4 验收全部通过 — 产品完成
**1、步骤**
所有 story 验证通过，UAT 写入验收报告并通知人类。

**2、验证**
- 群聊区出现 UAT 消息："产品 UAT 验收全部通过"
- `spec/uat_report.md` 被创建，包含结构化表格（每个 story 的通过/失败结果 + 证据）
- `spec/actions.jsonl` 新增 to_human, from=uat 的行，message 末尾带 `[reread: spec/uat_report.md]`

#### 场景5 验收部分失败 — 通知人类决策
**1、步骤**
（替代场景）某个 story 验证失败，UAT 将失败详情报告给人类，等待决策。

**2、验证**
- 群聊区出现 UAT 消息：明确说明哪个 story / 场景失败 + 失败现象 + 期望行为 + 实际行为
- `spec/uat_report.md` 中对应 story 标记失败并附失败证据（截图路径 / 关键日志 / DOM 断言结果）
- UAT 不自行修改业务代码（`src/` 下无文件被 UAT 修改）

#### 场景6 人类决策后 Arch 修复并重新验收
**1、步骤**
用户在群聊告诉 Arch "Story 3 验证失败的原因是 XX，请修复"。Arch 分析后派发修复任务，Dev 修复完成后 Arch 再次触发 uat_check。

**2、验证**
- 群聊区出现完整修复流程消息：Arch 确认接手 → Arch 派发 dev_do → Dev 交付 → Arch 验收通过 → Arch 再次发出 uat_check
- `spec/actions.jsonl` 中 dev_do 行出现（新任务），`.team3-project.json` Dev session 更新为新 UUID
- UAT 重新执行验收后报告最终结果
