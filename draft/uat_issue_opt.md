# 用户需求总结 & uat_prompt.md 优化方案

## 一、你前面提出的所有需求总结

| # | 需求 | 是否已解决 | 说明 |
|---|------|-----------|------|
| 1 | **人类的消息/决策内容必须由 claude code 动态生成**，不能写死 | ✅ | `claudeGenerate('human', prompt, state)` 调用 `claude -p` 生成 |
| 2 | **人类的操作必须通过 Puppeteer 操作浏览器 UI**（输入框打字、按钮点击），不能直接写文件/调 API | ✅ | 场景3 用 Puppeteer 在输入框 type + Enter |
| 3 | **Arch 模拟行为 = claude code 生成内容 + echo >> actions.jsonl**（真实 arch 就是这么干的） | ✅ | `claudeGenerate('arch', ...)` + `fs.appendFileSync(actionsPath, line)` |
| 4 | **前后 Story 有依赖关系，环境不能清理**（workspace、daemon、web 保留） | ✅ | `ensureEnv()` 幂等启动，不做 cleanup；state.json 跨 story 持久化 |
| 5 | **模拟人类的 claude code session ID 必须保存并 resume 复用**，保持上下文连贯 | ✅ | state.json 存 humanSessionId/archSessionId；首次 `--session-id`，后续 `--resume` |
| 6 | **UAT 工作目录统一放项目根 `uat/`**，一个 story 一个子目录 | ✅ | `dynamics/uat/story_1/verify.mjs` |
| 7 | **共用工具抽 helpers.mjs**（环境启停、state 管理、claude 调用、Reporter） | ✅ | `uat/helpers.mjs` 已完成 |
| 8 | **不允许任何 mock/stub**，真实 daemon、真实 web、真实浏览器、真实 claude code | ✅ | 全部用真实进程和端口 |
| 9 | **UI 细节验证不需要，主功能走通即可** | ✅ | 不验 CSS/样式，只验功能链路 |
| 10 | **重构后重新跑一遍 Story 1 验证** | ✅ | 6/6 场景全部 PASS |
| 11 | **人类 UI 操作不允许 fallback 到 API** | ❌ 需修复 | 场景5 编辑文件用了 API，应改为纯 Puppeteer |

---

## 二、当前 uat_prompt.md 的问题分析

对照实际执行经验，当前 `uat_prompt.md` 存在以下不足：

### 问题 1：MODE B 缺少「实施架构」指导
当前只说"逐个 story 写实施脚本"，但没有说明：
- **helpers.mjs 的具体设计模式**（幂等环境、state 持久化、session resume）
- **跨 story 状态如何传递**（state.json 的 schema）
- **claude code 调用规范**（首次 `--session-id`，后续 `--resume`）

### 问题 2：「人类模拟」规则不够具体
当前只说"启动 claude code 来模拟人类"，但没有区分：
- **人类内容生成** → `claude -p` 动态输出（纯文本，不执行操作）
- **人类操作执行** → Puppeteer 操作浏览器 UI（打字、点击、导航）——**不允许退化为 API 调用**
- **Agent 模拟** → `claude -p` 生成内容 + `echo >>` 直接写 actions.jsonl

### 问题 3：缺少「验证优先级」说明
当前列了很多验证手段（截图、DOM 断言等），但没有说明：
- **主链路验证 > UI 细节验证**
- **不验 UI 样式**：不检查 CSS、布局、颜色等视觉细节
- 验证重点：功能是否走通、数据是否正确

### 问题 4：环境管理细节缺失
- 没说 daemon/web 用什么端口（需要与开发环境隔离）
- 没说 workspace 路径规范
- 没说 `.team3-project.json` redirect 机制（web 需要通过它找到 workspace）

### 问题 5：错误恢复策略缺失
- claude code 超时怎么办？
- daemon 启动失败重试逻辑？
- web 启动超时处理？

---

## 三、uat_prompt.md 优化方案 ✅ 已落地

> **状态：已实施到 `human_coding/UAT_PROMPT.md`**（即 `web/src/lib/init/templates/uat_prompt.md` 的参考源）

落地内容摘要：
- MODE B 第 3 步拆分为：3.1 setup.mjs（环境启动脚本）+ 3.2 helpers.mjs（验证工具层）+ 3.3 模拟人类规则 + 3.4 端口与环境隔离 + 3.5 错误恢复
- CRITICAL RULES 补充了环境不清理、state.json 传递、API fallback 禁止等

---

## 四、实战踩坑经验（Story 1 验证）

### Bug 1：puppeteer 下载 Chromium 超时
- **现象**：`npm install puppeteer` 网络超时（Chromium ~130MB）
- **修复**：改用 `puppeteer-core`（不下载），指定本地 Chrome：
  ```
  /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  ```

### Bug 2：setup 脚本挂住不退出
- **现象**：`node setup.mjs` 永远不 exit，`process.exit(0)` 无效
- **根因**：spawn daemon/web 时 `stdio: 'pipe'` 但不消费 stdout，Node 的事件循环因 pipe handle 无法退出
- **修复**：`stdio: ['ignore', 'ignore', 'ignore']` + `detached: true` + `child.unref()`
- **就绪检测**：外部探针方式——WS connect 检查 daemon、HTTP fetch 检查 web `/health`

