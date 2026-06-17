# Team3 稳定性设计原则

本文档定义稳定性/高可用/技术约束层面的设计原则。Module 的具体实现必须遵循这些原则。

## 目标

无人值守运行，Agent 自主协作。任何一环异常不卡死流水线，要么自动恢复，要么通知人类。

**核心原则**：容忍重复执行（agent 自身有判断力），但绝不丢消息。

---

## 架构原则

### 三层进程，每层守护下一层

```
Web (全局 1 个，daemon 的 supervisor)
 │  正常退出 → SIGTERM 所有 daemon
 │  崩溃    → daemon 检测 ppid 变化 → 自退出
 │  重启    → 读 PID 文件清理残留 → 重新启动
 │
 ├─ Daemon A (项目级，claude 的 supervisor)
 │   │  claude hang  → 超时 kill + 重试
 │   │  claude crash → 重试 3 次 → dead letter 通知人类
 │   │  daemon 自身   → crash handler 保存状态 + health check 自恢复
 │   │
 │   ├─ arch (claude 子进程)
 │   ├─ dev  (claude 子进程)
 │   └─ uat  (claude 子进程)
 │
 ├─ Daemon B (另一个项目)
 └─ ...
```

**每层的职责边界**：
- Web 只管 daemon 的生死（启动、清理、co-exit），不管 agent 调度
- Daemon 只管 agent 调度和消息转发，不管 web UI
- Claude agent 只管执行任务，不管彼此的生命周期

### 消息总线：actions.jsonl

所有人和 agent 之间的通信都经过 actions.jsonl 这一条总线。daemon 是唯一的 reader + router。

**写入端约束**：
- Agent 通过 `cli/write-action.mjs` 写（格式校验 + 单行保证）
- Web 通过 `POST /api/chat/send` 写（server 端 JSON.stringify）
- Daemon 自身通过 appendFileSync 写（dead letter / fallback）

**读取端保障**：
- ActionWatcher 逐行读取、逐行推进 offset（处理完一行再前进一行，不跳到文件末尾）
- offset 持久化到 `.daemon-state.json`，语义 = "已处理到此处"
- 重启时从 offset 位置继续读，at-least-once delivery
- 校验失败的行不静默丢弃，写 `to_human` 通知人类

### 状态持久化与恢复

daemon 崩溃后，一切可从文件恢复：

| 状态 | 文件 | 恢复策略 |
|------|------|---------|
| 消息处理进度 | `.daemon-state.json` → `lastProcessingOffset` | 从此位置重读，容忍重复 |
| Agent session | `.team3-project.json` → `partner.*.session` | 自动 resume 或重建 |
| daemon PID | `.team3-project.json` → `init_daemon` | web 启动时清理残留 |
| 端口 | `.team3-project.json` → `daemon_port` | 每项目独立分配 |

### 异常可见，不静默吞错误

- Agent 写入格式错误 → validation-error → daemon 自动写 `to_human` 通知
- Agent 执行失败 → dead letter → 写 `to_human` 通知
- Agent exit 0 但没回复 → reply fallback → daemon 自动补写
- Daemon 崩溃 → crash handler 写日志 + 保存 state
- 所有关键事件 → 结构化日志记录

### 结构化日志

所有进程必须在关键节点记录结构化事件日志，格式统一：`[ISO时间戳] [TAG] 详细信息`，每行一条。

**Daemon 日志**（`<workspace>/logs/daemon.log`，`daemon-logger.js` 模块）：
- 事件标签：`[START]` `[STOP]` `[WATCH]` `[ROUTE]` `[DISPATCH]` `[DONE]` `[TIMEOUT]` `[RETRY]` `[DEAD_LETTER]` `[WS]` `[ERROR]` `[HEALTH]`

**Web 日志**（`~/.team3/logs/web.log`，`web/src/lib/web-logger.ts` 模块）：
- 事件标签：`[START]` `[API]` `[WS]` `[FILE]` `[WORKSPACE]` `[ERROR]`
- 所有 API route + health endpoint 记录 method / path / status / duration

