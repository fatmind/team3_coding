# HTML Prototype Translation 模板

> 当 `dev_do` / `dev_fix` message 含 `[html-prototype: <path> mode=initial-build|redesign]` 时，**必须先读完本文件**，再写翻译计划。

## 模板

```markdown
### HTML Prototype Translation Plan - <feature/task/prototype>

- prototype: <目录路径>
- task: <feature id / dev_do 摘要 / 第几次 html-prototype>
- output: spec/ux_prototype_trans.md
- mode: initial-build | redesign
- strategy: scaffold-first | replace-in-place
- scope:
  - include: <本次翻译/替换的页面、组件、样式>
  - exclude: <本次不碰的页面、组件、业务逻辑>

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
| data | <prototype field> | <API field / derived field> | adapter / direct | todo | |
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
```
