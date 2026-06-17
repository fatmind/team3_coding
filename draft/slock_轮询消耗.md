# Slock.ai 轮询消耗问题调研

> 2026-04-14 调研

## 问题

Slock Agent 在等待消息时（如 Architect 等 @fatmind 确认），进入每 5 秒一次的 Thinking → Checking messages 循环。每次循环都消耗一次 LLM API 请求，即使没有新消息。按 Coding Plan（1200 requests / 5 hours），这种空转几分钟就能烧掉大量配额。

## Slock 侧：暂无解决办法

搜索了 slock.ai 官网和相关渠道，**没有找到配置轮询频率、禁用自动检查、或在无新消息时跳过 LLM 调用的设置项**。Slock 目前是相对封闭的平台，用户可控的配置有限。

---

## 替代方案：OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) 是开源 AI Agent 框架（~140K GitHub stars），遇到过完全相同的问题，并且已经解决了。

### OpenClaw 遇到过同样的问题

[Issue #16808](https://github.com/openclaw/openclaw/issues/16808)（2026-02-14）：一个 Agent 在等待进程输出时，用相同参数调用 `process(action:log)` **1535 次 / 2 小时**，烧掉 ~$150，内存从 800MB 涨到 3GB 后崩溃。

### OpenClaw 的解决方案

**1. 轮询指数退避**（[PR #17118](https://github.com/openclaw/openclaw/pull/17118)）

轮询间隔从 5s 逐步递增：5s → 10s → 30s → 60s，而不是固定频率轮询。

**2. 循环检测看门狗**

跟踪每个 session 的工具调用模式：
- 10 次相同调用 → 警告
- 20 次相同调用 → 阻断执行
- 30 次无进展 → 全局熔断

**3. Heartbeat 模式替代持续轮询**

Agent 不持续轮询，而是用心跳机制定期唤醒：

```json
{
  "heartbeat": {
    "every": "30m",
    "model": "ollama/gemma3:1b",
    "escalateModel": "anthropic/claude-sonnet-4-6"
  }
}
```

关键点：
- 心跳检查用便宜/本地模型，发现有事才升级到主力模型
- 外部消息可通过 `openclaw system event --mode now` 立即唤醒 Agent，不需要等心跳
- 空闲心跳成本可降到 $0（用本地模型）

### OpenClaw Slack 集成

OpenClaw 原生支持 Slack 集成，用 Socket Mode（事件驱动）而非轮询：
- 有新消息 → Slack 推送事件 → Agent 被唤醒处理
- 没有消息 → Agent 完全静默，零消耗
- 支持多 Agent 路由：channel 绑定到特定 Agent，避免串扰

这从架构上消除了"空转轮询"问题。

---

## 替代方案：Clawith（OpenClaw for Teams）

[Clawith](https://www.clawith.ai/) 是基于 OpenClaw 的多 Agent 协作平台，更接近 Slock 的定位。

| 能力 | Slock | Clawith |
|---|---|---|
| Agent 持久记忆 | MEMORY.md | SOUL.md + Memory + Workspace |
| 多 Agent 协作 | Channel 内 @mention | Crew 机制 + Plaza 知识共享 |
| 任务管理 | Tasks tab | Focus Items + Triggers |
| 唤醒机制 | 持续轮询（问题根源） | Pulse 触发引擎（cron/webhook/消息监听） |
| 本地执行 | Machine daemon | 本地部署 |
| 自主调度 | 无 | Aware 系统（自适应触发器） |
| 开源 | 否 | 是 |
| 成本控制 | 无配置项 | 心跳模型分级 + 用量配额 |

Clawith 的 Aware 系统可以让 Agent 主动管理自己的关注项，用自适应触发器替代固定轮询，理论上不会出现 Slock 的空转问题。

---

## 结论与建议

| 方案 | 可行性 | 说明 |
|---|---|---|
| Slock 内解决 | ❌ 不可行 | 无配置项，平台封闭，等官方修复 |
| 迁移到 OpenClaw + Slack | ✅ 推荐 | 事件驱动架构，空闲零消耗，开源可控，社区活跃 |
| 迁移到 Clawith | ✅ 备选 | 更贴近 Slock 的多 Agent 体验，但需要评估成熟度 |

**如果继续用 Slock 的临时缓解**：
- Agent 执行完任务后手动让它 Offline，需要时再 Online
- 避免让 Agent 进入"等待确认"的场景，改为人确认后再 @Agent 触发下一步
- 关注 Slock 官方是否发布轮询优化更新

**如果迁移到 OpenClaw**：
- 核心概念映射：Slock Server → Slack Workspace，Slock Agent → OpenClaw Agent，Slock Channel → Slack Channel
- 工作流（Architect + Dev）可以完全复用，Agent Description → SOUL.md
- 本地执行能力保留（OpenClaw 天然本地运行）
- 需要自己搭建和维护，但换来完全的可控性
