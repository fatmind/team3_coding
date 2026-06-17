# Team3 UI Prototype 生成与合并指南

team3 人类和 agent 协作时，UI 是最需要人类确认的。UI 交互和人类点外卖一样，看到了、点一点、体验一下，才能真知道想要什么。

## 先看结论

| 路径 | 场景 | 输入 | 谁处理 |
|------|------|------|--------|
| A 简单 UI | 1-2 个页面，交互直观 | 交互草稿图 + 品牌名 | Arch 收集，Dev 自写 |
| B 复杂 UI 初始建设 | 页面多、交互复杂，Dev 直接写搞不定 | 外部 AI 生成 prototype + 交互草稿图 | Dev 按 Prototype Merge Mode 合并 |
| C 较大 UI 局部重做 | 已有真实项目，某模块大幅重新设计 | 外部 AI 生成局部 prototype + 交互草稿图 | Dev 按 Prototype Merge Mode 合并 |
| D 小 UI 修改 | feature 开发中样式微调、状态补充 | 无 | Dev 自己搞定 |

路径 B/C 有两个可行方案：
- 方案一让外部 AI 生成接近真实项目的 Next.js 原型；
- 方案二让外部 AI 生成 HTML 原型规格包，再由 Dev 翻译进真实项目。

两种方案都已验证：
- 原型可用，合并代码稳定。
- 选择**方案二：HTML 原型包**，原因是外部 AI 生成 HTML 原型更稳定，修改也更简单。
- 草稿图提供 "人类初始的布局想法"，prototype 产出 "可运行交互原型"。

---

# 方案一：Next.js 工程原型

## 一、核心思路

外部设计 AI 直接生成一个接近真实项目技术栈的前端工程：Next.js App Router、React、TypeScript、Tailwind、集中 mock 数据、集中类型和数据契约。人类确认后，Dev 把它当上游代码读，做**受控吸收**：保留布局、组件拆分、状态 UI 和 token 思路；替换 mock 数据、伪路由、假后端和不符合真实项目的实现。

适用场景：
- 复杂 UI 初始建设：页面多、交互复杂，Dev 直接写风险高。
- 较大 UI 局部重做：已有真实项目，某模块需要大幅重新设计。
- 设计 AI 已证明能稳定生成可运行、组件拆分清楚的 Next.js 工程。

## 二、给设计 AI 完整 prompt

把下面这段给外部设计 AI，按项目实际内容替换 `<...>`。

````markdown
我要生成一个复杂 UI prototype，后续会交给 Dev 合并进真实 Next.js 项目。
请生成可运行、可迁移的前端原型，不要只做静态视觉稿，不是单 HTML（和真实项目接近的前端工程）。特别提醒：只需前端，后端全 mock 数据。

## 产品概述
<写产品目标、用户、核心流程>

## 品牌要求
- 使用 <brand> 视觉风格，prototype 的视觉风格必须和 <brand> 保持一致
- 不要自己发明另一套视觉风格
- 桌面端 / 移动端优先

## 技术栈
- Next.js App Router，不使用 Pages Router
- React + TypeScript
- Tailwind CSS v4
- Radix UI primitives
- lucide-react 图标
- clsx / tailwind-merge 可用
- 不接真实后端，所有数据 mock

## 代码结构
src/
  app/
    page.tsx
    <route>/page.tsx
  components/
    <domain>/
      XxxCard.tsx
      XxxDialog.tsx
      XxxForm.tsx
      XxxList.tsx
  lib/
    mock-data.ts
    types.ts
    ui-copy.ts
docs/
  ui-data-contract.md

## 具体要求
1. mock 数据集中放在 `src/lib/mock-data.ts`
2. TypeScript 类型集中放在 `src/lib/types.ts`
3. 页面只负责组合，表单、卡片、列表、详情、弹窗必须拆成独立组件
4. 所有组件 props 明确 typed
5. 覆盖空态、loading、错误、禁用、成功反馈等关键状态
6. 不要把 mock 数据写死在组件内部
7. 不要生成单文件大组件
8. 不要引入额外状态管理库
9. 不要使用 styled-components、CSS modules、外部 UI kit
10. 尽量使用 Tailwind token 或 CSS variables，不要 hardcode hex

请输出 `docs/ui-data-contract.md`，说明每个页面/组件依赖的数据结构。每个字段写：
- 字段名
- 类型
- UI 用途
- mock 示例

