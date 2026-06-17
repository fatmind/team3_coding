# Team3 UX/UI 设计原则

本文档定义 UX/UI 层面的设计原则与约束。Module 1（Web UI）的具体实现必须遵循这些原则。

## 一、设计体系

### 1.1 三层输入（缺一不可）

| 层 | 你提供什么 | AI 拿它做什么 | 为什么人必须给 |
|---|---|---|---|
| **交互结构**（交互草稿图） | 手绘/截图，标注页面有哪些区域、主要功能 | 确定组件拆分、路由结构、数据流 | 页面的空间分区意图只存在你脑子里——AI 没有你对"用户在这个产品里先看什么、再操作什么"的直觉 |
| **视觉规范**（awesome-design-md） | 一个品牌的 DESIGN.md URL，或直接给色值 | 提取颜色、字体、间距、圆角等 token | 色值 ≠ 风格——AI 有 Tailwind 全部调色板，但不知道你要"Supabase 的克制感"还是"Stripe 的专业感" |
| **设计判断**（StyleSeed） | 项目里有 CLAUDE.md + DESIGN-LANGUAGE.md | 69 条规则约束 AI 的排版、配色、节奏决策 | AI 缺乏"什么时候该克制"的判断——阴影多重才过重？同类卡片连排几个算单调？这些是经验，不是推理 |

> styleseed: https://github.com/bitjaru/styleseed
> awesome-design-md: https://github.com/VoltAgent/awesome-design-md

交互草稿图不需要高保真，手绘标注"这里是导航、这里是聊天区"就够。但交互草稿图上的文字是**标注含义**，不是最终 UI——需要明确告诉 AI 或者在交互草稿图里标清楚。

> 交互草稿图里写"page1 首页"，AI 会把它当文本渲染出来。你脑子里的"这是个导航菜单"不会自动传递——要么画成菜单的样子，要么文字说明。

### 1.2 品牌选择：Mintlify

目标风格：**Mintlify**（文档工具的清爽感，浅色为主、绿色品牌色、留白充足）

- 主色调：白色/浅灰背景 + 绿色品牌色 `#00d4a4`（Mintlify 标志性的 mint green）
- 字体：Inter（正文）+ JetBrains Mono（代码/日志/项目名）
- 色彩体系：通过 awesome-design-md 的 Mintlify DESIGN.md 提取 token，用 StyleSeed 语义化

### 1.3 StyleSeed 集成

**工作目录**：做 UI 开发时从 `team3/web/` 启动 Claude Code，确保 CLAUDE.md + DESIGN-LANGUAGE.md 生效。

集成步骤：
1. 合并 CLAUDE.md（保留原有 `@AGENTS.md`，追加 StyleSeed + 桌面端声明 + 品牌配置）
2. 复制 DESIGN-LANGUAGE.md、METHODOLOGY.md、`.claude/skills/ss-*` 到 web/
3. 手动创建 `src/styles/theme.css`（从 awesome-design-md Mintlify DESIGN.md 提取真实色值）
4. 手动创建 `src/styles/base.css`（纯 CSS reset，**不含 Tailwind @apply**）
5. 手动创建 `src/styles/fonts.css`（Google Fonts CDN import）
6. globals.css 保留为单文件（未拆分为 layout.css + components.css，实践中单文件更方便定位）

> `/ss-setup` 的体感：像是"帮你填了一份品牌配置问卷"。核心价值是避免"先用默认值写、后面再改"的返工。设计规则的生效来自 `cp -r engine/*` 把 CLAUDE.md 放进项目根目录，不来自 `/ss-setup`。

### 1.4 桌面端适配

StyleSeed 默认偏移动端 dashboard。本项目需要跳过/适配的规则：
- 规则 13（430px 宽度限制）→ 桌面端全宽，最小窗口宽度 900px
- 规则 14（mx-6/px-6 移动端节奏）→ 桌面端用更大间距
- 触控目标 44x44px → 桌面端可缩小至 32px（鼠标操作精度更高）

在 CLAUDE.md 中明确声明这是桌面端应用。侧边栏固定不可折叠（900px 最小宽度保证空间足够）。

### 1.5 工作目录约定

| 场景 | 启动 Claude 的目录 | 原因 |
|------|-------------------|------|
| Web UI 开发/重构 | `team3/web/` | StyleSeed 规则 + DESIGN-LANGUAGE.md 生效 |
| Daemon 开发 | `team3/daemon/` 或 `team3/` | 不需要 UI 设计规则 |
| 整体架构/spec 讨论 | `team3/` | 访问全局 spec/ 目录 |