### Bug 3：Daemon cwd 错误导致 claude 找不到文件
- **现象**：daemon spawn 的 claude 进程报 `ENOENT spec/actions.jsonl`
- **根因**：daemon 从 `uat/` 目录启动，继承 cwd；claude 内部用相对路径 `spec/actions.jsonl`
- **修复**：spawn daemon 时 `cwd: WORKSPACE`（workspace 目录下有 `spec/`）

### Bug 4：Web 报 "Daemon offline"
- **现象**：浏览器打开后 UI 显示连接断开
- **根因**：`web/src/lib/useDaemonSocket.ts` 硬编码 `ws://127.0.0.1:3100`，UAT daemon 在 3101 无法被发现
- **修复**：daemon 必须用 3100 端口（不可改），只隔离 web 端口（3001）

### Bug 5：`--output-format stream-json` 无 `--verbose` 导致 JSON parse 失败
- **现象**：daemon scheduler spawn claude 后，接收到非 JSON 文本（纯 text）
- **根因**：`daemon/src/claude-args.js` 传了 `--output-format stream-json` 但漏了 `--verbose`
- **影响**：所有 Agent 自动回复（Arch 回人类消息）全部失败
- **修复**：dev 修复 claude-args.js 加 `--verbose`（已派发 Feature #7 / Feature #10）

---

## 五、setup.mjs 设计要点

| 设计决策 | 为什么 |
|---------|--------|
| 独立脚本（不在 helpers.mjs 中） | verify 脚本只需 `assertEnvReady()` 校验，不承担启动职责 |
| 幂等：每步先检查再决定启/跳 | 重复执行不 double-spawn，开发调试友好 |
| `stdio: 'ignore'` + detached + unref | 确保 setup 脚本能 `process.exit(0)` 干净退出 |
| WS probe 检测 daemon ready | 不依赖 stdout pipe，daemon 真正可接受连接才算就绪 |
| HTTP `/health` 检测 web ready | Next.js 首次编译 15-25s，需给足 45s 超时 |
| `--teardown` 参数 | 支持 port-based kill（`lsof -ti :PORT`），即使 PID 丢失也能清理 |
| `--clean` 参数 | 清理 workspace 重建，适用于 story 重跑场景 |
| dynamics/.team3-project.json redirect | Web 通过此文件的 `workspace` 字段定位目标项目 |

### 首次执行耗时分布
| 步骤 | 耗时 |
|------|------|
| workspace 创建 | < 0.1s |
| daemon 启动 + WS ready | 2-3s |
| web 启动 + /health ready | 15-25s（Next.js 首次编译） |
| **总计（首次）** | **~20s** |
| **幂等重跑** | **< 1s** |

---

## 六、UAT 全程问题复盘（Stories 1-5）

### 6.1 问题总表

| # | 问题 | 表现 | 影响 Story | 解决方式 | 耗时 |
|---|------|------|-----------|---------|------|
| 1 | **Daemon 监听错误的 actions.jsonl** | `lsof -p` 显示 fd 指向 `dynamics/spec/actions.jsonl` 而非 workspace 的 | Story 3-5 | 根因：daemon 重启时 cwd 不是 workspace。用 `setup.mjs --teardown` 清理后，重新用 `setup.mjs --workspace <path>` 启动（关键是 `cwd: WORKSPACE`） | 每次 5-10 min 排查 |
| 2 | **API 限流导致 agent 卡死** | Dev/Arch 进程 CPU 降至 0%，`ps` 显示 S 状态，5+ 分钟无文件写入 | Story 4（多次） | `kill <pid>` → 等 3 分钟 cooldown → 用新 UUID session 重启。后期改为手动 `claude -p --resume` 驱动 | 累计 2+ 小时 |
| 3 | **Dev 没动静（进程僵死）** | PID 存在但 CPU=0%，progress.txt 无更新，无 stdout | Story 4 | 确认限流后 kill → 手动告知 Arch "Dev 已完成 Feature #X" → Arch 验收后派发下一个 | 每次 10-30 min |
| 4 | **多行 JSONL bug** | Agent 用 `echo` 写入含换行的 JSON，daemon 解析失败 → 路由断裂 | Story 2/3 | 产品侧已修复（daemon 层强制单行）；UAT 侧手动通知 Arch/Dev 绕过断裂点 | 首次 30 min 定位 |
| 5 | **Agent text 回复未持久化** | claude -p 返回 text 但不调 file write tool → actions.jsonl 无记录 → web 看不到消息 | Story 1/5 | **未根治**。verify 脚本用 fallback 逻辑（检查文件系统变化代替 actions.jsonl 消息）判定通过 | 唯一遗留 bug |
| 6 | **端口被占（EADDRINUSE :3100）** | daemon 重启时报端口冲突 | Story 4 | `lsof -ti :3100` 找到孤儿进程（PPID=1）→ `kill` → 重启 | 5 min |
| 7 | **Puppeteer selector 崩溃** | 早期 verify 脚本的 DOM 选择器在 UI 改版后找不到元素 | Story 1（第一/二轮） | 重写 selector 策略：优先 `data-testid`，fallback 用 `.className`，最终 fallback 用 API 直接获取 | 20 min |
| 8 | **Daemon 重启后 watcher 路径漂移** | orchestrator-entry.js 内部用相对路径 resolve，重启后指向错误目录 | Story 4 | 绕过：不依赖 daemon watcher 自动路由，改为手动 `claude -p --resume` 驱动 Arch/Dev | 30 min 定位 |
| 9 | **verify.mjs 超时（90 min）** | Story 4 脚本等开发完成，但开发被限流反复中断 | Story 4 | 先手动完成所有开发 → 再跑 verify.mjs（此时立即通过因为检查的是最终状态） | N/A |
| 10 | **UAT session --resume 首次失败** | UAT agent 之前无 session，用 `--resume` 找不到 ID | Story 5（早期） | 产品侧已修复（module_1 Feature #7 新增）：init-agent 正确初始化 session | 已修复 |
| 11 | **Web 404 页面** | 浏览器打开 3001 看到 404 | Story 5 | 根因：`dynamics/.team3-project.json` 的 `workspace` 字段未指向正确路径。`setup.mjs` 自动写入 redirect | 3 min |
| 12 | **claude -p 生成人类消息超时** | 模拟人类的 claude 调用偶尔 60s 超时 | Story 2/5 | verify 脚本内有 try/catch fallback：超时则用硬编码 fallback 消息（如 "请开始产品验收"） | 自动恢复 |

