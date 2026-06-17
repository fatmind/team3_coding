# Module 3: Node 调度进程（Daemon）

## 一句话

跑在用户本地的常驻 Node 进程，纯本地三件套（Web / Daemon / Claude Code）中的 Daemon **调度中枢**：人 ↔ Agent ↔ Agent 之间的消息转发，调度 claude code。

> 稳定性原则遵循 `spec/app_stability.md`：三层守护、消息总线约束、异常可见。

## 架构思路

### Agent 调度模型

- 每个 Agent 一个独立的 FIFO 消息队列：单 Agent 串行，上一次 claude 进程未退出前，新消息进队列等待，执行时一次性合并入 prompt（多条消息拼接，顺序保持）
    - TODO：人类消息 "中断运行、提前插入" 机制，本期不做
- 同一个 Agent 不并发，不同 Agent 间并行（Arch / Dev / UAT 各自独立队列、独立执行）
- Agent 和 claude code session 关系
    - arch：见 @spec/module_4_hardening.md [问题 2]
    - uat：1 个 Story : 1 个 claude code session；新 Story 用 `uat_check` 新建 session，该 Story 的 product_issue 重验用 `uat_fix` 复用这个 session
    - dev：1 个 Agent : N 个 claude code session，当 arch 分配 dev 新任务时、生成新的 sessionId
- Agent 启动
    - 初始化 arch / uat：提供 init_agent 接口，**生成 uuid** 作为 sessionId（claude code 强制要求 `--session-id` 是合法 UUID），更新 .team3-project.json，bash 命令直接启动 arch、uat
    - 注意：启动 arch 时，通过 -p "写 actions.jsonl，通知人类 [arch 已在线，我们开始讨论吧] " 要求 arch
    - dev 由 arch 根据任务情况决策，是新建 session 启动、还是 resume session 启动
- **sessionId 取值规则**：
    - **格式**：必须是合法 UUID（v4，小写），claude code `--session-id` 不接受其它形式，否则报 `Invalid session ID. Must be a valid UUID.`
    - 持久化存储在 .team3-project.json 文件中
    - 接收方是 arch：固定取 `arch_agent.session.runing`
    - 接收方是 uat，**新任务 action:uat_design / uat_check**：生成新 uuid 作为 sessionId，把旧的 `uat_agent.session.runing` 归档到 `done[]`，且更新 `runing` 为新值
    - 接收方是 uat，**当前 Story 重验 action:uat_fix**：沿用当前 `uat_agent.session.runing`（不变），仅限于 product_issue 修复后的失败 Story 重验
    - 接收方是 dev，**新任务 action:dev_do**：**生成新 uuid** 作为 sessionId，把旧的 `dev_agent.session.runing` 归档到 `done[]`，且更新 `runing` 为新值
    - 接收方是 dev，**当前任务的问题修复 action:dev_fix**：沿用当前 `dev_agent.session.runing`（不变），仅限于 Arch 验收 Dev 交付不通过的情况下
    - 注意：uat 验收 module 时，若不通过 -> 通知 arch（注：此前多个 feature 已通过，需要综合处理） -> arch 用 dev_do 起新 session 去解决


### 转发 人 ↔ Agent ↔ Agent 之间的消息

- 详见 module_1 <群聊数据流>
- daemon 与 web 间：通过 ws 通信
- daemon 与 claude code 间：通过 bash 命令通信
```bash
# 新 sessionId → 创建（sessionId 必须是 uuid）
claude -p "..." --session-id "b9f7e67b-6fa2-47ed-91d3-3d9b4c9b8ea3" --system-prompt-file spec/agents/arch_prompt.md --output-format stream-json
# 已存在的 sessionId → resume
claude -p "..." --resume "b9f7e67b-6fa2-47ed-91d3-3d9b4c9b8ea3" --system-prompt-file spec/agents/arch_prompt.md --output-format stream-json
```
- 监测 actions.jsonl 变化，转发消息
    - daemon 是 actions.jsonl 的 reader+router，仅在 dead letter / reply fallback / validation-error 时通过 appendFileSync 写入（详见 @spec/app_stability.md [消息总线写入端约束]）
    - web（人类）或 Agent 消息写入 actions.jsonl → chokidar 监测到新行 → 解析、入对应 Agent 队列 → 调度 spawn claude
    - 仅当 from ∈ {arch, dev, uat} 时通过 ws 推 web（人类消息 web 已自显示，不回推，避免重复）

