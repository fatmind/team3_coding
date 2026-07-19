# Token 消耗优化方案

> 基于 vote-app 项目实测数据分析。
> 原则：只做 "无副作用" 改进——不影响任务执行质量、不需要验证集回归。

---

## 一、实测数据（vote-app 全流程）

### 日志字节分布

| 角色 | 日志总量 | tool_result | thinking(visible) | redacted_thinking | 其余(tool_use/text/result) |
|------|---------|------------|-------------------|------------------|---------------------------|
| Dev | 3.75MB (100%) | 2.03MB (54%) | 199KB (5%) | 456KB (12%) | 1.07MB (29%) |
| Arch | 1.80MB (100%) | 1.28MB (71%) | 38KB (2%) | 64KB (4%) | 418KB (23%) |
| UAT | 427KB (100%) | 294KB (69%) | 7KB (2%) | 17KB (4%) | 109KB (25%) |

### session 维度

| 角色 | session 数 | 总 turns | 总耗时 | context 利用率范围 |
|------|-----------|----------|--------|-------------------|
| Dev | 7 个独立 + 1 次 resume | 338 | 100 分钟 | 7%-16% |
| Arch | 2 个独立（797804b7 唤起 7 次、64702ee9 唤起 5 次） | 145 | 39 分钟 | 3.5%-18.2% |
| UAT | 6 个独立（设计 1 + 讨论/重写 2 + 执行 3） | 约 80 | — | 6.5%-13% |

### 工具调用

| 角色 | 总 tool 调用 | 错误次数 | 错误率 |
|------|-------------|---------|--------|
| Dev | 443 (Read 164, Bash 138, Write 59, TodoWrite 41, Edit 38) | 34 | 7.7% |
| Arch | 187 (Read 91, Edit 48, Bash 37, Write 9) | 20 | 10.7% |
| UAT | 211 (Read 81, Bash 77, Write 19, TodoWrite 19, Edit 9, Agent 3) | 23 | 10.9% |

### 路径幻觉

全流程（含 UAT）共 **40 次路径幻觉**，覆盖 **11/11 个新 session**（100% 复现率）。每次新 session 启动后首轮 Read 必定编造路径，错误前缀多达 7 种变体（从 `/Users/bytedance/...` 到 `/Users/bohan.sj/dev/vote-app/`）。session 内自修正后后续不再复发。

### UAT 阶段特有的浪费模式

UAT 除了上面的通用问题（路径幻觉、Read-before-Edit），还有几个角色特有的：

| 模式 | 说明 | 估算浪费 |
|------|------|---------|
| Sub-agent 输出过大 | review sub-agent 把"分析报告 + 修订后 story 全文"一次性返回，单条 tool_result ~6500 字符 | ~2000 tokens/次 |
| Sub-agent 读源码（违反黑盒） | review sub-agent 读了 7 个 src/ 文件来验证"UI 有没有关闭按钮"，违反 UAT 黑盒原则 | ~2500 tokens |
| verify.mjs 重复执行 | 首次 pass 后又完整重跑确认 exit code；Story 2 修改选择逻辑后全量重跑（仅改了一行） | ~1500-2000 tokens/次 |
| DOM 探测输出冗余 | probe.mjs 返回 40 行含 CSS Module hash class 名，实际只需 testid 列表 | ~1500-2000 tokens |
| Edit 大文件全文回显 | verify.mjs ~250 行，每次 Edit 回显全文，Story 2 有 7 次 Edit | ~15000 tokens（框架级） |

### Token 用量记录现状

实测：qodercli v1.0.41 的 `stream-json` result 事件里 `input_tokens: 0, output_tokens: 0, total_cost_usd: 0`——全是零，和 claude code CLI 一样。**两个 CLI 都不报真实 token 用量。**

要量化 token 消耗，只能自己统计。方案见 4.1。

---

## 二、两种 Thinking 是什么

Claude Code `stream-json` 输出里有两种 thinking 事件，都是 **output token**（output 比 input 贵 5 倍）：