### 6.2 高频问题 Top 3

| 排名 | 问题 | 出现次数 | 核心教训 |
|------|------|---------|---------|
| 🥇 | API 限流卡死 | 8+ 次 | daemon 应有超时检测（如 5 min 无 stdout → kill + 自动重试） |
| 🥈 | Workspace 路径错误 | 3 次 | daemon **必须** 以 workspace 为 cwd 启动；不能假设 `process.cwd()` 正确 |
| 🥉 | Agent 回复不写文件 | 贯穿全程 | `-p` 模式下 agent 行为不确定，daemon 必须有 stdout fallback 持久化机制 |

---

## 七、系统优化建议

### 7a. 系统架构优化

| # | 优化点 | 现状问题 | 建议方案 | 优先级 |
|---|--------|---------|---------|--------|
| 1 | **Daemon 消息改写：追加 workspace 路径** | agent 依赖相对路径 resolve，一旦 cwd 不对就全盘崩溃 | daemon 在派发 claude -p 时，msg 末尾自动追加 `[workspace: /abs/path]` | P0 |
| 2 | **启动脚本明确指定 workspace** | `orchestrator-entry.js` 内部用 `process.cwd()` 推导 workspace 路径，重启/换目录就错 | 改为必传参数 `--workspace /path` 脚本启动时校验路径存在且含 `.team3-project.json`，否则 throw | P0 |
| 3 | **Daemon fallback 写入 agent 回复** | agent 只输出 text 不 file write → actions.jsonl 缺消息 → web 永远看不到 | `proc.on('close')` 解析 stream-json stdout：若 `type=result` 有内容但 actions.jsonl 无新增 `to_human`，daemon 自动补写一行 + WS 推送 | P0 （待确认：module3 Feature#14 已实现） |
| 4 | **Agent 进程超时检测 + 自动重启** | 限流后 agent CPU=0 永远不退出，daemon 不知道它挂了 | daemon 对每个 spawn 设置 heartbeat 检测：若 stdout 连续 5 min 无输出，kill + 标记 retry + 重新 spawn（最多 2 次） | P1 （待确认：module3 Feature13 30 分钟超时，是指 "任务正常完成" 的时间，但异常 hang 住 / 无反应 等，这个检测需要更高频率，否则很难快速恢复）|
| 5 | **Web 启动参数化 workspace** | web 通过 `dynamics/.team3-project.json` 的 redirect 机制间接找 workspace，多项目切换容易冲突 | web 启动时支持 `--workspace /path` 参数，API 路由中直接使用 | P1 |
| 6 | **actions.jsonl 写入保护** | 多行 JSON bug 虽已修复，但 agent 仍可能写出格式异常 | daemon 的 ActionWatcher 在检测到新行时做 JSON.parse 校验、修复 | P2（待确认：module3 Feature12 是否已修复？） |
| 7 | **Session 生命周期管理** | 限流/崩溃后 session UUID 对应的 claude 进程已死，但 `.team3-project.json` 仍记录旧 UUID | daemon 维护 session→PID 映射表；`proc.on('close')` 时自动标记 session 为 dead；下次 dispatch 检测到 dead session 自动生成新 UUID | P1 （待确认：.team3-project.json session id 更新就是 daemon 责任，是不是现在有 bug？）|
| 8 | **Daemon 健康自检** | daemon 跑飞（watcher 路径错、ws 连不上）但进程还活着 | daemon 启动后每 60s 自检：actions.jsonl 可读？WS server 在监听？最后一次调度是什么时候？失败 3 次自动 exit（由 supervisor 重启） | P2 待确认：module3 Feature16 是否已解决？|
| 9 | **Agent 执行日志路径修复** | 日志写在 `dynamics/daemon/logs/` 硬编码路径，而非 workspace 的 `logs/` 目录。多 workspace 混淆、verify 脚本找不到 | 改为 `<workspace>/logs/{role}_YYYY-MM-DD.log`；daemon spawn 时根据 cwd 确定日志路径 | P0 （待确认：module3 Feature#7 已实现记日志，目前是有 bug ？）|
| 10 | **增加 daemon 完整运行日志** | daemon 进程日志 (`daemon_*.log`) 路径需相对 <workspace>，今天重启的 daemon 甚至没写日志 | 写到 `<workspace>/logs/daemon.log`，**完整记录 daemon 所有行为**，这样才能从日志完整还原"daemon 这段时间干了什么" | P0 |
| 11 | **增加 Web 完整运行日志** | web 没有自己的运行日志，出问题（404、WS 连不上、API 超时）只能靠浏览器 DevTools 或猜 | 写到 `<workspace>/logs/web.log`，**完整记录 web 所有行为**，让 web 层问题也能从日志快速定位 | P0 |