请确保整个 prototype 可以本地运行，并且主要交互可以用 mock 数据完整体验。
请参考附件 <...> 交互草稿图。

这是完整的需求，若有不明确的，请反问我。请开始设计规划。
````

## 三、Arch / Dev 怎么调整

路径 A / D：现有 `arch_prompt.md` 和 `dev_prompt.md` 已覆盖，不需要额外调整。

路径 B / C：在现有流程基础上增加 Next.js prototype 合并信号。

### Arch 调整

1. `spec/app_design.md` 的 `## UX/UI 输入` 固定段落追加：

```markdown
- UI prototype: <prototype 目录路径>
- UI prototype scope: full | <模块名>（路径 C 填写局部范围）
```

2. 首个 UI feature 的 `dev_do` 末尾，在 `[ui-init: <品牌名>]` 后追加：

```text
[prototype-merge: <prototype 目录路径>]
```

3. 路径 C 局部调整时：

```text
[prototype-merge: <prototype 目录路径> scope=<模块名>]
```

4. MODE B 验收 checklist 追加：
- Dev 是否读取了 prototype 源码和 `ui-data-contract.md`
- Dev 是否写了字段映射（prototype field -> real API field）
- Dev 是否说明了 reused / discarded
- Dev 是否保留了 prototype 里的关键交互状态（空态、loading、错误、满员、禁用、成功）
- Dev 是否说明了 CSS 变量体系如何并轨
- Dev 是否说明了 prototype 伪路由是否已替换为真实 Next.js 路由

### Dev 调整

有 `[prototype-merge: <path>]` 信号时，STEP 4 先读 prototype，再实现。

1. 先读：
- `<path>/docs/ui-data-contract.md`
- `<path>/src/lib/types.ts`
- `<path>/src/lib/mock-data.ts`
- 相关页面和组件源码（路径 C 只读 scope 范围）

2. 可以直接吸收：
- 页面布局、组件拆分方式
- Tailwind class / token 用法
- 空态、loading、错误、禁用、成功反馈的 UI 结构
- mock data shape（只做结构参考，不照搬数据本身）
- CSS 变量体系

3. 必须修改：
- mock 字段名 -> 映射到真实 API 字段
- 路由方式 -> 替换为真实 Next.js routing，删除 `useState<PageView>` 等伪路由
- 数据加载 -> 接真实 API，删除 mock data
- 权限和业务状态逻辑 -> 接真实后端

4. 禁止带入：
- mock 数据本身（`MOCK_ACTIVITIES` 等）
- 伪路由逻辑（`useState<PageView>` 等）
- `setTimeout` 假后端调用
- 设计工具工程壳（`index.html`、设计状态文件等）
- 与真实项目冲突的全局 reset

5. STEP 7 追加三项并轨决策：
- 字段映射：逐一写出 prototype field -> real API field；camelCase/snake_case 不一致时写 adapter。
- CSS 并轨：prototype 变量和 `init-ui-rules` 生成的 `theme.css` 同方向时，合并成一套；方向冲突时，以 `theme.css` 为准重写 prototype 样式。
- Radix/lucide 决策：prototype 未用 Radix/lucide 时，Dev 可以保留原型 CSS 组件类，也可以替换为 Radix/lucide；必须在 Delivery 中说明选择。

## 四、原型产出质量判断

好的 Next.js prototype 不是"看起来像成品"，而是方便 Dev 合并：
- 能跑
- 技术栈接近真实项目
- 组件拆开
- mock 数据集中
- types 集中
- 数据契约清楚
- 品牌和 `init-ui-rules --brand` 一致

如果设计 AI 生成的是单文件大组件、数据散落、字段乱飘、伪路由和业务逻辑混在一起，它只能当视觉参考，不适合作为可合并上游。

---

# 方案二：HTML 原型包（默认推荐）

## 一、核心思路

外部设计 AI 输出**可翻译的 HTML UI 规格包**，不是只给截图，也不是让 Dev 照着 HTML 手写页面。HTML 原型负责表达：
- 候选 route
- view model
- 用户 action
- 组件角色
- 语义 token
- 关键状态样例

Dev 合并时再读取真实项目，把候选结构映射成真实 App Router 路由、API 字段、组件复用和 token 并轨。