---

## 二、与 AI 协作 UI 的原则

### 2.1 交互细节原则

**关键原则**：交互草稿图是概要方向和主交互动线。很多细节交互，AI 应自主发挥、自主思考，做出合理的默认决策。不要只做明确要求的，要主动补充合理的交互细节。

这需要你**明确授权**。本项目的实际经验：告诉 AI "很多细节交互，希望你能自主发挥、自主思考"之后，它才开始做合理的默认决策（项目默认折叠、连续同作者消息折叠头像、@mention 弹出下拉等）。不说这句话，AI 会保守地只做你明确要求的。

如果 AI 的自主决策不对：直接说"不要 X，改成 Y"，一句话纠正就行。

**"授权 AI 自主决策"不是万能的**：涉及业务判断的交互（比如"新建项目时应该收集哪些字段"）AI 会瞎猜——因为它不了解你的用户是谁、核心工作流是什么。功能越核心，人需要给的输入越具体。

### 2.2 四种迭代场景

#### 场景 A：初始化页面 — 给三层输入，缺一不可

三层输入同时给（见 §1.1）。品牌色必须从源文件读，不能猜。前端/后端分离要在第一轮说——后面再拆的成本远大于一开始就分离。

#### 场景 B：局部样式调整 — 截图 + 标注就够

截图 → 圈出问题区域 → 一句话说期望。例如："Header 太高了，降到 48px"。不需要重新给交互草稿图、不需要重复视觉规范。AI 会在已有 token 体系内调整。

#### 场景 C：局部功能调整 — 说清目标，交互细节让 AI 自己想

描述功能目标，不描述实现方式：
- ✅ "聊天框内支持 @ 某个人发送消息"
- ❌ "在输入框上方加三个 button，点击后往 input 里插入 @xxx"

#### 场景 D：大调整重构 — 给"为什么换"+ 新目标规范

如果只是换视觉风格、token 或局部布局，按下面做：

1. 把新的设计规则文件放入项目
2. 跑 `/ss-setup` 配置品牌参数
3. 明确说"用新的 token 重写现有组件"——AI 不会自动迁移，必须指令触发

不需要重画交互草稿图。结构不变的情况下只是换皮肤和 token 体系。

如果页面结构、主流程、组件边界都要大改，不要只靠这套 StyleSeed 流程。转到 `app_ux_prototype.md`：先让外部 AI 生成 HTML 原型包，人类确认后，Dev 再翻译进真实项目。

### 2.3 给 AI 的输入清单

| 场景 | 必须给 | 可选给 | 不需要给 |
|------|-------|-------|---------|
| **初始化** | 交互草稿图 + 视觉规范 URL + 技术栈 + 数据分离要求 | 品牌色偏好、字体偏好 | 具体组件代码、CSS 细节 |
| **样式调整** | 截图 + 问题描述 | 期望的具体数值 | 交互草稿图、规范文档 |
| **功能调整** | 功能目标描述 | 参考产品截图 | 交互细节实现方式 |
| **大重构** | 新规范体系 + 迁移指令 | 保留/不保留的决策 | 原有代码的逐行对照 |

---

## 三、StyleSeed 工具指南

### 3.1 StyleSeed 与 awesome-design-md 分工

```
awesome-design-md    →  "用什么颜色"   →  皮肤数据（theme.css）
StyleSeed engine     →  "怎么用颜色"   →  设计判断（69 条规则 + 语义 token）
你的交互草稿图            →  "做成什么样"   →  交互结构
```

| 场景 | 用 awesome-design-md | 用 StyleSeed |
|------|---------------------|-------------|
| 初始化 | `/ss-setup` 时选品牌 or 给 DESIGN.md URL | 自动读 CLAUDE.md + DESIGN-LANGUAGE.md |
| 换品牌风格 | 换一个 `theme.css` | 不用动——规则是品牌无关的 |
| 加新页面 | 不用动 | `/ss-page` 按规则生成 |
| 检查合规 | 不用动 | `/ss-review` 或 `/ss-lint` |

### 3.2 命令推荐

**强烈建议（每次改完都跑）**：

| 命令 | 做什么 | 适用场景 |
|------|-------|---------|
| `/ss-lint` | grep 扫描：硬编码色值、px 间距、缺 data-slot、template literal className | 全部场景，写完就跑 |
| `/ss-feedback` | 给组件添加 loading skeleton / error / empty / success 四种状态 | 初始化、功能调整 |
| `/ss-review` | 深度审查 7 维度：token、组件约定、a11y、移动端、性能、排版、间距 | 初始化完成后、大重构后 |
| `/ss-a11y` | 无障碍审查：对比度、触控目标、focus ring、ARIA、reduced-motion | 有新交互元素时 |