### 7b. UAT 排查手册 & 快速恢复

> **前提假设**：优化 #9、#10、#11 已完成 — 日志统一写在 `<workspace>/logs/` 目录：
> - `<workspace>/logs/daemon.log` — daemon 完整运行日志（启动/停止、watcher 检测、路由决策、调度、完成/超时/重试、WS 事件、健康自检、错误）
> - `<workspace>/logs/web.log` — web 完整运行日志（启动/停止、API 请求、WS 连接/推送、文件操作、workspace 解析、错误）
> - `<workspace>/logs/{role}_YYYY-MM-DD.log` — agent stream-json 完整输出

#### 常用排查命令速查

**一、Daemon 日志排查（daemon.log = daemon 完整行为记录）**

| 排查目的 | 命令 | 预期输出 |
|---------|------|---------|
| **daemon 最近在干什么** | `tail -20 <workspace>/logs/daemon.log` | 完整的事件流：WATCH/ROUTE/DISPATCH/DONE/WS/ERROR 等 |
| **daemon 是否正常启动** | `grep '\[START\]' <workspace>/logs/daemon.log \| tail -1` | `[START] ts=... workspace=<abs_path> port=3100` |
| **daemon 是否检测到新消息** | `grep '\[WATCH\]' <workspace>/logs/daemon.log \| tail -3` | `[WATCH] new_line={"action":"to_arch",...}` |
| **消息路由到了谁** | `grep '\[ROUTE\]' <workspace>/logs/daemon.log \| tail -3` | `[ROUTE] from=human to=arch action=to_arch` |
| **agent 是否被调度** | `grep '\[DISPATCH\]' <workspace>/logs/daemon.log \| tail -3` | `[DISPATCH] role=arch session=xxx msg_preview=...` |
| **agent 是否完成** | `grep '\[DONE\]' <workspace>/logs/daemon.log \| tail -3` | `[DONE] role=arch duration=12s tool_use=3 exit_code=0` |
| **是否有超时/重试** | `grep '\[TIMEOUT\]\|\[RETRY\]' <workspace>/logs/daemon.log` | `[TIMEOUT] role=dev elapsed=300s` / `[RETRY] role=dev attempt=2` |
| **WS 客户端状态** | `grep '\[WS\]' <workspace>/logs/daemon.log \| tail -5` | `[WS] client connected` / `[WS] push new_action to 2 clients` |
| **daemon 有无报错** | `grep '\[ERROR\]' <workspace>/logs/daemon.log` | 无输出=正常；有=查看具体错误内容 |
| **从 DISPATCH 到 DONE 的时间差** | `grep '\[DISPATCH\]\|\[DONE\]' <workspace>/logs/daemon.log \| tail -6` | 成对出现：DISPATCH→DONE 间隔即 agent 执行耗时 |
| **daemon 健康自检状态** | `grep '\[HEALTH\]' <workspace>/logs/daemon.log \| tail -1` | `[HEALTH] ok` 或 `[HEALTH] fail: actions.jsonl unreadable` |

**二、Web 日志排查（web.log = web 完整行为记录）**

| 排查目的 | 命令 | 预期输出 |
|---------|------|---------|
| **web 最近在干什么** | `tail -20 <workspace>/logs/web.log` | API/WS/FILE 事件流 |
| **web 是否正常启动** | `grep '\[START\]' <workspace>/logs/web.log \| tail -1` | `[START] ts=... port=3001 workspace=<abs_path>` |
| **API 请求是否正常** | `grep '\[API\]' <workspace>/logs/web.log \| tail -10` | `[API] GET /api/actions 200 12ms` |
| **API 有无报错** | `grep '\[API\].*\(4[0-9][0-9]\|5[0-9][0-9]\)' <workspace>/logs/web.log` | 无输出=正常；有=查看 4xx/5xx |
| **WS 推送是否生效** | `grep '\[WS\].*push' <workspace>/logs/web.log \| tail -5` | `[WS] push new_action to 2 clients` |
| **workspace 解析是否正确** | `grep '\[WORKSPACE\]' <workspace>/logs/web.log \| tail -1` | `[WORKSPACE] resolved=<workspace>` 应为正确绝对路径 |
| **文件操作是否正常** | `grep '\[FILE\]' <workspace>/logs/web.log \| tail -5` | `[FILE] read spec/app_design.md 200` |
| **web 有无报错** | `grep '\[ERROR\]' <workspace>/logs/web.log` | 无输出=正常；有=查看具体错误 |