| 类型 | 内容 | 能不能看 | 举例 |
|------|------|---------|------|
| `thinking`（visible thinking） | 模型的推理过程，纯文本 | 能看 | `"thinking": "I need to check if the file exists..."` |
| `redacted_thinking` | 模型的内部推理，被 Anthropic 加密 | 看不到，只有 base64 密文 | `"data": "VGhpcyBpcyBlbm..."` |

为什么有 redacted？Anthropic 出于安全考虑，模型的某些内部推理过程会被加密。你付了 token 钱，但看不到内容。

**vote-app 实测**：Dev 有 160 个 redacted_thinking 块（340KB base64 ≈ 255KB 原文），加上 77KB visible thinking，Dev 光 thinking 就约 332KB。

**当前不动 thinking**。原因：降 reasoning effort 或者在 prompt 里暗示"别想太多"，可能让模型在真正需要推理的地方犯错。没有自动化验证集之前，不确定改了会不会把质量搞坏。

---

## 三、tool_result 裁剪的边界

### 什么能裁剪、什么不能

tool_result 占日志 54-71%，但大部分是**必要的**——Read 返回文件内容、Bash 返回命令输出，agent 需要这些来做判断。

只有以下几类是"明确无用"的：

| 场景 | 为什么无用 | 举例 |
|------|----------|------|
| npm install 完整输出 | agent 只需知道成功/失败 | 几百行 added/resolved 日志 |
| next build 完整输出 | 成功时只需知道 pass，失败时只需最后几行错误 | 几十行 route 编译日志 |
| e2e 运行的完整 stdout | agent 只需知道 pass/fail + 失败的具体行 | puppeteer 的详细导航日志 |
| 500 错误页的完整 HTML | Next.js 的 stack trace + ANSI 码 | 几百行 HTML |
| ls -la 完整输出 | 通常 ls（不带 -la）就够了 | 权限、日期等无用列 |

以下**不能裁剪**：

- Read 文件内容（agent 要看内容才能写代码/做判断）
- Write/Edit 的 tool_result（框架行为，agent 不控制）
- Arch 验收时的 Read（协议要求独立审查）
- 关键 Bash 输出（git status、test 失败详情等）

### qodercli PostToolUse hook 可以裁剪 tool_result

