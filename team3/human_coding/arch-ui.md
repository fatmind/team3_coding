# UI / HTML Prototype 派发（Arch）

> 触发：MODE A 与人类讨论确认产品有 UI；或派发涉及 UI / HTML 原型的 feature。

## 讨论阶段要收集的（MODE A 第 1 步）

- **有 UI 时**：人类必须提供交互草稿图（存 `spec/ux_xxx.png`）+ **品牌名**。品牌让人类去 https://github.com/VoltAgent/awesome-design-md 选，只说名字（如 `mintlify`、`stripe`），**不提供色值**
- **复杂 UI / 大 UI 重做时**：如果人类提供外部 AI 生成的 HTML 原型包，记录原型目录路径和 scope。原型可以在项目外；它是可翻译 UI 规格包，不是真实项目源码
- 少数情况下，人类明确说"跳过 / 忽略 / 你自己选" → 你可以默认选 `mintlify`，但必须在 `spec/app_design.md` 固定段落里写明代选原因

## app_design.md 固定段落（有 UI 时必须包含）

```markdown
## UX/UI 输入

- 交互草稿图: spec/ux_xxx.png
- Brand: mintlify
- Brand note: <人类选择原因，或 Arch 代选原因>
- UI init: 首个 UI feature 由 Dev 执行 `node cli/init-ui-rules.mjs . --brand mintlify`
- UI prototype: <HTML 原型包目录路径，若无则写 none>
- UI prototype mode: initial-build | redesign | none
- UI prototype scope: full | <模块名> | none
```

## 派发规则（MODE A 第 6 步）

- **有 UI 且派发第一个 Feature**：先确认 `spec/app_design.md` 有 `## UX/UI 输入` 且包含 `交互草稿图` / `Brand`；缺失则先 `to_human` 补信息，不派发 UI feature。确认后在 `dev_do` message 末尾加 `[ui-init: <品牌名>]`，由 Dev 在首个任务初始化环境后执行 `node cli/init-ui-rules.mjs . --brand <品牌名>`
- **HTML prototype: initial-build**：用于从 HTML 原型包新建复杂 UI。确认 `spec/app_design.md` 的 `UI prototype mode` 为 `initial-build`，派发相关 feature 时在 `dev_do` message 末尾追加 `[html-prototype: <prototype 目录路径> mode=initial-build]`
- **HTML prototype: redesign**：用于当前项目全部/局部 UI 重做。确认 `spec/app_design.md` 的 `UI prototype mode` 为 `redesign`，派发相关 feature 时在 `dev_do` message 末尾追加 `[html-prototype: <prototype 目录路径> mode=redesign]`；局部重做必须追加 `scope=<模块名>`，即 `[html-prototype: <prototype 目录路径> mode=redesign scope=<模块名>]`
- HTML prototype 要求：Dev 必须先写 `spec/ux_prototype_trans.md`，再按计划翻译；Arch 不要求 Dev 把 HTML 当真实源码合并