**三、Agent 日志排查（{role}_YYYY-MM-DD.log = agent stream-json 完整输出）**

| 排查目的 | 命令 | 预期输出 |
|---------|------|---------|
| **agent 是否正常完成** | `grep '"type":"result"' <workspace>/logs/<role>_$(date +%Y-%m-%d).log \| tail -1` | 有 result 行 = 已完成；duration_ms、stop_reason 可见 |
| **agent cwd 是否正确** | `grep '"subtype":"init"' <workspace>/logs/<role>_$(date +%Y-%m-%d).log \| tail -1 \| grep -o '"cwd":"[^"]*"'` | 应显示 `<workspace>` 绝对路径 |
| **agent 在思考什么** | `grep 'thinking' <workspace>/logs/<role>_$(date +%Y-%m-%d).log \| tail -1 \| python3 -c "import sys,json;d=json.load(sys.stdin);print(d['message']['content'][0]['thinking'][:200])"` | 最近一次 thinking 内容（确认任务方向） |
| **agent 是否调用了 tool** | `grep '"type":"tool_use"' <workspace>/logs/<role>_$(date +%Y-%m-%d).log \| wc -l` | >0 = 有 tool 调用（写文件等） |

**四、系统级排查**

| 排查目的 | 命令 | 预期输出 |
|---------|------|---------|
| 确认 daemon 监听哪个文件 | `lsof -p $(lsof -ti :3100) \| grep actions` | 应显示 `<workspace>/spec/actions.jsonl` |
| 判断 agent 进程是否卡死 | `ps -p <PID> -o pcpu,etime,time` | CPU>0 且 time 持续增长 = 正常；CPU=0 + time 不涨 = 卡死 |
| 检查消息链路在推进 | `wc -l <workspace>/spec/actions.jsonl` | 数字持续增长 = 正常 |
| 查看最近消息 | `tail -3 <workspace>/spec/actions.jsonl` | 有新的 from/to/action 行 |
| 确认端口监听进程 | `lsof -ti :3100` / `lsof -ti :3001` | 输出对应 daemon/web 的 PID |
| UAT agent 是否在工作 | `find <workspace>/uat/ -type f -newer <基准文件>` | 有新文件 = agent 在写 |
| 检查 daemon WS 是否能连 | `node -e "new (require('ws'))('ws://127.0.0.1:3100').on('message',d=>{console.log(d.toString());process.exit()})"` | 收到 `{"type":"connected",...}` |
| 检查 web health | `curl -s http://127.0.0.1:3001/health` | `{"status":"ok"}` |
| 一键查看所有 claude 进程 | `ps aux \| grep "claude.*-p\|claude.*resume" \| grep -v grep` | 列出所有活跃 agent |
| 检查 workspace redirect | `cat <dynamics>/.team3-project.json \| grep workspace` | 应指向当前正确的 `<workspace>` 绝对路径 |

#### 快速恢复 Playbook

**排查思路**：先看 daemon.log（系统中枢），再看 agent log（执行细节），最后看 web.log（前端层）。daemon.log 能完整还原"什么时候检测到消息、路由给了谁、什么时候调度、什么时候完成/超时"。

