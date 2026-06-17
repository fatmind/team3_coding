# Module 1: Web UI 交互

## 一句话

人类与系统交互的唯一入口。固定侧边栏 + 面板切换的单页应用，让产品型开发者用 "群聊 + 文档 + 看板" 驾驭多 Agent 协作项目。

> 设计原则遵循 `spec/app_ux_awesome.md`：Mintlify 品牌 + StyleSeed 设计体系 + 桌面端适配。

## 布局架构

```
┌──────────────┬───────────────────────────────────────┐
│   Sidebar    │  Header: # project-name  [chat] [文档] │
│   (220px)    │────────────────────────────────────────│
│              │                                         │
│ [+ 新建项目]  │         Panel Content                  │
│ ──────────── │                                         │
│ # PROJECTS   │                                         │
│ # project-a  │    Slack 风格群聊 / 文档 / 模块进度     │
│   · 人类你说  │    / 开发过程 / Agents                  │
│   · 整体进度  │                                         │
│   · 开发过程  │                                         │
│   · Agents   │                                         │
│ # project-b  │                                         │
│ ──────────── │                                         │
│ 设置         │                                         │
└──────────────┴───────────────────────────────────────┘
```

侧边栏导航项嵌套在选中的项目下方（类似 Slack channel 展开），非选中项目只显示名称。

## 面板定义

| 面板 | 名称 | 内容 | Tab 切换 |
|------|------|------|---------|
| 面板 1 | 人类你说 | Slack 风格群聊 + 文档查看/编辑 | chat / 文档（顶部 tab） |
| 面板 2 | 整体进度 | Module 卡片 + Feature 列表（点击展开 Checkpoint 详情） | 无 |
| 面板 3 | 开发过程 | Module 选择器 + 工作日志（module_X_progress.txt），暗色 IDE 风格 | 无 |
| 面板 4 | Agents | Daemon 状态 + Agent 名称/图标编辑 + session 列表 + 启动 Daemon 按钮 + Agent 工作日志（实时 stream-json 摘要，ring buffer 80 行） | 无 |

面板 2/3/4 的 Header 只显示 `# project-name`，不显示 chat/文档 tab。

## 组件架构

```
app/
  layout.tsx              → 最小化（html/body + suppressHydrationWarning）
  page.tsx                → <Suspense><AppShell /></Suspense>
  globals.css             → 全量组件样式（单文件 ~1200 行）
  api/
    project/status/       → GET daemon 状态 + agent 配置
    project/agents/       → PUT 更新 agent 名称/图标
    project/init/         → POST 创建项目（支持已有目录）
    project/agent-logs/   → GET Agent 工作日志（读 log 文件 + stdout-parser 解析）
    ...（其余 API 不变）

styles/
  theme.css              → Mintlify 品牌 token（含 light + dark mode 全套变量）
  base.css               → 纯 CSS reset + reduced-motion
  fonts.css              → Inter + JetBrains Mono (Google Fonts)
  index.css              → 统一 import 入口

components/
  AppShell.tsx           → 顶层状态：projects / selectedProject / activePanel / activeTab
  Sidebar.tsx            → 侧边栏：品牌 logo + 项目列表（嵌套导航）+ 设置
  CreateProjectModal.tsx → 新建项目弹窗（支持已有目录）
  MainContent.tsx        → Header（# name + tabs）+ Panel body
  panels/
    ChatPanel.tsx        → Slack 风格群聊 + @mention 下拉 + WebSocket 实时消息
    DocPanel.tsx         → 文件树 + 文档查看/编辑
    ProgressPanel.tsx    → Module 卡片 + Feature 列表 + Checkpoint 展开
    DevProcessPanel.tsx  → Module 选择器 + progress.txt（暗色 IDE 背景）
    AgentsPanel.tsx      → Daemon 状态 + Agent 名称/图标编辑 + session 列表 + Agent 工作日志

lib/
  stdout-parser.ts       → stream-json 行解析（与 daemon 版逻辑一致）
  useDaemonSocket.ts     → WS 连接 + agent.msg / agent.log 事件处理
```

## 状态模型

### 全局状态（AppShell 管理）

| 状态 | 类型 | 说明 |
|------|------|------|
| `projects` | `ProjectInfo[]` | 所有项目列表（fetch /api/projects） |
| `selectedProject` | `string \| null` | 当前选中项目的 name |
| `activePanel` | `1 \| 2 \| 3 \| 4` | 当前活动面板 |
| `activeTab` | `'chat' \| 'doc'` | 面板 1 的 tab 状态 |

### URL 持久化

`/?project=<project-name>&panel=1&tab=chat`

使用项目 name（短标识）作为 URL 参数。刷新页面后恢复状态。切换项目/面板时用 `router.replace()` 更新 URL。