- 按照 to 不同，改写 message
    - 场景 1：末尾 reread 协议
        - to=human：去掉 reread 部分
        - to=arch：保留全部
        - to=uat：从 reread 去掉 module_X_feature_list.json / module_X_progress.txt
        - to=dev：保留全部

### 本地记录 Agent 执行日志

- 每个 Agent 一个单独日志文件，by日滚动新建
- 本期记录原始日志，方便排查问题即可

### Agent stdout 实时广播

- daemon 解析 claude code 的 stream-json stdout，通过 WS 广播给 web 客户端
- **真实格式**：`{type:"assistant", message:{content:[{type:"text"|"thinking"|"tool_use", ...}]}}`（无 subtype 字段；thinking 取值 `block.thinking`，text 取值 `block.text`）
- stdout 原始 chunk 需行缓冲（`\n` split，保留 partial），只处理完整 JSON 行
- 解析器 `stdout-parser.js`：输入完整 JSON 行，输出 `[{content, tone}]` 或 null
  - thinking → `[思考] + 截断500字符`
  - text → 截断500字符，含 `✓`/`passed` 时 tone=success，含 `→` + action 关键词时 tone=mention
  - tool_use → `name + 参数摘要（file_path > command > description > query）`，tone=route
  - 其他（system/user/result）→ null，跳过
- WS 事件格式：`{type:'agent.log', role:'arch'|'dev'|'uat', lines:[{content, tone?}]}`
- web 端 `stdout-parser.ts` 与 daemon 版逻辑一致；`GET /api/project/agent-logs` 读日志文件尾部做历史初始化

### 系统健壮性与自动恢复

> 原则详见 @spec/app_stability.md。以下仅列出 Module 3 的**补充实现细节**，按 daemon 自身、agent 监控、数据三类组织。

#### 一、Daemon 自身

**Workspace 路径统一**：所有路径从 workspace root 统一推导，消除硬编码和 cwd 继承问题。
- spawn claude 时显式设置 `cwd: workspaceDir`，agent 不再继承 daemon 的 cwd
- `workspaceDir` 从 `projectJsonPath` 的 dirname 推导，贯穿 orchestrator → scheduler → logger
- `.daemon-state.json` 位置：`path.join(workspaceDir, '.daemon-state.json')`
- agent 日志目录：`path.join(workspaceDir, 'logs')`

**启动清理补充**：除通用孤儿清理（@spec/app_stability.md [孤儿进程清理]）外，额外检查 `dev_agent.session.done[]`——已归档 session 对应的进程仍存活 → SIGTERM 关闭。运行时 PID 追踪：AgentScheduler 每次 spawn 记录到 `spawnedPids`，进程退出时移除。

#### 二、Agent 监控

**Agent 超时配置**：可配置 `claudeInactivityTimeoutMs`（默认 5 分钟）。监听 claude 子进程 stdout data 事件，有输出则 reset timer；连续无输出达到阈值 → SIGTERM kill。与 30 分钟 wall-clock 超时独立运行，哪个先到就先 kill。待机唤醒保护见 @spec/app_stability.md [待机唤醒保护]。

**重试实现细节**：
- 消息 prepend 回该 Agent 队列最前面（不是 append），确保不丢失
- 消息携带 `_retryCount` 标记，避免无限循环
- Dead Letter 消息格式："Agent {role} 执行失败（{原因}），消息摘要：{前 200 字符}"
- Dead Letter 后该 Agent 队列恢复 idle，后续新消息正常处理

**Reply Fallback 实现细节**：
- 解析 stdout（`--output-format stream-json`），提取最后一个 `type: "result"` 事件的 `result` 字段文本
- 检查 actions.jsonl 在 **本次执行期间** 是否有该 role 的新写入行
- 有 → 不操作；无 → daemon 自动追加；stdout 为空 → 不操作

**Session 自动重建**：retry 路径检测 stderr 含 "No conversation found" → 生成新 UUID 写入 `runing`，并给本次 retry 消息加内存标记；下次自动用 `--session-id <新UUID>` 而非 `--resume <坏session>`。

#### 三、数据持久化

**`.daemon-state.json` 数据结构**：