qodercli 的 `PostToolUse` hook 支持 `updatedToolOutput` 字段，**可以替换工具返回内容**。[官方文档](https://docs.qoder.com/zh/cli/hooks#posttooluse)。

工作方式：tool 执行完 → hook 脚本收到 `tool_name` + `tool_response` → hook 判断是否需要裁剪 → 返回 `updatedToolOutput` 替换原始输出 → 模型只看到裁剪后的内容。

```javascript
// hook 返回格式
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "updatedToolOutput": "裁剪后的内容"
  }
}
```

直接用 hook 裁剪就行，不靠 prompt 约定（agent 不一定记得，hook 确定性高）。

---

## 四、无副作用改进清单

以下改动只有"省 token"的效果，不改变任务执行逻辑，不需要验证集回归。

### 4.1 Token 用量估算（daemon 改动）✅ 已实现

**现状**：qodercli 和 claude code CLI 的 result 事件都不报真实 token 数（全是 0）。无法量化消耗。

**方案**：daemon 在 `_processStdoutChunk` 逐行解析 stream-json 时按事件类型累加字符数，遇到 `result` 事件时在内存中把估算值回填到原本为 0 的 `usage` 字段，然后写入已有的 per-role daily log（`logs/<role>_<date>.log`）。不单独记文件，日志中 result 行直接就是带估算值的版本。

**字符分桶规则**：
- `system` / `user` → `inputChars += line.length`
- `assistant` → `turns++`，遍历 content blocks：thinking → `thinkingChars`，redacted_thinking → `thinkingChars`（按 base64 原始长度算），text → `outputChars`，tool_use → `outputChars`
- `tool_result` → `toolResultChars += line.length`
- `result` → 回填 usage + 附加 `_token_estimate` 详情

**result 事件回填结果**（原 usage.input_tokens=0 变为估算值）：
```json
{
  "type": "result", "subtype": "success",
  "usage": { "input_tokens": 205000, "output_tokens": 101250 },
  "_token_estimate": {
    "input_chars": 820000, "output_chars": 310000,
    "tool_result_chars": 580000, "thinking_chars": 95000,
    "turns": 60, "duration_s": 940
  }
}
```

token 估算公式：`chars / 4`（英文为主的混合文本粗估）。不精确，但量级和趋势可比，足够看出"哪个 session 消耗异常"。

**实现要点**：把 `agentLogger.write` 从 `proc.stdout.on('data')` 移入 `_processStdoutChunk`，按行写入日志（非原来的 chunk 写入），这样 result 行可以在写入前被替换。新增 `_processLineForStats(role, line)` 方法做分类计数 + result 改写。

### 4.2 路径幻觉：system prompt 加硬规则（prompt + daemon 改动）✅ 已实现

**现状**：新 session 首次 Read 100% 会编造路径（vote-app 全流程 11/11 新 session 全中招，累计 40 次），每次浪费 2000-5000 tokens。

**方案**：三个 prompt 文件（arch/dev/uat_prompt.md）顶部加占位符规则：

```
> 重要：本项目工作目录是 {cwd}。所有 spec/、src/、e2e/ 等路径必须基于此目录。严禁猜测或编造路径前缀。
```

两个 provider（claude-code / qoder-code）的 `buildArgs` 接收 `workspaceDir` 参数，在拼 `--system-prompt` 前做 `.replace(/\{cwd\}/g, workspaceDir)` 动态替换。scheduler 调用时传入 `this.workspaceDir`。

**为什么无副作用**：这本来就是对的，agent 应该用正确路径。加了只会减少错误，不影响正常执行。

### 4.3 "Read before Edit/Write" 强化（prompt 改动）✅ 已实现

**现状**：Arch 反复犯 "Edit 前没 Read" 错误（20 次 tool 错误里有好几次是这个），每次浪费 700-2500 tokens。

**方案**：在 Arch/Dev prompt 的 CRITICAL RULES 加一条：

```
- Edit / Write 覆盖已有文件前，必须先在本轮用 Read 工具读过该文件。Bash 的 cat/grep 不算，工具层只认 Read。需要改多个文件时，先一次性 Read 所有目标文件，再发 Edit。
```

**为什么无副作用**：Read 是必要前置步骤，加了只会减少无意义的错误重试。

### 4.4 派发 message 精简约定（prompt 改动）✅ 已实现

**现状**：Arch 的 `dev_do` / `uat_check` message 包含完整描述（~500-600 字），但同样内容已经在 spec 文件里。UAT 阶段 Arch 派发 Story 2 时嵌入了完整场景描述 ~600 字，而 uat_stories.md 里已有。

**方案**：在 Arch/Dev/UAT 的通用协议"发出消息时"段落下方加约定：

```
**消息精简约定**：
派发/交付消息保持精简（2-3 行），详情通过 spec 文件传递：
- dev_do：「请实现 module_X Feature #N，详见 spec/module_X.md」
- uat_check：「请执行 Story N，详见 spec/uat_stories.md」
- to_arch：「Feature #N 已交付，详见 progress.txt」
不要在 message 里重复文件中已有的完整描述。
```

**为什么无副作用**：详情已经落盘到文件，agent 会通过 reread 协议去读文件。消息只起"通知"作用。

### 4.5 Bash 输出自动裁剪（全局 PostToolUse hook）— 暂缓

**原始假设**：npm install / next build 等命令完整 stdout 全量进入上下文，动辄几十 KB，估算可省 ~10K-20K tokens。

**实测推翻**：分析 vote-app 全流程 256 次 Bash 调用（dev 138 + arch 41 + uat 77），数据如下：

| 大小区间 | 调用数 | 字符数 |
|---------|-------|--------|
| <1KB | 198 | 59,954 |
| 1-5KB | 51 | 110,223 |
| 5-10KB | 7 | 49,056 |
| >10KB | 0 | 0 |
| >20KB | 0 | 0 |

最大单条 Bash 输出仅 9,272 字符（~2,318 tokens）。**无论阈值设 20KB 还是 10KB，可裁剪的调用数为 0，节省 0 tokens。**

**为什么这么小？** 因为 team3 的 agent prompt（4.2/4.3/4.4）已经引导 agent 使用 `| tail -N`、`| head -N` 限制输出。vote-app 实测中，agent 几乎每条 Bash 命令都带了管道截断，根本不会产生超长输出。

**"独立使用 CLI"场景不存在**：team3 用户始终通过 daemon 启动 CLI，prompt 始终生效。不存在"绕过 team3 直接用 CLI"的使用路径。

**结论**：4.5 的 "~10K-20K tokens" 估算是基于理论分析（"如果 agent 不用 tail"），实测为 0。**暂缓实施**，等有真实超长 Bash 输出的项目案例再重新评估。

**tool_result 真正的大头**（参考）：

| 工具 | 内容字符 | 估算 tokens | 占比 |
|------|---------|------------|------|
| Read | 999,073 | ~250K | 72.8% |
| Bash | 219,233 | ~55K | 16.0% |
| Edit | 99,104 | ~25K | 7.2% |
| 其它 | 53,040 | ~13K | 3.9% |

Read 占 73%。但 Read 内容是 agent 做判断的必要输入，不能裁剪（已列入"暂不动"）。

---

## 五、暂不动的（需要验证集才敢改）

| 问题 | 为什么不动 | 潜在收益 | 什么时候动 |
|------|----------|---------|----------|
| Thinking 过重 | 降 reasoning effort 可能让模型在真正需要推理的地方犯错 | ~40K+ tokens/项目 | 有了自动化验证集后 |
| Edit/Write tool_result 全文回显 | Edit 返回 `originalFile`（全文），hook 可裁剪但需确认 agent 不依赖。vote-app UAT 阶段光 verify.mjs 的 7 次 Edit 回显就 ~15K tokens | ~15K-25K/项目 | 验证 agent 不依赖 Edit 返回全文后 |
| init 消息工具列表裁剪 | CLI 内部生成，daemon 无法控制。qodercli 可用 `--allowed-tools` 限制但可能影响功能 | ~3K-4K/session | 确认各角色实际用到的 tool 集合后 |
| Sub-agent 输出精简 | review sub-agent 应只返回 issue list，不要在内部做 story 重写 | ~2K-4K/轮 | UAT 协议优化时 |
| Dev 读文件范围过大 | 有些场景确实需要了解 API 实现细节 | 不确定 | 积累更多案例后 |
| progress.txt 滚动归档 | 改文件格式影响 Arch/Dev 的读写协议 | 少量 | 下一轮迭代 |

---

## 六、预期收益

| 改进项 | 每个项目预期节省 | 确定性 |
|--------|----------------|--------|
| 4.1 Token 用量估算 | 不省 token，但让后续优化有数据支撑 | — |
| 4.2 路径幻觉消除 | ~20K-30K tokens（vote-app 40 次幻觉，11/11 session 复现） | 高 |
| 4.3 Read-before-Edit 消除 | ~5K-8K tokens | 高 |
| 4.4 派发消息精简 | ~3K-5K tokens | 高 |
| ~~4.5 Bash 输出自动裁剪~~ | ~~~10K-20K tokens~~ → 实测 0（agent 已用 tail 限制） | 暂缓 |

**保守估计**：每个项目节省 28K-43K tokens，路径幻觉消除是最大单项（确定性最高）。

### vote-app 实测累计浪费

| 阶段 | 可避免浪费 (tokens) | 含框架级浪费 | 主要问题 |
|------|-------------------|-------------|---------|
| Dev（Module 1+2） | ~85K-100K | ~105K | 路径幻觉 + Thinking 膨胀 + Bash 输出 |
| Arch（全流程） | ~15K-20K | ~20K | Edit 失败 + 全量读报告 |
| UAT（设计 + Story 1-2） | ~23K-30K | ~43K | 路径幻觉 + Edit 回显 + 重复执行 |
| **合计** | **~123K-168K** | — | 上面 4.2-4.4 可覆盖其中 28K-43K |

---

## 附录 1：`team3 init` 命令设计 ✅ 已实现

4.5 Bash 裁剪暂缓，但 `team3 init` 仍然需要——当前用户手写 `~/.team3/config.json` 的体验太差。

### 功能

在 `team3/bin/team3.js` 的 switch 中新增 `init` 子命令，交互式选择 CLI 并写入全局配置：

```
$ team3 init
? 选择 Code CLI: (上下键选择)
❯ qodercli (qoder-code)
  claude (claude-code)
```
选择后写入 `~/.team3/config.json`：
```json
{ "codeCli": { "type": "qoder-code", "command": "qodercli" } }
```

后续 4.5 或其他 hook 需要注册时，在 init 流程中追加即可。

### 改动文件

| 文件 | 动作 |
|------|------|
| `team3/bin/team3.js` | 新增 `init` 子命令入口 |
| `team3/cli/init.mjs` | 新增，init 主逻辑 |

---

## 附录 2：多 session 间 prompt 缓存复用 — 未来

### 想干什么

一个项目里有很多次会话（session），每个 session 的 system prompt 里都有一大段一模一样的前置内容（role 定义、协议、STEP 流程、app_design、module 设计）。如果能让这段内容命中缓存，第二个 session 起就不用重复付这部分的钱。

Anthropic 的 prompt 缓存是**按内容前缀的哈希**存在服务端的，跟 session-id 没关系。所以只要两次请求的**前缀字节完全一样**、且在缓存有效期（TTL）内，新 session 照样能命中上一个 session 写入的缓存——跨 session 复用在机制上是成立的。

### 核心思路：按"多久变一次"分层，稳的放最前

把喂给模型的内容分四层，越稳定的越靠前。因为缓存是一条哈希链，前面的内容一改，后面全部作废；所以天天变的东西要压到最底，改了也只废它自己那一小段。

```
L1  role + 协议 + STEP 流程      所有项目所有 session 通用，最稳，放最前
L2  app_design + module_X       项目级，基本定稿，很稳
L3  progress + decision_log      天天变，放后面
L4  本次任务 + [reread]          每次都不同，放最后
```

排序：`app_design`（定稿了不动）在前，`decision_log`（每次踩坑都写）在最后。

### 三个落地动作

1. **6 个文件从"agent 自己 Read"改成"daemon 拼 prompt 时直接塞进开头"**。顺带干掉 Read 的返回内容、路径幻觉、多余轮次，三重收益。
2. **注入顺序**：app_design → module_X → feature_list → progress → decision_log（稳的在前）。
3. **调度上让同一项目的 session 密集连着跑**，趁上一个 session 写的缓存还没过期就命中。

### 前置要求

这套方案**当前在 qodercli 上不具备落地条件**，卡在两个硬前提：

1. **CLI 要能控制缓存断点。** 已查 qodercli `--help` 和官方文档：`--system-prompt` / `--append-system-prompt` 都是纯文本，**没有任何 `cache_control` / 缓存断点入口**；文档也没有 prompt caching 相关页。CLI 不暴露断点，就没法在四层之间插缓存点。
2. **要能观测缓存命中。** 缓存命中和未命中，字符数完全一样，4.1 的字符估算量不出省了多少。而 qodercli 的 result 事件真实 token 全是 0（4.1 已实测），也不回报 `cache_read` / `cache_write`。命中率无法观测 → ROI 无法证实。
3. **计费模型差异。** qodercli 走 Credits（积分）计费，不是 Anthropic 原生的 token + 缓存读写模型。缓存命中折算多少积分，文档未公开。

另外还有一个通用前提：**TTL vs 会话间隔**。缓存默认 5 分钟过期，而实测 Dev 的 session 平均 ~14 分钟一个，默认 TTL 撑不到下一个 session，基本每次冷启动。要么密集连跑压进 5 分钟，要么开长 TTL（1h，写入贵 2×，得算账）。

### 结论

- **claude-code provider**：Anthropic 原生支持 prompt caching + `cache_control` + usage 回报，方案成立，值得做。
- **qoder-code provider**：阻塞——等 qodercli 暴露缓存控制入口或真实 usage 输出后再评估。
- 这**不属于"无副作用"档**：它改了 agent 行为（不再自己 Read），要同步改 prompt（告知 L1/L2 已在上文、别再 Read）并和 `[reread]` 协议对齐（resume 的 session system prompt 冻结，注入的 L2 不会更新，reread 仍需保留用于会话内刷新）。风险档高于 4.2-4.4，等验证集。
