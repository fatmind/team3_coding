# Module 4: 迭代 2

## 一句话

不改架构、不加新流水线阶段，是对现有流程的优化加固。

## 范围

5 个改进项，详细问题分析和产品思路见 @spec/app_design_v2.md 对应章节

## 跨工程约束

本模块涉及 daemon / web / agent prompts 多个工程。

## 技术设计

### 1. 问题 3：Agent 执行中无法打断、插入最新要求 [重点][done]

产品思路和技术方案见 @spec/app_design_v2.md [关键技术方案 1]。
注：已实现，待验收。


### 2. 问题 1：e2e 每次全量跑，验收越来越慢 [重点][done]

产品思路见 @spec/app_design_v2.md [问题 1]。

**技术细节**：
- `feature_list.json` 新增 `depends_on` 字段（feature id 数组）
   ```json
   { "id": 5, "description": "...", "depends_on": [2, 3], "checkpoint": [...], "passes": false }
   ```
- Arch 拆 feature 时在 feature_list.json 标注 depends_on
- Dev 交付此 feature 前，按依赖跑 e2e 回归
- module 全 feature 完成时 Arch 触发全量 e2e
- UAT 不受影响，仍按 uat_stories 全量

### 3. 问题 6：UAT 黑盒约束未落地，失败后缺少自查 [重点][done]

产品思路见 @spec/app_design_v2.md [问题 6]。

**现状**：uat 缺少代码强检查证据，且 Story 失败就直接找人，不会先自查、分不清脚本问题还是产品问题。
**原则**：代码只校验 uat 证据「有没有」，UAT agent 自己判断结果、自己修脚本，daemon / web / agent 都是产品问题。

---

#### A. 验收报告 `spec/uat_report.md`

每个 Story **单独一节**（不用一张总表），固定五块：