```json
{
  "lastProcessingOffset": 12345,
  "lastUpdated": "2026-05-27 10:00:00"
}
```

- 文件截断（size < persisted offset）→ reset 为 0，从头读
- graceful shutdown 时写入最终 offset


## 验收场景

| # | 场景 | 验证要点 |
|---|------|---------|
| S1 | 启动 daemon 并连接 Web | 终端运行启动命令 → 进程启动成功输出端口 → `.team3-project.json` 中 `daemon_init` 进程 PID |
| S2 | 初始化 agent 并对话 | init_agent 接口，生成 uuid 作为 sessionId、格式合法 → 启动 agent → 对话成功，arch 通知人类 |
| S3 | Agent → Agent 消息路由 | arch 给 dev 发送消息，写入 actions.jsonl，daemon 监控文件变化、转发 dev 成功、dev 返回 |
| S4 | Agent → 人类（to_human） | arch 给 human 发送消息，daemon 监控文件变化、ws 转发 web 成功 |
| S5 | 人类 → Agent（to_arch） | 人类发送消息给 arch，web 写入 actions.jsonl，daemon 转发 arch 成功 |
| S6 | 消息队列排队 | arch 正在执行中，收到新消息 → 进入队列排队 → 下次一次性合并执行 |
| S7 | 断线重连 | daemon 运行中，web 关闭再打开，WebSocket 自动重连 |
| S8 | Agent 日志记录 | 正确记录每个 Agent 的执行日志 |
| S9 | Claude 进程超时自动 Kill | Agent 进程 hang 超过 30 分钟 → daemon 自动 kill + 重试 |
| S10 | Claude 进程崩溃自动重试 | Agent 进程非零退出 → 消息不丢失 + 重试 + 仍失败 dead letter 通知 |
| S11 | Agent 回复 fallback | Agent exit 0 但未写 actions.jsonl → daemon 从 stdout 提取回复自动补写 |
| S12 | Daemon 崩溃恢复 | Daemon 崩溃期间有新消息写入 → 重启后自动 replay 未处理消息 |
| S13 | 孤儿进程清理 | Daemon 崩溃后遗留 claude 子进程 → 重启时检测并清理 |
| S14 | CLI 写入工具 | agent 通过 write-action.mjs 写入 → 格式正确、单行、字段齐全 |
| S15 | Web 退出 → daemon co-exit | web 进程退出 → daemon 在 5s 内退出 |
| S16 | Web 崩溃 → daemon 自检退出 | kill -9 web → daemon 检测 ppid 变化 → 10s 内自退出 |
| S17 | Daemon offset 恢复 | daemon 处理 5 条消息后崩溃 → 重启 → 从第 5 条重新处理 |
| S18 | UAT per-story session | 3 个 `uat_check` → 3 个不同 sessionId；同一 Story 的 `uat_fix` → sessionId 不变 |
| S19 | 待机唤醒不误杀 | 挂钟偏移 > 2 倍 → 重新计时而非 kill |
| S20 | Crash handler | 内部 throw → handler 记日志 + 保存 state → exit(1) |
| S21 | 端口冲突恢复 | 旧 daemon 占端口 → 启动前清理 → 新 daemon 成功启动 |
| S22 | 多项目并行 | A 和 B 各启动 daemon → 不同端口 → 互不影响 |
| S23 | validation-error 通知 | 格式错误 → daemon 写 to_human → 人类收到通知 |
| S24 | double-SIGTERM | 快速两次 SIGTERM → shutdown 只执行一次 |
| S25 | Agent stdout 实时广播 | agent 执行中 → WS 收到 agent.log 事件 → lines 包含解析后的 content+tone |


## 技术栈

- WebSocket 库：`ws`
- 文件监听：`chokidar`
- 端口可配置（默认 3100，按 workspace hash 分配）
- TODO：daemon spawn claude 时设置 `CLAUDE_CONFIG_DIR=<project>/.claude`，让 session jsonl 等中间内容落到项目本地，便于打包迁移与项目间隔离。本期搁置（需先验证 OAuth credentials / 用户级 settings 是否被影响）。
- TODO：system prompt 在 session 首次创建时已绑定，resume 时是否仍需重传 `--system-prompt-file`，需验证 claude code 行为后决定是否始终带上

## 工程位置

`team3/daemon/`