它可以是单个 HTML，也可以是多 HTML 文件。选择标准不是"文件越少越好"，而是人类能顺畅浏览确认，Dev 能按页面/组件边界翻译：
- 1-5 个页面、交互集中：可以用 `index.html` 单入口，但每个 view 必须有清晰 `ROUTE MAPPING` 和组件标注。
- 大于 5 个页面：建议拆成 `index.html` + `pages/*.html`，`index.html` 做导航目录，页面间用普通链接连起来；共享 `styles/`、`mock-data.js`、`logic.js`、`ui-data-contract.md`、`handoff-map.md`。

关键边界：
- 外部 AI 不知道真实项目，不能要求它写真实 API、真实字段、真实组件、真实 token 文件。
- 外部 AI 只负责把 UI 设计表达成 Next.js-friendly / StyleSeed-friendly 的结构。
- Dev 翻译时以真实项目的数据对象、API contract、鉴权和业务规则为 source of truth。

## 二、给设计 AI 完整 prompt

把下面这段给外部设计 AI，按项目内容替换 `<...>`。

````markdown
我要生成一个高保真交互原型，后续会交给 Dev 翻译为真实 Next.js App Router 项目。
请输出**可翻译的 HTML UI 规格包**，不是只给视觉 demo。页面多时可以拆多个 HTML，但必须有 `index.html` 作为统一浏览入口。

## 边界
- 你不知道真实项目代码、API、字段、组件、token 文件，不要编造这些内容。
- 你只输出候选路由、UI view model、用户 action、组件角色、语义 token，供 Dev 后续映射到真实项目。

## 输入
- 产品概述：<写产品目标、用户、核心流程>
- 交互草稿图：<截图/描述>
- 视觉风格：<brand 或 awesome-design-md 链接>
- 平台：桌面端 / 移动端 / 响应式

## 工程风格
- 候选页面路径使用 Next.js App Router 习惯，如 `/xxx`、`/xxx/[id]`。
- 每个可抽取组件都标出 props、state、children slot。
- 原型只用 mock，但必须写清 UI 依赖的数据结构。
- 视觉遵循 StyleSeed / awesome-design-md 思路：交互结构、视觉 token、设计判断分开表达。
- 组件 CSS 不 hardcode 品牌色；颜色、间距、圆角、阴影通过语义 token 表达。

参考：
- styleseed: https://github.com/bitjaru/styleseed
- awesome-design-md: https://github.com/VoltAgent/awesome-design-md

## 交付物

| 文件 | 要求 |
|---|---|
| `index.html` | 统一浏览入口。小型原型可放所有 view；大型原型提供页面目录并链接到 `pages/*.html`。加载 `styles/prototype-tokens.css`、`styles/prototype-components.css`，不依赖 iframe、远程 CDN 或外部 UI kit。 |
| `pages/*.html` | 5+ 页面或多模块时必须。每个候选 route / screen 一个文件，共享同一套 `styles/`、`mock-data.js`、`logic.js`。 |
| `styles/prototype-tokens.css` | 只放 token。hex 只允许在 Seed Tokens；组件样式只能引用语义 token。token 用 `--prototype-*` 命名，不要声称来自真实项目。 |
| `styles/prototype-components.css` | 只放组件样式。按 `/* ===== COMPONENT: X ===== */` 分区，class 带原型 namespace，状态用 `data-state` / `aria-*` / variant class。 |
| `mock-data.js` | 集中放 mock 数据和枚举。覆盖长文本、空列表、loading、error、disabled、success、业务状态等会影响布局的情况。不假设真实 API 字段名。 |
| `logic.js` | 只放纯函数；不含 `document.`、`window.location`、`innerHTML`、DOM 查询或事件绑定。核心算法给 2-3 组输入输出样例。 |
| `ui-data-contract.md` | 每个实体一张表：`原型字段 / TypeScript 类型 / 可空 / 来源类型 / UI 用途 / 备注`。来源类型只用 `mock`、`user-input`、`derived`、`async-placeholder`、`route-param`。枚举要列内部值、显示文案、CSS class、状态含义。 |
| `handoff-map.md` | 原型结构地图，不写真实项目映射。列出候选 route、组件角色、用户 action、纯函数，例如 `#view-detail -> /sessions/[id]`、`joinSession -> action`、`status-badge -> component role`。 |

## HTML 标注

每个页面顶部写候选路由：

```html
<!--
  ROUTE MAPPING（候选路由，不是真实项目路由）:
  #<view-id> -> <path> (<页面说明>)
  #<view-id-2> -> <path>/[<param>] (<param>=route-param)
  modal: <modal-id> -> Dialog on <父路由> 或候选 route（写推荐理由）
-->
```