1. **目标** — 摘自 `uat_stories.md`
2. **结果** — `pass` / `fail` / `partial`
3. **用户动线** — 每个场景、每步验证点标 pass/fail，一定要代入用户使用流程
4. **证据** — ` ```uat-evidence` JSON 块，给校验脚本读
5. **失败** — 记录过程中失败信息（`repair_round - classification` + 期望 / 实际 / 排查原因）；通过的 Story 可省略

---

#### B. 强校验 `cli/validate-uat-evidence.mjs`

UAT 写完 `spec/uat_report.md` 后 **自己跑** 校验，不过就自修：

```bash
node cli/validate-uat-evidence.mjs spec/uat_report.md
```

**证据字段与校验（v1 只查「有」）**：

| 字段 | 含义 | 校验方式 |
|------|------|---------|
| `story_id` | Story 编号 | JSON 存在，为正整数 |
| `verify_script` | 如 `uat/story_2/verify.mjs` | 路径文件存在 |
| `screenshots[]` | 截图路径列表 | 若截图列表不空，验证每个文件存在 |
| `simulate_human` | 是否需要 simulate_human | 若需要，则查看 `logs/uat.log` 日志判断是否有使用 |
| `puppeteer` | 是否需要 puppeteer | 若需要，则查看 uat 脚本代码，是否使用 |
| （verify 禁止项） | 黑盒约束 | 全文无 `fetch('/api`、`fetch("/api`、`import ... src/` |
| `uat/state.json` | 记录 uat 进展 | 文件存在 |

交付：`initWorkspace` 拷到 `cli/`。

---

#### C. 失败自查 + 运行状态 `uat/state.json`

UAT Story 失败时，需要区分 **分类**：

| 类型 | 谁修 | 怎么处理 |
|------|------|---------|
| `script_issue` | UAT 自己 | 改 verify → 只重跑该 Story |
| `product_issue` | Arch → Dev | 写 state → `to_arch` → Arch 修完再 `uat_fix` → 只重跑该 Story |

- **单 Story 最多 3 轮**（`product_issue` → Arch/Dev 修完 → 重跑该 Story = 1 轮）。
- 3 轮仍失败标 `exhausted`，继续验其它 Story。

**`uat/state.json`**（还没落地）：跨 Story、跨 `uat_check` / `uat_fix` 的**进度账本**，只给 UAT agent 判断下一步；session id 不写这里，统一在 `.team3-project.json` 的 `uat_agent.session` 里维护，Daemon 也只读那里。

| 记什么 | 字段 |
|--------|------|
| Story 进展 | `stories.<id>.status`（`pass` / `fail` / `partial`） |
| 验证点计数 | `stories.<id>.pass_count`、`stories.<id>.fail_count` |
| 修复轮次（按 Story 单独计） | `stories.<id>.repair_round`（0–3；0 = 尚未进入 product_issue 修复） |
| 最近一次失败概述，可为空 | `stories.<id>.last_failure` |

**流程要点**：
```
uat_check（指定 Story N）→ 读 state → 只跑 story_N
  失败 → 分类 → 更新 state
    script_issue：自修 → 同 session 重跑 story_N
    product_issue：state round++ → to_arch
  Arch 修完 → 发 uat_fix [uat-story: N] → Daemon 从 .team3-project.json 取 UAT session 续跑，round 接着数
全 Story 验完 → 写 uat_report → validate → state.status=completed → to_human
```

---

#### D. UAT session：每 Story 一次 `uat_check`（并入本期）

**问题**（原 @spec/app_stability.md §5）：UAT 单 session 跑完全部 Story，context compaction 丢上下文。

**方案**：

| 角色 | 行为 |
|------|------|
| **Arch** | 不用一条 `uat_check` 甩全量；新 Story 用 `uat_check`，message 指明 `[uat-story: N]`；`product_issue` 修完后的重验用 `uat_fix`，只发失败 Story |
| **Daemon** | `uat_design` / `uat_check` 新建 UAT session（旧 `runing` 归档到 `done[]`）；`uat_fix` 复用 `.team3-project.json` 里的 `uat_agent.session.runing` |
| **UAT** | `uat_check` / `uat_fix` 都只验 message 指定的 Story；进度 / 失败分类 / 自修轮次写 `uat/state.json`，不记录 session id |

这里和 Dev 保持同一个设计原则：**Daemon 只按 action 语义决定 session 生命周期**。Dev 已有 `dev_do`（新任务 / 新 session）和 `dev_fix`（当前任务修复 / 复用 session）；UAT 的 `uat_design` / `uat_check` 是新任务，`uat_fix` 是失败 Story 重验 / 复用 session。不能让 Daemon 靠 `[uat-story: N]`、`product_issue` 字样或 `uat/state.json` 反推意图。

若复用 session 时 `claude --resume` 返回 `No conversation found`，说明 `.team3-project.json` 里的 `runing` 已失效。Daemon 只做技术修复：替换为新 session id，用同一条消息以 `--session-id` 重试；不改变 action 的业务语义。

---

### 4. 问题 5：新项目 UX/UI 质量不稳定 [重点]

产品思路见 @spec/app_design_v2.md [问题 5]。UI 设计原则见 @spec/app_ux_awesome.md，复杂 UI 原型生成与合并见 @spec/app_ux_prototype.md。

**技术细节**：

**人类输入**：
- 交互草稿图 → 保存 `spec/ux_xxx.png`，Dev 后续引用
- 品牌名 → 让人类去 https://github.com/VoltAgent/awesome-design-md 选，只说名字（如 `mintlify`、`stripe`），**不提供色值**；色值由 CLI 从 StyleSeed / awesome-design-md 自动提取
- 少数情况下，人类明确说"跳过 / 忽略 / 你自己选" → Arch 默认选 `mintlify`，但必须写明这是 `arch_default`
- 若是复杂 UI 初始建设或已有项目大幅重做，额外提供 HTML 原型包目录

有 UI 时，Arch 必须在 `spec/app_design.md` 写固定段落：

```markdown
## UX/UI 输入

- 交互草稿图: spec/ux_xxx.png
- Brand: mintlify
- Brand note: <人类选择原因，或 Arch 代选原因>
- UI init: 首个 UI feature 由 Dev 执行 `node cli/init-ui-rules.mjs . --brand mintlify`
```

复杂 UI / 局部大重做时，在上面基础上追加：

```markdown
- HTML prototype: <prototype 目录路径>
- HTML prototype mode: initial-build | redesign
- HTML prototype scope: full | <模块名>
```

Arch 派发 UI feature 时使用两类信号：
- 简单 UI：`[ui-init: <品牌名>]`
- 复杂 UI / 局部大重做：`[ui-init: <品牌名>] [html-prototype: <path> mode=initial-build|redesign]`

**init-ui-rules CLI**（Dev 在首个 UI 任务、工程目录初始化后执行；**Arch 不执行**）：
```bash
node cli/init-ui-rules.mjs . --brand <品牌名>
```
Dev 在 STEP 2 跑完 init.sh 后执行上述命令。**Arch 不执行 CLI，Daemon 不解析 UI 语义**，`[ui-init]` / `[html-prototype]` 都只是 Arch → Dev 的 message 协议。

执行逻辑（新项目走 StyleSeed 标准栈：React + Tailwind v4，**不从 team3/web copy CSS**）：
1. `cp -r styleseed/engine/*` → `CLAUDE.md`、`DESIGN-LANGUAGE.md`、`.claude/skills/ss-*`、`css/`、`components/` 等
2. `engine/css/{base,fonts,index}.css` 原样复制（StyleSeed 默认，含 Tailwind `@apply`）
3. `theme.css` 按品牌名：
   - 若 `styleseed/skins/{brand}/theme.css` 存在（stripe、linear、notion、toss、vercel、arc、raycast）→ 直接 copy
   - 否则 fetch `awesome-design-md/design-md/{brand}/DESIGN.md` → 套 `skins/toss/theme.css` 模板改色值
4. 安装 Tailwind v4 依赖；`CLAUDE.md` 写入品牌名段落
5. 幂等：默认已有文件不覆盖；只有显式 `--force` 才覆盖
6. 品牌不存在 / DESIGN.md 拉取失败 / 解析不到颜色 → 明确失败，不 fallback、不猜色值；Dev 把失败原因交给 Arch

注意：
- **不自动跑 `/ss-setup`**：它是交互式问卷 + 会生成移动端 dashboard 模板页；
- 新项目按交互草稿图开发，CLI 只做非交互的文件注入 + 品牌皮肤。
- **与 team3/web 的区别**：team3/web 是先有项目后 retrofit StyleSeed、故意不用 Tailwind，base.css 是手写特例；被 team3 管理的新项目是 greenfield，用 StyleSeed 标准路径即可。

**HTML 原型包翻译**（复杂 UI 默认路径）：
- 外部 AI 产出的 HTML 原型包是 UI 规格，不是真实源码。
- Dev 先写 `spec/ux_prototype_trans.md`，再按计划翻译页面、组件、token 和状态。
- 真实项目的数据对象、API、鉴权、业务规则是 source of truth；原型字段映射不上，写入 `Open Mapping Issues`。
- 详细产出要求、翻译计划模板、质量判断不在本模块重复，直接按 @spec/app_ux_prototype.md 执行。

**Dev / Arch 交付约束**：
- Dev 做 UI feature：启动 dev server → 打开真实页面 → 截图检查比例/溢出/可点击状态 → 跑 `/ss-lint` → 交付时写 `UI Quality Evidence`
- `UI Quality Evidence` 固定字段：`ui_init`、`brand`、`theme_source`、`screenshots`、`ss_lint`、`self_check.layout_ratio/overflow/clickable_states`、`notes`
- 若使用 HTML 原型包，Delivery 还要说明 `ux_prototype_trans` 路径、reused / rewritten / discarded、Open Mapping Issues。
- Arch 验收 UI feature：只卡硬证据。缺 `UI Quality Evidence`、缺真实页面截图、缺 `/ss-lint` 结果、缺比例/溢出/可点击状态自查结论，都退回

### 5. 问题 2：Arch 上下文持续累积，缺裁剪 [重点][done]

产品思路见 @spec/app_design_v2.md [问题 2]。

**`.team3-project.json`**：`arch_agent.session.bound_module`（`null` 或 module id）。

| 场景 | 行为 |
|------|------|
| **首次**：`modules_progress.json` 不存在或为空 | 新 session（`init_agent`）；`bound_module = null` |
| 有 `in_progress`，`bound_module === null` | 不换 session，绑定 `bound_module = in_progress.id` |
| `bound_module === in_progress.id` | `--resume` |
| `bound_module !== in_progress.id` | 新 UUID、旧 session → `done[]`、更新 `bound_module` |
| 无 `in_progress` | 不换 session |
| 用户中断恢复 | 不换 session |

换 session 时不额外拼 prompt（Arch system prompt 已要求建立项目全局认识）。实现：`agent-scheduler._resolveSession('arch')`。UAT session 见本章 [问题 6 §3.D]。

**当前判断**：P2，已实现（`agent-scheduler._resolveArchSession` + `bound_module`）。

---

## 工程位置

跨 daemon / web / agent prompts