lint 和 review 的区别：lint 查"写法对不对"（grep 能查的），review 查"设计判断对不对"（间距是不是 6 的倍数、排版 tracking 对不对）。

**按需使用**：`/ss-setup`（项目初始化定品牌色）、`/ss-component`（生成组件 boilerplate）、`/ss-tokens`（管理 token）、`/ss-copy`（生成 UI 文案）

**桌面端 web 项目不需要**：`/ss-flow`（用户流程是人的决策）、`/ss-page`（模板偏移动端）、`/ss-pattern`（KPI 网格等偏移动端）、`/ss-motion`（功能未定型不加动效）、`/ss-audit`（早期性价比不高）

### 3.3 场景推荐组合

| 场景 | 强烈建议 | 按需 |
|------|---------|------|
| **初始化** | `lint`（写完扫）、`review`（最后查） | `setup`（定品牌色）、`feedback`（补状态） |
| **样式调整** | `lint`（扫 → 改 → 再扫） | `tokens`（如果要加新 token） |
| **功能调整** | `lint`（收尾扫）、`feedback`（补状态）、`a11y`（有新交互时） | `component`（需要新组件时） |
| **大重构** | `lint`（扫残留）、`review`（整体一致性） | `setup`（如果换品牌）、`tokens` |

> **核心习惯**：`/ss-lint` 写完就跑（像 ESLint），`/ss-feedback` 功能做完补一轮（像写测试），`/ss-review` 发版前跑（像 code review）。

---

## 四、经验与局限

### 4.1 踩坑记录

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | StyleSeed base.css 包含 Tailwind `@apply` 指令 | 本项目不用 Tailwind，直接 copy 会报错 | 手写纯 CSS reset 替代 |
| 2 | theme.css 初始用了错误品牌色 `#0D9373` | 没读 awesome-design-md 真实 DESIGN.md | 必须从源文件提取，不能凭记忆猜 |
| 3 | ChatPanel `msg.message.split()` 运行时崩溃 | 部分消息用 `body` 字段代替 `message`，数据格式不一致 | 添加 `getMsgText()` 兼容两种字段 |
| 4 | 整体进度面板 feature list 不显示 | `modules_progress.json` 的 `id: 1` 是数字，但 API 期望 `module_1` 字符串 | 前端添加 `toModuleId()` 转换 |
| 5 | Daemon 在跑但群聊显示 "Offline" | `/api/projects` 不返回 `daemon_port`，ChatPanel 默认连 3100 但实际端口不同 | ChatPanel 改为从 status API 获取实际端口 |
| 6 | 时间戳显示为 `23-02-10` | daemon 的 `formatTs()` 用了 `-` 作时间分隔符 | 统一改为 `:` 分隔 |
| 7 | `.next/types/validator.ts` 引用已删路由报编译错 | Next.js 缓存了旧路由的类型信息 | 删除 `.next` 目录重新编译 |
| 8 | hydration mismatch 错误 | 浏览器扩展在 `<html>` 标签注入自定义属性 | 添加 `suppressHydrationWarning` |

### 4.2 关键经验

1. **品牌色必须从源文件读，不能猜** — AI 初次生成时用了相近但完全不同的色值。使用外部设计资产时，必须 `cat` 读取原始文件内容再提取。

2. **CSS 文件不必追求拆分** — 单文件 ~1200 行完全可控，拆分后反而增加 import 管理和跨文件查找成本。

3. **Daemon 端口发现是隐蔽的关键链路** — 端口号由 workspace 路径 hash 决定，但信息不在 `/api/projects` 返回中。"数据在哪个层获取"的决策在设计阶段很容易漏掉。

4. **前后端数据格式不一致是高发 bug** — `modules_progress.json` 用数字 id，文件系统用 `module_1_*`，API 校验用 `/^module_\d+$/`。三个地方三种格式。

5. **`msg.message` 可能不存在** — 不同 agent 写入格式不一致，前端必须做防御性处理。`text.split()` 在 undefined 时崩溃，TypeScript 编译抓不到。

6. **@mention 需要双层实现** — 输入框 @自动补全（下拉列表）和快捷 chips（点击插入）两者都需要。

7. **群聊头像用彩色圆形 + 首字，不用 emoji** — emoji 大小不一致、视觉权重过重。emoji 适合配置面板，不适合密集的群聊消息列表。