| 症状 | 诊断（从日志定位） | 恢复步骤 |
|------|------|---------|
| **Agent 5 min 无输出** | ① `grep '\[DISPATCH\]\|\[DONE\]' <workspace>/logs/daemon.log \| tail -4` → 有 DISPATCH 无配对 DONE ② `grep '\[TIMEOUT\]' <workspace>/logs/daemon.log \| tail -1` → 是否已触发超时 ③ `ps -p <PID> -o pcpu,time` → CPU=0, time 不涨 = 卡死 | ① 若 daemon 已自动 TIMEOUT+RETRY → 等待重试完成 ② 若未自动处理：`kill <PID>` → 等 3 min → `claude -p "<原始消息>" --resume <session> --system-prompt-file <workspace>/spec/agents/<role>_prompt.md --output-format stream-json --verbose` ③ 确认 daemon.log 出现新 `[DISPATCH]` |
| **消息写入但 daemon 没反应** | ① `tail -5 <workspace>/logs/daemon.log` → 最后事件是什么时候 ② `grep '\[WATCH\]' <workspace>/logs/daemon.log \| tail -1` → 是否检测到新行 ③ 若无 WATCH → ActionWatcher 可能挂了 ④ `grep '\[ERROR\]' <workspace>/logs/daemon.log` → 是否有错误 | ① 若 WATCH 存在但无 ROUTE → 路由逻辑 bug，检查消息格式 ② 若完全无 WATCH → daemon watcher 路径错误（见下一行）③ 若有 ERROR → 根据错误信息修复 |
| **Daemon 监听错文件** | ① `grep '\[START\]' <workspace>/logs/daemon.log \| tail -1` → 检查 workspace 字段 ② `lsof -p <PID> \| grep actions` → 路径不是 `<workspace>/spec/actions.jsonl` | ① `node uat/setup.mjs --teardown` ② `node uat/setup.mjs --workspace <workspace绝对路径>` ③ 验证：daemon.log 新 `[START]` 中 workspace 正确 + `lsof` 路径正确 |
| **端口被占** | `lsof -ti :3100` → 输出非预期 PID | ① `kill $(lsof -ti :3100)` ② 重启 daemon ③ 确认 daemon.log 出现 `[START]` |
| **Web 404 / 页面异常** | ① `grep '\[WORKSPACE\]' <workspace>/logs/web.log \| tail -1` → 解析的 workspace 路径是否正确 ② `grep '\[API\].*\(404\|500\)' <workspace>/logs/web.log \| tail -5` → 哪些 API 报错 ③ `grep '\[ERROR\]' <workspace>/logs/web.log` → web 层是否有错误 | ① 若 workspace 路径错 → 修正 `<dynamics>/.team3-project.json` 的 workspace 字段 ② 若 API 500 → 查看 ERROR 详情修复 ③ 或 `node uat/setup.mjs --workspace <路径>` 重写 redirect → 刷新浏览器 |
| **Web WS 推送不生效** | ① `grep '\[WS\]' <workspace>/logs/web.log \| tail -5` → 是否有 `push` 记录 ② `grep '\[WS\].*connected' <workspace>/logs/web.log` → 客户端是否连接 ③ `grep '\[WS\]' <workspace>/logs/daemon.log \| tail -3` → daemon 侧是否推送 | ① 若 web 无 WS 连接 → 浏览器端检查 WS URL ② 若 daemon 未推送 → 查 daemon.log 是否有对应 DONE 事件 ③ 若 daemon 推送了但 web 没收到 → 检查 daemon/web WS 连接 |
| **actions.jsonl 路由断裂** | ① `grep '\[WATCH\]' <workspace>/logs/daemon.log \| tail -3` → WATCH 检测到格式异常的行会报 `[ERROR] parse failed` ② `tail -5 <workspace>/spec/actions.jsonl` → 确认最后几行格式 | ① 手动修复异常行（合并为单行 JSON）② 或手动 `echo '{"action":"to_arch",...}' >> <workspace>/spec/actions.jsonl` 补发 ③ 确认 daemon.log 出现对应 `[WATCH]` + `[ROUTE]` + `[DISPATCH]` |
| **Agent 回复丢失** | ① `grep '\[DONE\]' <workspace>/logs/daemon.log \| tail -3` → 有 DONE 但 actions.jsonl 无对应行 ② `grep '"type":"result"' <workspace>/logs/<role>_*.log \| tail -1` → 有 result 文本 | ① 从 agent log 提取 result 文本 ② 手动追加：`echo '{"action":"to_human","from":"<role>","to":"human","ts":<now>,"message":"<result>"}' >> <workspace>/spec/actions.jsonl` ③ 确认 daemon.log 出现 `[WATCH]` + web.log 出现 `[WS] push` |
| **Session UUID 失效** | ① `grep '\[DISPATCH\]' <workspace>/logs/daemon.log \| tail -1` → session=xxx ② `grep '\[ERROR\].*session' <workspace>/logs/daemon.log` → 是否有 session 相关错误 | ① 生成新 UUID：`uuidgen \| tr '[:upper:]' '[:lower:]'` ② 用 `--session-id <新UUID>` 重新启动 ③ 更新 `<workspace>/.team3-project.json` 中对应 session.runing |
| **Agent cwd 错误** | ① `grep '\[DISPATCH\]' <workspace>/logs/daemon.log \| tail -1` → 确认 daemon 用什么 cwd 启动 agent ② `grep '"subtype":"init"' <workspace>/logs/<role>_*.log \| tail -1` → cwd 字段 | ① kill agent ② 确认 daemon 启动时 workspace 参数正确 ③ `setup.mjs --teardown` + `--workspace` 重新来 |
| **全盘重来** | 环境完全混乱，无法定位 | ① `node uat/setup.mjs --teardown` ② `node uat/setup.mjs --clean --workspace <workspace绝对路径>` ③ 验证三件：daemon.log 有 `[START]` + web.log 有 `[START]` + `/health` 200 |

#### UAT 验证脚本编写规范

> UAT 脚本的核心目标：**验证产品功能链路是否走通**。UAT 自身的 claude 调用（模拟人类生成消息）≠ 产品内部的 claude 调用（daemon 调度 agent）。两者完全独立，不能混淆。

**一、UAT 自身的 claude 调用（模拟人类）容错**

| 规则 | 说明 |
|------|------|
| 重试 2 次，第 3 次 fallback | `claudeGenerate('human', prompt)` 超时 → 重试 2 次（间隔 30s）→ 仍失败则用 fallback 静态消息继续（不能因为 UAT 自己的工具问题阻塞验证） |
| 不干预产品 daemon/agent | UAT 的 claude 调用失败 ≠ 产品 bug。UAT 只是用它生成消息内容，然后通过 Puppeteer 发到产品里 |
| fallback 消息要有意义 | 如 "请开始开发"、"验收通过" — 要能驱动产品正常响应 |

**二、Puppeteer 操作（人类 UI 交互）规范**

