# App Design — 极简投票表单（vote-app）

## 产品定位

极度简化版"腾讯问卷/投票"。用户可创建包含多道题的问卷，每题为**单选**或**多选**两种类型之一；他人通过链接投票；创建者与投票者可查看实时结果。本地文件存储，无数据库。

## 核心用户价值

- **创建者**：几分钟内做出一份多题投票问卷，拿到分享链接。
- **投票者**：打开链接即可作答，防止重复投票。
- **所有人**：结果页看到每题各选项票数、百分比、条形图与总投票数。

## 技术栈

- Next.js（App Router）+ React + TypeScript，全栈一体。
- API Route 读写本地 JSON 文件持久化，无数据库。
- 前端视觉：minimax 品牌规范（见下 UX/UI 输入）。
- `init.sh` 负责启停业务服务（Dev 首次创建）。

## 页面（用户动线）

1. **创建页 `/create`**：填标题/描述 → 逐题添加（选类型 单选/多选 + 增删选项）→ 可选设置截止时间 deadline → 提交 → 生成问卷 ID 和投票/结果分享链接。
2. **投票页 `/vote/[id]`**：加载问卷 → 单选 radio、多选 checkbox → 提交 → 跳结果页。已投过（同浏览器）或问卷已关闭 → 给出明确提示，不可再投。
3. **结果页 `/result/[id]`**：按题展示每选项票数 + 百分比 + 横向条形图，显示总投票数与问卷状态（开放/已关闭）。

## 数据模型（本地文件）

- 问卷结构：`data/surveys/{id}.json`
  ```json
  {
    "id": "s_xxxx",
    "title": "标题",
    "description": "描述",
    "questions": [
      { "id": "q1", "text": "题干", "type": "single|multiple",
        "options": [ { "id": "o1", "text": "选项A" } ] }
    ],
    "status": "open|closed",
    "deadline": null,
    "createdAt": "ISO8601"
  }
  ```
- 投票记录（追加写）：`data/votes/{id}.json`
  ```json
  [ { "voterId": "v_xxxx", "answers": { "q1": ["o1"], "q2": ["o2","o3"] }, "ts": 1700000000 } ]
  ```

## 关键规则

- **防重复投票**：投票者首次访问生成 `voterId`（localStorage 持久化 + 随请求提交）。服务端在 `votes/{id}.json` 中若已存在该 `voterId` 则拒绝（HTTP 409）。
- **投票开放控制**：`status=open` 且（`deadline` 为空或未过）才可投。手动结束 → `status=closed`；读取时若 `deadline` 已过，服务端视为已关闭并拒绝投票。
- **单选/多选校验**：单选题答案数组长度必须为 1；多选题长度 ≥ 1（服务端校验，非法返回 400）。
- **百分比口径**：单选/多选均以 `选项票数 / 总投票人数` 计算；多选各选项百分比之和可超过 100%。

## Module 拆分

- **module_1 后端存储与 API**：文件存储层 + 问卷创建/读取、投票提交（含防重复与开放校验）、结果聚合、手动结束/超时判定 API。可独立用 e2e HTTP 验收。
- **module_2 前端三页面**：创建页、投票页、结果页（minimax 视觉），依赖 module_1 的 API。

## Module 依赖

- module_2 依赖 module_1。

## UX/UI 输入

- 交互草稿图: none（人类明确表示功能简单，不提供草图，由 Architect 按标准三页面布局定义）
- Brand: minimax
- Brand note: 人类在需求中明确指定视觉选 minimax（getdesign.md/minimax）。初稿误写为 minimaxi，awesome-design-md 无该品牌（404），经人类 2026-07-09 确认为笔误更正为 minimax（DESIGN.md 200 可解析）。
- UI init: 首个 UI feature 由 Dev 执行 `node cli/init-ui-rules.mjs . --brand minimax`
- UI prototype: none
- UI prototype mode: none
- UI prototype scope: none