---

## 已知问题 → 架构覆盖

Dogfood 实测的 8 个问题，逐个映射到架构的哪一层解决：

### 1. 跨行 JSON / 错误字段名 → 消息总线写入端约束

**问题**：arch 用 `body` 代替 `message`，或 `echo` 导致跨行 → 消息丢失 7.5 小时。

**架构覆盖**：`cli/write-action.mjs` 从写入端杜绝（校验 action/from/to 枚举值，ts 自动生成，JSON.stringify 单行 + appendFileSync 原子追加）。validation-error 通知从读取端兜底。3 份 agent prompt 约束：必须用此工具写 actions.jsonl。

### 2. lastProcessingOffset 丢消息 → 消息总线读取端保障

**问题**：处理前就跳到文件末尾，崩溃时丢消息。

**架构覆盖**：offset 逐行推进，处理完一行再前进一行。

### 3. 电脑待机 → 不是独立问题

**问题**：待机后消息没处理。

**架构覆盖**：根因是问题 1+2（消息写错 + offset 跳过）。daemon 在 33 分钟睡眠中存活（daemon.log 实证）。修复 1+2 后，待机的剩余风险是 inactivity timer 误杀 → 通过挂钟偏移检测覆盖（见 Claude 子进程守护原则）。

### 4. daemon 莫名退出，watchdog 没起作用 → 三层守护

**问题**：daemon 崩溃后无人重启。module_3 spec 设计的 bash watchdog 从未实现。

**架构覆盖**：
- Web 是 daemon 的 supervisor（替代 bash watchdog）
- crash handler 保存状态（替代静默退出）
- health check 改自恢复（替代自杀等重启）

### 5. UAT session 过长 → 已并入 @spec/module_4_hardening.md [问题 6 §3.D]

每个新 Story 一次 `uat_check`，新建 UAT session；同一 Story 的 product_issue 重验用 `uat_fix` 复用该 session。进度由 `uat/state.json` 承接，session id 仍在 `.team3-project.json`。

### 6. web 退出 daemon 跟着退出 → co-exit 设计

**问题**：co-exit 靠 EPIPE 副作用，不可靠。

**架构覆盖**：Web→Daemon co-exit 三层机制：正常退出发 SIGTERM，崩溃靠 ppid 检测（5s 周期），重启靠 PID 文件清理。stdio 写文件而非 pipe，防止 EPIPE 意外退出。

### 7. .daemon-state.json 子进程 PID 跟踪 → 已移除

**问题**：PID 走 debounce，崩溃前没 flush。

**结论**：`spawnedPids` 已移除。Claude 子进程是 `claude -p` 按需执行、完成即退出，不是长驻进程，无需跟踪 PID。Daemon 正常退出时直接 kill children（同进程组）；被 SIGKILL 时文件也来不及写，PID 跟踪覆盖不了这个场景。

---

## Web → Daemon 守护原则

### co-exit 机制

- 启动前清理旧实例：读 PID 文件 → SIGTERM → 等 3s → 仍存活则 SIGKILL
- stdio 写文件，不走 pipe（防 EPIPE 意外退出）
- 不 detach（daemon 是 web 的子进程，非独立守护）
- Web 退出时 kill 所有 daemon（SIGINT/SIGTERM 均触发 exit handler）
- 进程记录在 globalThis 上（存活 hot-reload），丢失时 PID 文件兜底清理

### 多项目端口分配

- 首次启动分配端口（`3100 + hash(workspace) % 900`），写入 `.team3-project.json` `daemon_port`
- 后续启动读取已分配端口
- EADDRINUSE 时自动 +1 重试

---

## Daemon 自我保护原则

### Crash Handler + Shutdown 防重入

- `shuttingDown` 标志防止 SIGTERM 重入
- uncaughtException / unhandledRejection → 记日志 + 同步保存状态 + exit(1)
- shutdown 10s 兜底强制退出