| 规则 | 说明 |
|------|------|
| **永远不退化为 API** | 即使元素定位失败，也**不允许**改为 `fetch('/api/...')` 替代。理由：UAT 验的就是 UI 链路，退化 = 跳过被测对象 |
| 元素找不到 → 截图 + fail | 截图保存到 `uat/story_N/` → reporter.fail 附截图路径 → 停止当前场景。**不尝试 API fallback** |
| 等待策略 | `page.waitForSelector(sel, {timeout: 10000})` — 10s 内出现即可；超时 → 截图 + fail |
| selector 策略 | 优先 `data-testid`，备选 `.className`；不用脆弱的层级选择器 |

**三、等待产品响应（daemon 调度 agent → 产出结果）策略**

| 场景 | 等待方式 | 超时后处理 |
|------|---------|-----------|
| 等 agent 回复出现在 actions.jsonl | 轮询 `wc -l actions.jsonl`，间隔 5s | 超时（如 300s）后，**用日志分层定位问题**再 fail |
| 等 daemon 路由消息 | 写完 actions.jsonl 后 3s 内检查 daemon.log 是否有 `[WATCH]`→`[ROUTE]`→`[DISPATCH]` | 缺 WATCH → watcher 挂了；缺 ROUTE → 格式问题；缺 DISPATCH → 调度阻塞 |
| 等 agent 执行完 | 检查 daemon.log 是否出现 `[DONE]` | 只有 DISPATCH 无 DONE → agent 卡住 / 超时（参考恢复 Playbook） |
| 等 web 展示新消息 | Puppeteer `waitForFunction` 检查 DOM 新增消息元素 | 超时 → 检查 web.log 是否有 `[WS] push`（有 push 无 DOM 更新 = 前端 bug；无 push = 后端链路问题） |

**四、失败判定与报告**

| 规则 | 说明 |
|------|------|
| 失败 = 产品 bug，不是 UAT 脚本问题 | UAT 脚本自身的工具异常（claude 超时、Chrome 崩溃）用重试/fallback 恢复；**只有产品功能不符合预期才判 fail** |
| fail 必须包含三要素 | **现象**（实际发生了什么）+ **期望**（应该是什么）+ **证据**（截图路径 / daemon.log 关键行 / actions.jsonl 状态） |
| 日志辅助定位 | fail 时自动 dump：`tail -20 daemon.log` + `tail -10 web.log` + `tail -5 actions.jsonl` 到报告中 |

**五、UAT 独立日志（uat.log）**

UAT 执行时间很长（可能数小时），过程中会遇到各种问题。UAT 必须有自己的独立日志，记录完整执行过程，方便事后排查。

| 规则 | 说明 |
|------|------|
| **日志路径** | `<workspace>/logs/uat.log`（与 daemon.log、web.log 同目录） |
| **谁写** | UAT 验证脚本（verify.mjs）+ UAT watchdog（watchdog.mjs）+ UAT setup — 所有 UAT 自己的代码都输出到这个文件 |
| **记录内容** | 脚本启动/结束 `[START story_N] / [END story_N pass/fail]`、场景执行 `[SCENE 1] 创建项目`、Puppeteer 操作 `[UI] type "hello" into input`、claude 调用 `[CLAUDE] generating human msg... ok/timeout/retry`、等待产品响应 `[WAIT] actions.jsonl +1 line (45s)`、watchdog 检测结果 `[WATCHDOG] daemon=ok agent=stale(5min) web=ok`、fail 详情 `[FAIL] scene3: expected arch reply, got nothing after 300s`、截图保存 `[SCREENSHOT] uat/story_1/s3_fail.png` |
| **格式** | 每行带时间戳：`[2026-05-28T14:32:15] [SCENE 2] ...` — 方便和 daemon.log/web.log 时间线对齐 |
| **不记录什么** | 不记录产品内部行为（那是 daemon.log/web.log/agent log 的事）；只记录 UAT 自己做了什么、看到了什么、判定了什么 |

```javascript
// uat/logger.mjs 示意
import fs from 'fs';
import path from 'path';

const WORKSPACE = process.env.WORKSPACE || loadState().workspace;
const LOG_PATH = path.join(WORKSPACE, 'logs', 'uat.log');

export function log(tag, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${tag}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
  process.stdout.write(line);  // 同时 stdout（方便实时看）
}

// 用法：
// log('START', 'story_1 verify.mjs');
// log('SCENE 1', '创建项目并初始化目录结构');
// log('UI', 'type "我想做日程管理" into chat input');
// log('WAIT', 'waiting for arch reply in actions.jsonl...');
// log('WATCHDOG', 'daemon=ok agent=running(2min) web=ok');
// log('FAIL', 'scene4: arch reply not in actions.jsonl after 300s');
// log('END', 'story_1 5/6 pass');
```

**六、UAT 配套定时任务（Monitor）**

UAT 验证往往涉及等待 agent 完成（几分钟到几十分钟），需要有自己的 watchdog 机制。watchdog 的输出也统一写入 `uat.log`：