每个可抽取组件写标注：

```html
<!--
  COMPONENT: <ComponentName>
  Slot: <page | card | form | dialog | badge | empty | toast | shell>
  Props: { <field>: <TypeScript 类型>, ... }
  DataSource: <mock-data.js key> | user-input | derived | async-placeholder | route-param
  States: default | loading | empty | error | disabled | success | <business-state>
  ComponentRole: <status-badge | progress | modal | empty-state | toast | form | list | card | none>
  SuggestedFile: components/<ComponentName>.tsx
-->
<section data-component="<ComponentName>" data-slot="<slot>" data-state="default">
  ...
</section>
<!-- /<ComponentName> -->
```

标注要求：
- 卡片、表单、列表、弹窗、空态、状态徽章、toast、loading 都要标注。
- 子组件也要标注，但不要把纯装饰 div 标成组件。
- 每个关键状态都要有真实可见 HTML 示例：`loading`、`empty`、`error`、`disabled`、`success`、业务状态。
- `ComponentRole` 只写角色，不写真实项目组件名。

请确保原型可以本地打开并体验主要交互。若有不明确的地方，请先反问。
````

## 三、Arch / Dev 怎么调整

路径 A / D：现有 `arch_prompt.md` 和 `dev_prompt.md` 已覆盖，不需要额外调整。

路径 B / C：在现有流程基础上增加 HTML prototype 翻译信号。

### Arch 调整

1. `spec/app_design.md` 的 `## UX/UI 输入` 固定段落追加：

```markdown
- HTML prototype: <prototype 目录路径>
- HTML prototype mode: initial-build | redesign
- HTML prototype scope: full | <模块名>（路径 C 填写局部范围）
```

2. 首个 UI feature 或局部重做 feature 的 `dev_do` 末尾，在 `[ui-init: <品牌名>]` 后追加：

```text
[html-prototype: <path> mode=initial-build|redesign]
```

3. 路径 C 局部调整时：

```text
[html-prototype: <path> mode=redesign scope=<模块名>]
```

4. MODE B 验收 checklist 追加：
- Dev 是否读取了 `index.html` / `pages/*.html`、`handoff-map.md`、`ui-data-contract.md`、`prototype-tokens.css`、`prototype-components.css`、`logic.js`
- Dev 是否先写 `spec/ux_prototype_trans.md`
- Dev 是否写出 route / data / action / interaction / component / token / logic 映射
- Dev 是否记录无法映射的 `Open Mapping Issues`
- Dev 是否保留人类确认过的原型交互和关键状态
- Dev 是否说明哪些内容 reused / rewritten / discarded

### Dev 调整

翻译前不要直接改代码。先通读原型和真实项目，写一份 `HTML Prototype Translation Plan`，保存到真实项目的 `spec/ux_prototype_trans.md`。同一项目可能多次收到 `html-prototype`，每次在该文件中追加一个独立章节，用 feature id / dev_do 摘要 / 原型路径区分，不覆盖旧计划。

Dev 执行时只看两种 `mode`：
- `initial-build`：从 HTML 原型新建复杂 UI，策略是 `scaffold-first`。先建立真实 App Router route、view model、component、token/CSS 主干，再接真实 API / server action。
- `redesign`：当前项目全部或局部 UI 重做，策略是 `replace-in-place`。先盘点现有 route / component / API / lib，明确 reuse / replace / keep-untouched，再局部翻译，避免重写已有系统。

1. 先读：
- 原型：`index.html` / `pages/*.html`、`handoff-map.md`、`ui-data-contract.md`、`prototype-tokens.css`、`prototype-components.css`、`logic.js`
- 真实项目：App Router 路由、API route handler / server action、已有 UI 组件、现有 token / globals.css、相关 `src/lib` 纯函数

**翻译计划模板：**

````markdown
### HTML Prototype Translation Plan - <feature/task/prototype>

- prototype: <目录路径>
- task: <feature id / dev_do 摘要 / 第几次 html-prototype>
- output: spec/ux_prototype_trans.md
- mode: initial-build | redesign
- strategy: scaffold-first | replace-in-place
- scope:
  - include: <本次明确要翻译/替换的页面、组件、样式>
  - exclude: <本次明确不碰的页面、组件、业务逻辑>

#### Mode Rules