### WebSocket 与 Daemon 端口发现

**端口发现**：
- ChatPanel 通过 `GET /api/project/status?workspace=xxx` 获取 daemon port
- 状态 API 从 `.team3-project.json` 读取 PID 并 `process.kill(pid, 0)` 检测存活
- 端口通过 workspace 路径 hash 计算（3100-3999 范围）
- ChatPanel 拿到 port 后才发起 WebSocket 连接（`autoConnect: !!wsUrl`）

**离线处理**：
- Daemon 未运行 → ChatPanel 显示 "Daemon offline" 提示条
- Daemon 运行但 WebSocket 未连接 → 不显示提示（status API 已确认 running）
- 新消息通过 WebSocket 实时推送，断线重连后自动 refetch 全量历史

### Agent 配置

Agent 名称/图标存储在 `.team3-project.json` 的 partner 字段中：

```json
{
  "partner": {
    "human": { "name": "小明", "avatar": "👑" },
    "arch_agent": { "name": "张三", "avatar": "🏛️" },
    "dev_agent": { "name": "李四", "avatar": "🔧" },
    "uat_agent": { "name": "王麻子", "avatar": "🔍" }
  }
}
```

- 创建项目时随机生成有趣的中文名称 + emoji 图标
- AgentsPanel 支持点击编辑，通过 `PUT /api/project/agents` 持久化
- ChatPanel 通过 status API 获取配置，群聊中显示配置的名称
- 群聊头像始终使用 **彩色圆形 + 首字** 风格（不使用 emoji 作头像）

## 群聊数据流

- **唯一持久化数据源**：`spec/actions.jsonl`，所有消息（人类 + agent）最终都落 actions.jsonl
- 写入方只有两种：web（代表人类）和 Agent，daemon 不写只负责监测变化
- **增量更新，注意流向差别**：
  - 流向 1：人 → Agent：人在对话框输入 → web 更新对话区 → 写入 actions.jsonl → daemon 监测到 → 转发给 Agent
  - 流向 2：Agent → 人：Agent 写入 actions.jsonl → daemon 监测 → ws 推给 web 更新对话区
  - 流向 3：Agent → Agent：Agent 写入 actions.jsonl → daemon 监测 → 转发给目标 Agent + ws 推 web（为方便人类了解 Agent 进展）

## 文件读写（web 直读 fs）

```
浏览器                     web              本地文件
  │                            │                         │
  │── GET /api/files/list ────▶│── fs.readdir ─────────▶│
  │◀── 文件列表 ────────────────│◀── 目录内容 ─────────────│
  │                            │                         │
  │── GET /api/files/content ─▶│── fs.readFile ────────▶│
  │◀── { content, mtime } ────│◀── 文件内容 ─────────────│
  │                            │                         │
  │── PUT /api/files/update ─▶│── fs.writeFile ───────▶│
  │◀── ok ─────────────────────│◀── ok ──────────────────│
```

web 端直读项目本地 fs（daemon **不**做文件代理）。文件变更通过前端 mtime 自检处理。

## HTTP API

| 接口 | 用途 |
|------|------|
| `POST /api/project/init` | 项目目录结构初始化（执行 init script 由 module 2 负责实现） |
| `POST /api/chat/send` | 人类发送群聊消息，body `{action, to, message}`，server 端 append 到 actions.jsonl |
| `GET  /api/project/status?workspace=` | daemon 状态 + agent 配置（含 daemon_port） |
| `PUT  /api/project/agents` | 更新 agent 名称/图标 |
| `GET  /api/files/list?path=` | 列 spec/ 目录 |
| `GET  /api/files/content?path=` | 读单文件，返回 `{content, mtime}` |
| `PUT  /api/files/update?path=` | 写单文件 |
| `GET  /api/project/agent-logs?workspace=&role=&limit=` | 读日志文件尾部，解析 stream-json 返回 `[{content, tone}]` |
| `GET  /api/modules` | 读 modules_progress.json |
| `GET  /api/modules?mid=` | 展现单 module 进展详细，读 module_X_feature_list.json |
| `GET  /api/timeline?mid=` | 展现单 module 开发细节，读 module_X_progress.txt |
| `GET  /health` | 健康检查 |

### WebSocket 事件（daemon ↔ web）

- `agent.msg` —— daemon → web，Agent 写入 actions.jsonl 时推给 web，payload 为该行 jsonl 原文字符串。人类消息由 web 自己写自己显示，daemon 不回推
- `agent.log` —— daemon → web，Agent 的 stream-json stdout 解析摘要。格式 `{type:'agent.log', role, lines:[{content, tone?}]}`。前端按 role 分 buffer 存储，展示选中 agent 的日志
- `ping` / `pong` —— 心跳，双向保活；daemon 自己周期写 `.team3-project.json` 的 `daemon_heart` 字段