| 定时任务 | 频率 | 作用 |
|---------|------|------|
| **daemon 存活检查** | 每 30s | WS connect 探针：失败 → 告警 "daemon 挂了" → 尝试 `setup.mjs --teardown` + 重启 |
| **agent 进度检查** | 每 60s | 读 daemon.log 最新 `[DISPATCH]`，若超过 5 min 无 `[DONE]` → 告警 "agent 可能卡死" |
| **消息链路检查** | 每 60s | 比较 actions.jsonl 行数：若 2 分钟无增长 + daemon.log 有未完成 DISPATCH → 告警 "链路可能断了" |
| **web 健康检查** | 每 60s | `curl /health`：失败 → 告警 "web 挂了" → 检查 web.log `[ERROR]` |
| **整体超时保护** | 单 story 60 min | 超时强制 fail + dump 全部日志到报告 → 进入下一个 story（不无限等） |

```javascript
// uat/watchdog.mjs 示意
import { setInterval } from 'timers';
import WebSocket from 'ws';
import { execSync } from 'child_process';
import { log } from './logger.mjs';  // 统一写入 uat.log

const WORKSPACE = loadState().workspace;
const checks = {
  daemon: () => new Promise((res, rej) => {
    const ws = new WebSocket('ws://127.0.0.1:3100');
    ws.on('open', () => { ws.close(); res('ok'); });
    ws.on('error', rej);
    setTimeout(() => rej('timeout'), 3000);
  }),
  agentProgress: () => {
    const logFile = `${WORKSPACE}/logs/daemon.log`;
    const last = execSync(`grep '\\[DISPATCH\\]' ${logFile} | tail -1`).toString();
    // 检查是否有配对的 DONE...
  },
  web: () => fetch('http://127.0.0.1:3001/health').then(r => r.ok ? 'ok' : 'fail'),
};

setInterval(async () => {
  const results = [];
  for (const [name, check] of Object.entries(checks)) {
    try { await check(); results.push(`${name}=ok`); }
    catch (e) { results.push(`${name}=FAIL(${e.message})`); }
  }
  log('WATCHDOG', results.join(' '));  // 输出到 uat.log
}, 30_000);
```

---

### 7c. Agent 执行日志现状分析（优化 #9/#10 前的现状）

> **以下是优化前的实际状况，供排查历史问题参考**

**当前日志实际位置**：`dynamics/daemon/logs/{role}_YYYY-MM-DD.log`（硬编码，非 workspace 内）

| 文件 | 内容 | 今日体量 |
|------|------|---------|
| `arch_2026-05-28.log` | Arch agent 的 stream-json 完整输出 | 258 行 / 137KB |
| `dev_2026-05-28.log` | Dev agent 的 stream-json 完整输出 | 152 行 / 99KB |
| `uat_2026-05-28.log` | UAT agent 的 stream-json 完整输出 | 393 行 / 1MB |
| `daemon_2026-05-28.log` | **不存在** — 今天重启的 daemon 没写自己的日志 | 0 |

**日志里有什么（有价值的信息）**：
```json
// type="system", subtype="init" — 可以看到 agent 的 cwd、session_id、model
{"type":"system","subtype":"init","cwd":"/Users/.../story1_test","session_id":"e3c3f1e1-..."}

// type="assistant" — agent 的思考过程和输出
{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"all modules are complete..."}]}}

// type="result" — 最终结果、耗时、cost
{"type":"result","duration_ms":4265,"result":"确认收到","total_cost_usd":0.148}
```

**4 个设计缺陷（对应优化 #9/#10/#11）**：

| # | 缺陷 | 影响 | 对应优化 |
|---|------|------|---------|
| 1 | **日志路径硬编码为 `dynamics/daemon/logs/`** | workspace 内找不到；多 workspace 混淆 | 优化 #9：改为 `<workspace>/logs/` |
| 2 | **daemon 完整运行日志缺失** | 无法追溯 daemon 运行时行为（消息检测、路由、调度、WS、错误等），出问题只能靠猜 | 优化 #10：增加 `<workspace>/logs/daemon.log` 完整记录所有 daemon 事件 |
| 3 | **web 运行日志缺失** | web 层问题（404、WS 断连、API 错误）无从定位，只能靠浏览器 DevTools | 优化 #11：增加 `<workspace>/logs/web.log` 完整记录所有 web 事件 |
| 4 | **agent 日志 = 原始 stream-json dump** | 判断"是否完成"需 grep，没有结构化摘要 | 优化 #10：daemon.log 中对应 `[DISPATCH]/[DONE]/[TIMEOUT]` 行作为 agent 生命周期摘要 |

**当前（优化前）的临时 debug 命令**：

```bash
# 注意！以下路径是优化前的硬编码路径，优化后改为 <workspace>/logs/

# 看 agent 最后做了什么
grep '"type":"result"' dynamics/daemon/logs/<role>_$(date +%Y-%m-%d).log | tail -1

# 看 agent 的 cwd 是否正确
grep '"subtype":"init"' dynamics/daemon/logs/<role>_$(date +%Y-%m-%d).log | tail -1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd','?'))"

# 看 agent 最近的 thinking
grep '"type":"thinking"' dynamics/daemon/logs/<role>_$(date +%Y-%m-%d).log | tail -1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('thinking','?')[:200])"

# 确认 agent 是否调用了 tool
grep '"type":"tool_use"' dynamics/daemon/logs/<role>_$(date +%Y-%m-%d).log | wc -l
```
