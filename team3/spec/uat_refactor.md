# 被开发产品 业务 UAT 重构结论

> 遵循 team3/spec/app_design.md 产品设计

## 已达成共识

### 1. 职责划分

| | team_coding3 自身 UAT | 被开发产品业务 UAT |
|---|---|---|
| 谁来做 | 人类手动 dogfooding | 自动执行 |
| 驱动者 | 人类 | UAT agent（Claude Code session） |
| UAT_PROMPT.md | MODE A 生成 uat_stories | MODE A + **MODE B 自动验证** |

### 2. UAT agent 是驱动者

- 收到 `uat_check` 后启动，读 `spec/uat_stories.md`，按 story → 场景逐步验证
- 脚本是工具，不是 driver
- agent 自己决定执行顺序、错误恢复、重试

### 3. 模拟人类

- 包装为一个脚本工具（`simulate_human.mjs`），内置 system prompt
- **一个 `claude -p` session** 模拟所有角色（群主、同学等），通过上下文切换
- session 必须复用（`--session-id` 首次，`--resume` 后续），保持上下文连贯
- 每次调用传入新上下文（当前场景、页面状态、要做什么）
- 不写死任何消息内容

### 4. 执行架构

```
UAT agent（driver）
  ├─ 调 simulate_human.mjs → claude -p 生成内容（）
  ├─ 生成 puppeteer 脚本，执行操作产品 UI
  ├─ 等待产品响应
  └─ 验证结果（按 uat_stories）
```

**已定**：`simulate_human.mjs` 只生成内容（决策/文本），UAT agent 自己写 puppeteer 代码执行 UI 操作

---

## scaffold 工具清单

> 项目 init 时拷贝到 `<workspace>/cli/`，UAT agent 直接 import 使用

| 工具 | 职责 | 为什么需要 scaffold |
|---|---|---|
| **simulate_human.mjs** | 包装 `claude -p`，内置 system prompt，session 管理，重试 | 复杂：session 生命周期 + 重试 + prompt 模板 |
| **logger.mjs** | 写 `<workspace>/logs/uat.log`，带时间戳 | 保证格式统一，方便和 daemon.log 对齐 |
| **watchdog.mjs** | 后台探针：daemon WS / web health / agent 进度 | 复杂：定时轮询 + 多探针 + 告警逻辑 |
| **browser.mjs** | puppeteer-core + 本地 Chrome 路径探测 | 易踩坑：Chrome 路径、headless 配置 |

其他（state 读写、等待轮询、进程管理）都是几行代码，UAT agent 自己写即可。

---

## 其他决定

- **cli 脚本路径**：`team3/cli/`（源码）→ initWorkspace 时 copy 到 `<workspace>/cli/`
- **init-workspace.ts**：项目创建时执行一次，拷贝 scaffold 到 `<workspace>/cli/`
- team_coding3 daemon/web 已在运行（是它发 uat_check 的），UAT 只需启动被测产品本身

---

## 经验教训（draft/uat_issue_opt.md）

- puppeteer-core + 本地 Chrome，不装 chromium
- spawn 用 `stdio: 'ignore'` + detached + unref
- daemon cwd 必须是 workspace（agent 用相对路径）
- daemon 必须 3100 端口（web hardcoded）
- Next.js 首次编译 15-25s，探针 45s 超时
- 跨 story 不清理环境
- 失败三要素：现象 + 期望 + 实际
- session：首次 `--session-id`，后续 `--resume`
- claude -p 超时：重试 2 次，fallback 静态消息
- UAT 工具异常 ≠ 产品 bug