## 路由

单页应用，所有路由通过 URL 参数切换：

`/?project=<project-name>&panel=1&tab=chat`

## 项目创建流程

1. 用户点击侧边栏顶部「+ 新建项目」按钮
2. 弹出 Modal 对话框（CreateProjectModal）
3. 输入项目名称 + 父目录路径
4. 调用 `POST /api/project/init`（支持已有目录，idempotent）
5. 成功后关闭 Modal，刷新项目列表，自动选中新项目
6. Agent 名称/图标在 `initWorkspace` 中随机生成

## 交互细节

1. **侧边栏项目列表**：项目名以 `#` 前缀显示（Slack 风格），选中项展开导航
2. **面板切换**：即时切换，无动画（保持响应感）
3. **chat/文档 tab**：仅面板 1 Header 显示，其他面板不显示
4. **新建项目**：Modal 弹窗，ESC/点击外部关闭，支持已有目录
5. **无项目时**：主内容区显示引导文案
6. **面板切换时的状态**：非活动面板卸载（不保留 DOM），切回时重新 fetch
7. **面板加载态**：每个面板有 loading skeleton
8. **@mention 下拉**：输入框键入 `@` 时弹出 agent 列表，支持模糊过滤，选中后插入 `@name `
9. **消息中 @mention**：`to` 字段自动转为 `@name` 显示，行内 @xxx 高亮为品牌色
10. **连续同作者消息折叠**：不重复显示头像和名称
11. **启动 Daemon 按钮**：仅在 Panel 4（Agents）。Chat 面板离线时只显示提示文案
12. **开发过程**：progress.txt 使用暗色 IDE 风格背景（`--surface-code`），JetBrains Mono 字体

## 技术风险与缓解

| 风险 | 缓解 |
|------|------|
| 单页状态复杂 | 各面板独立组件，按需挂载（非活动面板不渲染） |
| WebSocket 连错端口 | ChatPanel 通过 status API 获取实际端口，而非依赖 props 传递 |
| StyleSeed 规则与桌面端冲突 | CLAUDE.md 中声明桌面端例外，跳过规则 13/14/触控目标（详见 app_ux_awesome.md） |
| API routes 不受影响 | 保持所有 /api/* 不变，新增 /api/project/status + /api/project/agents |
| 面板切换丢 state | 明确接受，重新 fetch 保证数据最新 |
| Module ID 格式不一致 | `modules_progress.json` 用 `id: 1`，文件名用 `module_1_*`，前端用 `toModuleId()` 统一转换 |
| 浏览器扩展注入 HTML 属性 | `<html>` 添加 `suppressHydrationWarning` 避免 hydration mismatch |

## 验收场景

| # | 场景 | 验证要点 |
|---|------|---------|
| S1 | 创建项目 | 工作目录创建成功（详见 app_design.md <项目工作目录结构>，由 module 2 实现），侧边栏显示新项目，自动选中 |
| S2 | 和 Arch 讨论产品想法 | 输入消息 → 群聊实时显示自己的消息 → Arch 回复，增量显示在对话区 → Arch 过程中若修改 xxx.md，自动 mtime 重载 |
| S3 | 人类编辑 spec 文件 | 切到文档 tab → 选中 module_1.md → edit → 保存 → 本地文件内容一致 → preview 显示新内容 |
| S4 | 查看所有 module 进展 | 面板 2（整体进度），卡片数据与 modules_progress.json 一致 |
| S5 | 查看某个 module 详情 | 面板 2 点击 module → 读取 module_X_feature_list.json，下方渲染展现 |
| S6 | 查看某个 module 工作过程 | 面板 3（开发过程），module 选择器 + progress.txt 展示 |
| S7 | Daemon 状态与 Agent 管理 | 面板 4（Agents），显示 daemon 运行状态、agent 名称/图标可编辑、session 列表 |
| S8 | WebSocket 端口发现 | ChatPanel 通过 status API 获取实际端口，正确建立 WS 连接 |
| S9 | @mention 交互 | 输入 @ 弹出下拉列表 + 快捷 chips 两种方式都可用 |
| S10 | Agent 工作日志 | Agents 面板日志区实时展示 agent stream-json 摘要，mount 时从 API 读最近 50 条初始化，WS 实时追加，每 agent 独立 buffer 80 行不增长，单条截断 500 字符 |

## 技术栈

| 层 | 技术 |
|----|------|
| Web / Server | 全栈 Next.js (App Router) |
| WS | 原生 WebSocket |
| 数据 | 直接读本地文件，不自建数据库 |

## 工程位置

`team3/web/`