8. **浏览器扩展会破坏 React hydration** — Next.js 应用在 `<html>` 上加 `suppressHydrationWarning`。

9. **已有项目目录要能导入，不能只支持新建** — `initWorkspace` 必须幂等——只补充缺失的骨架文件，不覆盖已有内容。

### 4.3 方法局限

1. **StyleSeed 的 69 条规则是"好品味的近似"，不是"好品味本身"** — 规则来自少数产品的逆向提炼，覆盖的是移动端 dashboard 场景。没有人审视"哪些规则该跳过"，AI 会全部遵守。

2. **"三层输入"模型在以下情况失效**：
   - 产品本身还没想清楚（连线框都画不出来）——应先在纸上理清信息架构
   - 视觉风格不属于任何已有品牌（独创品牌语言）——需要自己写 `theme.css`

3. **前端/后端分离要在第一轮说** — 后面再拆的成本远大于一开始就分离。Mock API 作为独立的 route handler，前端通过 `lib/api.ts` 调用——这个结构从一开始就定好。

---

## 五、实操 UI 开发经验

### 06-03 单页面布局调整

这次 Panel 4（Agents）已经按本文的方法给了交互草稿图、视觉规范、前后端分离要求，但仍然反复修改，原因不是"规范没用"，而是把规范当成了静态输入，没有把它变成运行时验证闭环。

具体踩坑：

1. **交互草稿图表达的是比例关系，不是文案清单** — 交互草稿图里的 `heartbeat just now uptime 02:14:38` 是占位语义，不应该照抄。真正要显示的是当前前端能解释的数据，例如 `PID / port / heartbeat 时间`。布局要严格对齐，内容要按业务理解替换。

2. **单页面局部调整必须在真实页面宽度下看** — 只看组件代码或脑补 1440px 画布，会漏掉侧边栏占宽后的真实约束。Agent 卡片在真实页面里变窄后，`Running / Edit / 名称 / session` 互相挤压，只有打开 `/?project=...&panel=4` 截图才能看到。

3. **组件可交互性不能只做"看起来像"** — Agent 卡片视觉上像可点击对象，就必须真的能点：选中态、日志切换、键盘 Enter/Space、Edit 不误触发卡片选择。否则 UI 看起来完成了，实际前端功能没做完。

4. **不要过度设计小交互** — Edit 按钮最简单的方案是跟在 `Running/Idle` 后面，淡色常驻。先前把它做成 hover 出现、右下角定位、session 留白，都是为了解决自己制造的问题。

5. **截图反馈要由 AI 自己做第一轮** — 人指出问题当然有效，但太慢。局部布局完成后，AI 应立即启动或复用 dev server，用浏览器打开目标 URL，自行截图检查比例、溢出、重叠、可点击状态，再交给人看。

下一步更合理的流程：

1. **先确认目标 URL 和真实窗口**：例如 `http://localhost:3001/?project=badminton_call&panel=4&tab=chat`，不要只在代码里推演。
2. **先做 mock，但 mock 要服务布局**：mock 数据要覆盖长名字、长 session、running/idle、编辑态、空日志等会挤压布局的情况。
3. **每轮 UI 修改后先自截图**：至少检查默认态、选中另一个 Agent、点击 Edit 后的编辑态。
4. **截图发现问题后再改 CSS/结构**：先看真实现象，再改，不要连续凭感觉补样式。
5. **最后再让人肉验收**：人应该看的是 AI 自查后的版本，而不是帮 AI 当第一轮视觉 QA。

> 对单页面布局来说，`spec + 交互草稿图 + 视觉 token` 只能决定方向；真正决定质量的是"真实页面截图 → 自己发现问题 → 再修"这个闭环。

### 06-17 全页面重构

全页面 UI 重构时，选择 **HTML 原型包（方案二）** 比直接要求外部 AI 生成 Next.js 工程更稳：HTML 更容易被外部 AI 产品生成和调整，人类也更容易快速验收完整交互。

详细流程见 `app_ux_prototype.md`。本文只保留协作经验：

1. **HTML 原型是规格，不是真实源码** — Dev 先写 `spec/ux_prototype_trans.md`，再翻译页面、组件、token 和状态。
2. **真实项目是 source of truth** — 原型字段、候选路由、组件角色都只是候选；真实 API、鉴权、业务规则不能被原型反推。
3. **人类确认过的交互不能静默删除** — 做不到或映射不上的交互，写进 `Open Mapping Issues`，最后汇总给人类判断。
