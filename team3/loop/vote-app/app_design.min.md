# App Design — 极简投票表单（vote-app · 回归精简版）

> 说明：本文件是**回归验证专用的精简设计**，用于快速跑通 team3 harness 全流程。
> 仅保留 **module_1 的 HTTP API**，且只实现 **创建问卷** 一个接口。前端页面、投票、
> 结果聚合、防重复、结束/超时等均**不在本次范围**。稳定后再换回完整设计。

## 产品定位

极度简化版"投票问卷"。本次只做**后端创建接口**：接收一份问卷定义，持久化到本地
JSON 文件，返回问卷 ID。无数据库、无前端页面。

## 核心用户价值

- **创建者**：通过一次 HTTP 调用创建一份多题问卷，拿到问卷 ID。

## 技术栈

- Next.js（App Router）+ React + TypeScript，全栈一体。
- API Route 读写本地 JSON 文件持久化，无数据库。
- `init.sh` 负责启停业务服务（Dev 首次创建）。

## API（本次唯一接口）

### 创建问卷 `POST /create`

- 请求体（JSON）：
  ```json
  {
    "title": "标题",
    "description": "描述（可选）",
    "questions": [
      { "text": "题干", "type": "single|multiple",
        "options": [ "选项A", "选项B" ] }
    ]
  }
  ```
- 行为：
  1. 校验 `title` 非空、`questions` 至少 1 题、每题 `text` 非空、`type ∈ {single, multiple}`、`options` 至少 2 项。校验失败返回 **HTTP 400**，`{ "error": "..." }`。
  2. 生成问卷 `id`（形如 `s_` + 12 位随机十六进制），为每题、每选项分配稳定 `id`（`q1/q2...`、`o1/o2...`）。
  3. 写入 `data/surveys/{id}.json`（见数据模型）。
  4. 返回 **HTTP 200**：`{ "id": "s_xxxx" }`。

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
    "status": "open",
    "deadline": null,
    "createdAt": "ISO8601"
  }
  ```

## Module 拆分

- **module_1 后端存储与创建 API**：文件存储层 + 问卷创建接口 `POST /create`（含入参校验）。可独立用 e2e HTTP 验收。

> **Feature 拆分引导**：建议拆 2 个 feature —— #1 搭建工程框架（脚手架 + 存储层 + init.sh），#2 `/create` 功能（接口 + 入参校验）。
> 不要把同一个接口的「成功主流程」和「入参校验」再拆开：一个不做校验的接口不算交付完成。
> feature 的边界是「能独立交付的价值」，不是「实现步骤」；把实现步骤拆成 feature 会让每个 feature 重复付出装依赖 / 编译 / 起停服务的固定开销。


## Module 依赖

- 无（本次仅 module_1）。

## UX/UI 输入

- 本次无前端页面，无 UI 需求。