- initial-build: 先建真实 route / view model / component / token-CSS 主干，再接真实 API / server action；不能从原型 mock 字段反推数据库/API。
- redesign: 先盘点现有 route / component / API / lib；默认 backend frozen，不改 API / db / scheduler / 已有业务逻辑；真实项目的数据对象、API contract、鉴权和业务规则是 source of truth。
- prototype interactions: 已由人类确认，必须逐项落到真实页面/组件；映射不上写入 `Open Mapping Issues`，不能静默删除。

#### Existing Inventory（redesign 必填，initial-build 可简写）
| 真实项目对象 | 当前职责 | 决策 | 备注 |
|---|---|---|---|
| <route/component/API/lib/css> | <现有用途> | reuse / replace / keep | <保护点> |

#### Mapping
| 类型 | 原型内容 | 真实项目落点 | 处理方式 | 问题 |
|---|---|---|---|---|
| route | <candidate route/view> | <real path> | reuse / new / replace | |
| data | <prototype field> | <API field / derived field> | adapter / direct / todo | |
| action | <prototype action> | <API route / server action / client handler> | map / todo | |
| interaction | <state / behavior> | <real implementation> | keep / adapt / todo | |
| component | <prototype component> | <target file> | reuse / new / replace | |
| token/css | <prototype token/CSS section> | <theme/globals/component CSS> | map / rewrite | |
| logic | <prototype function> | <real lib/API> | reuse / rewrite / discard | |

#### Open Mapping Issues
| 原型内容 | 映射问题 | 临时处理 | 需要人类确认 |
|---|---|---|---|

#### Execution Order
1. <先做基础类型/adapter/纯函数>
2. <initial-build: 建 page shell；redesign: 锁定要替换的真实组件>
3. <翻译组件并接真实数据>
4. <处理 token/CSS 并轨>
5. <关键状态自查 + 回归路径>

#### Regression Points
- <已有功能/页面/交互不能被破坏的检查点，redesign 必填>
- <需要回归的真实 URL 或用户路径>
````

2. 按计划执行：
- 先建类型、adapter、纯函数，再翻译页面和组件。
- `mode=initial-build`：先建立真实页面/组件/数据链路主干，再做视觉细节。
- `mode=redesign`：后端冻结；先保护已有数据模型、API、鉴权、业务规则和样式边界，再替换局部 UI。
- `mode=redesign`：原型交互已由人类确认，不能静默删除。字段或 API 映射不上时，先在 `spec/ux_prototype_trans.md` 的 `Open Mapping Issues` 记录，最终 Delivery 汇总给人类。
- 用原型 HTML 对齐视觉和关键状态，不用原型反推真实数据结构。
- 如果计划中发现原型信息不足，记录到 `Open Mapping Issues`，不要硬猜。

3. 禁止带入：
- `var` 全局变量
- `document.getElementById` / `querySelector` / `innerHTML`
- `setTimeout` 假后端
- 原型 hash router / 伪路由状态机
- `.design.json` 等设计工具文件
- 与真实项目冲突的 global reset
- 未映射到语义 token 的 hardcoded hex

## 四、原型产出质量判断

Dev 收到 HTML 原型后，先判断它是"可翻译规格包"还是"只能作截图参考"：

| 检查项 | 合格 | 不合格 |
|---|---|---|
| Next.js 友好 | 有候选 route mapping + `handoff-map.md` | 只有 hash view，没说页面边界 |
| 数据契约 | `ui-data-contract.md` 写了 view model、来源类型、枚举、状态触发 | 只有 mock 数据，没有字段语义 |
| 组件边界 | HTML 每个关键块有 `COMPONENT` 注释、props、states、component role | 只有视觉 div 或 `data-component` |
| token 语义 | 使用 portable semantic tokens，hex 只在 seed tokens | 组件 CSS 到处写颜色/阴影/半径 |
| CSS 可并轨 | token 与组件 CSS 分文件，组件 CSS 按组件分区、带 namespace | 全部内联或全局 class 污染 |
| 逻辑可迁移 | `logic.js` 是纯函数，带输入输出样例 | DOM 操作和算法混在一起 |
| 状态覆盖 | loading/empty/error/disabled/success/业务状态有真实 HTML 示例 | 状态只在文档里提到 |
| 不编造真实项目 | 没有声称真实 API/字段/组件/token | 写了未经提供的真实 API 或组件名 |

三项以上不合格时，不进入翻译合并，只作为视觉参考；Dev 应按真实项目结构自行实现。