### Orphan 自检（覆盖 web 崩溃）

- 5s 周期检测 ppid 是否变化，变化则 daemon 主动退出

### Health Check（自恢复 → 再自杀）

- WS server 挂了 → 尝试重建
- actions.jsonl 不可读 → 等待恢复
- 自恢复 3 次失败 → `process.exit(1)`（web 下次交互时发现 daemon 死了 → 重启）

---

## Daemon → Claude 子进程守护原则

| 机制 | 触发条件 | 处理 |
|------|---------|------|
| 30 分钟 wall-clock 超时 | spawn 后计时 | SIGTERM → 5s → SIGKILL |
| 5 分钟 inactivity 超时 | stdout 无输出 | SIGTERM → 5s → SIGKILL |
| 非零退出重试 | exit code ≠ 0 | 消息 prepend 回队列，delay 5s，最多 3 次 |
| Dead Letter | 重试 3 次仍失败 | 写 to_human 通知人类 |
| Reply Fallback | exit 0 但未写 actions.jsonl | 从 stdout 提取 result 自动补写 |
| Session 自动重建 | stderr 含 "No conversation found" | 新 UUID，下次 --session-id |

### 待机唤醒保护

inactivity timer 回调中检查挂钟偏移：如果实际经过时间 > 设定阈值 × 2，说明系统经历了睡眠，应重新计时而非 kill。

---

## 极端场景验证

基于架构，模拟各种异常组合，检查是否有漏洞：

| 场景 | 事件序列 | 架构如何应对 |
|------|---------|------------|
| **Web 崩溃 + 立即重启** | kill -9 web → 新 web 启动 → startDaemon | 启动前清理读 init_daemon PID → SIGTERM 旧 daemon → 等退出 → 启动新 daemon。ppid 检测是兜底 |
| **Daemon 崩溃 + 消息堆积** | daemon 崩 → 3 条新消息写入 actions.jsonl → 用户重启 | offset 持久化在崩溃前最后一行 → 重启后从该位置读 → 3 条 + 可能 1 条重复全被处理 |
| **Agent 写错格式** | arch 用 body 代替 message | validation-error → daemon 写 to_human 通知人类 → 人类看到后让 arch 重发 |
| **笔记本合盖 30 分钟** | claude 正在执行 → 睡 30 分钟 → 唤醒 | inactivity timer 触发 → 检测挂钟偏移 > 2 倍 → 重新计时（不误杀）→ claude 继续执行 |
| **两个项目同时启动** | 项目 A、B 各点"启动 Daemon" | 端口按 workspace hash 分配 → 各自不同端口 → 互不干扰 |
| **Agent 进程 hang 住** | claude 进程活着但不输出 | 5 分钟 inactivity timeout → SIGTERM → 重试 → 3 次失败 → dead letter 通知 |
| **Daemon 内部 WS 崩溃** | WS server 异常关闭 | health check 检测 → 尝试重建 WS → 成功则继续 → 失败则 exit → web 下次交互重启 |
| **磁盘满** | actions.jsonl 写入失败 | write-action.mjs 报错 → agent 看到错误 → 自行重试。daemon 的 appendFileSync 抛异常 → catch 记日志 → 不崩溃 |
| **actions.jsonl 写一半断电** | 一行写到一半，文件缺尾部 | buffer 保存不完整内容 → 等下次写入拼接。若 daemon 重启 → offset 在行首 → 重新读 → buffer 重新拼 |
| **double-SIGTERM** | web 退出时发 SIGTERM → daemon stop 还没完 → 又收到 SIGTERM | `shuttingDown` 标志 → 第二次直接 return → 不重入 → 10s 兜底强退 |
| **Hot-reload (dev 模式)** | 改代码 → Next.js 重载 start-daemon.ts | daemon 记录在 globalThis 上 → 存活。即使丢失 → web 重启时 PID 文件兜底清理 |
