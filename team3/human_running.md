# 人工驱动模式（自开发 team3 时用）

## 一句话

手动扮演 daemon，串起 Arch / Dev / UAT 三个 Agent，跑一遍 team_coding3 来验证整套 team_coding3 方案是否真的成立。
"开发自己" 来验证 "自己" 是否可行。
> 注：UAT Agent = 给 "被 team_coding3 开发出来的产品" 做业务 UAT，仅此一件事。对 team_coding3 这种工具性产品，我还是手动 dogfooding，否则 UAT 会陷入一个复杂嵌套中。
> 注：实操，只用 UAT 生成 uat_stories.md，然后自己使用 team_coding3，按照 story 执行和验证，过程中开启 claude code 作为工具来辅助。

## prompt 与打包

设计见 `spec/packaging_design.md`。

| | 手驱自开发（本文上半部分） | UI dogfood / 终端用户（本文下半部分） |
|---|---|---|
| prompt 源 | `--system-prompt-file human_coding/xxx_prompt.md` | `human_coding/` → `build/embed-prompts.js` → daemon 内联 |
| 改 prompt 后 | 新 session 读最新文件 | `node build/embed-prompts.js`，重启 daemon |

两种启动方式：

```bash
# 方式 1：源码 dogfood（开发者）
cd team3
node build/embed-prompts.js      # 生成 daemon/src/embedded-prompts.js；改 prompt 后必须重跑
cd web
npm run dev                      # http://localhost:3000

# 方式 2：打包产物 dogfood / 终端用户
cd team3
bash build/build.sh                              # 产出 pkg/team3-x.y.z.tgz，不会自动安装
npm install -g ./pkg/team3-*.tgz                # 必须加 ./，否则 npm 会当成 GitHub 仓库
team3 start
```

注意：
- `web/templates/agent/` 已；新项目初始化不再 copy prompt 到 `spec/agents/`。
- 只打开 Web 页面不需要 prompt 文件；但从 Web 启动 daemon / agent 时，daemon 必须能加载 `daemon/src/embedded-prompts.js`，否则启动失败。

## 开发阶段，与自动化版的差异

只列差异，其余完全按 `spec/app_design.md`。

| 自动化版 | 人工版 |
|---|---|
| daemon 监听 actions.jsonl，按 action 类型 spawn/resume claude | 你 copy agent 整段输出（含末尾 `[reread: ...]`），按 action 类型手起对应 session |
| Module 2 init 拉起 agent | terminal 里手起 `claude --session-id ...` |
| daemon 使用 embedded prompts（`human_coding/` → `build/embed-prompts.js`） | 你手动指定 `--system-prompt-file human_coding/arch_prompt.md` |
| `.team3-project.json` 自动维护 sessionId | 纯手驱时没有这文件，runing 状态记你脑子里（UI dogfood 仍会用） |

## 跑一轮

> **sessionId 必须是合法 uuid**（claude code 强制要求 `--session-id` 是 uuid，否则报 `Invalid session ID. Must be a valid UUID.`）。下面已预生成好，直接复制用。
>
> - **Arch**（长期 resume）：`86a05a3a-9def-49e3-9b66-c49cc3c0f654`
> - **Dev**（预生成 10 个，每收一次 `dev_do` 顺序消耗下一个；`dev_fix` 沿用当前 runing 不换。当前 runing 是哪个，你自己记）：
>     1. `8d37dc10-737f-4116-b0bc-a2a71dc986f0`
>     2. `5de4f06e-eaf2-4a09-8699-564ecacbb42c`
>     3. `5a1078f6-46fc-4851-97c9-5f164184e38a`
>     4. `d0392895-3e0c-46ce-a486-fff3b183f0aa`
>     5. `86e0dbb8-43e1-44b3-9651-dae80270fd0d`
>     6. `4c91e613-c3ba-4542-92f0-b7d9df5ad43e`
>     7. `9f6e60d2-e906-43ed-9386-4c43817c6e5b`
>     8. `4d332708-719a-4ae5-98e7-e6ae24bd65ce`
>     9. `6ebf5dba-50f8-4ee6-a5d4-6999e80fa850`
>     10. `d4430666-e663-4357-bf45-2279db67f7aa`
>
> 用完 10 个就 `uuidgen | tr '[:upper:]' '[:lower:]'` 再生成。

### 准备

```bash
cd team3
touch spec/actions.jsonl spec/decision_log.md
## app_design.md 和 module_x.md 设计文档已完成
```

开 3 个 terminal，分别贴标签 Arch / Dev / UAT。

### 1. 启 Arch（Terminal 1）

```bash
claude --session-id "86a05a3a-9def-49e3-9b66-c49cc3c0f654" --system-prompt-file human_coding/arch_prompt.md
```
先验证：
> 请你简要的复述下自己的角色和作用。

跟它说：
> 整体架构设计和 module 拆分已经完成。目前我们准备开始 module_3，设计文档 `spec/module_3_node_engine.md`。开始。

### 2. 启 Dev（Terminal 2，新 sessionId）

用预生成列表的第 1 个 uuid `8d37dc10-737f-4116-b0bc-a2a71dc986f0`：

```bash
claude --session-id "8d37dc10-737f-4116-b0bc-a2a71dc986f0" --system-prompt-file human_coding/dev_prompt.md
```

把 Arch 写入 actions.jsonl **整行复制** 贴进去。Dev 跑完，**整行复制** 贴回 Terminal 1。

### 3. Arch 验收 → 继续开发

把 Dev 那段贴给 Arch。它会输出：

- **通过** → `dev_do: 下一个 Feature ...`：关 Terminal 2 的当前 dev session，按预生成列表**取下一个 uuid**新开，回到步骤 2
- **退回** → `dev_fix: ...`：Terminal 2 沿用当前 uuid（已退出就 `claude --resume "<当前 dev uuid>"`），回到步骤 2

### 4. 全部 feature 通过 → 触发 UAT

Arch 输出 `uat_check: ... [reread: ...]`。**复制时把 reread 里的 `*_feature_list.json` 和 `*_progress.txt` 删掉**，保黑盒。

### 5. 手工使用 UAT 生成 uat_stories.md

### 6. 手动 dogfood UAT 验收

参见 " UAT 环节手动 dogfooding "


## 实操小贴士

- 复制**带末尾 `[reread: ...]`**，漏 = 协议失效
- 复制连同 `dev_do:` / `to_arch:` 前缀一起，agent 才知道是消息不是闲聊
- agent 反问已写进 decision_log 的事 = compact 了 → 直接 "请重读 spec/decision_log.md"

---

## UAT 环节手动 dogfooding

> 前提
> - 已有一个被开发产品设计 `example/badminton/spec/app_design.md`，通过 team_coding3 自动化开发 badminton
> - 开发链路已跑通（modules_progress.json 全 done），或者你要验证 team_coding3 当前状态

### 启动方式 A：源码 dogfood

```bash
cd team3
node build/embed-prompts.js
cd web
npm run dev                  # http://localhost:3000
```

适用：你在本仓库里改代码、改 prompt 后立刻验证。

### 启动方式 B：打包产物 dogfood

```bash
cd team3
bash build/build.sh
npm install -g ./pkg/team3-*.tgz  # 必须加 ./；覆盖全局 team3
team3 start
```

适用：验证终端用户安装后的真实体验。`build.sh` 只打包不安装——若之前装过旧版，必须重装 `.tgz` 才会跑到本次构建产物（见 `packaging_design.md`）。

打开浏览器 → 选择/创建项目（如 `example/badminton`）

**验证环境就绪**：
- 页面正常渲染（Page 1 群聊 + 文档区）
- 项目根有 `.team3-project.json`，且 `init_workspace=true`
- 点「启动 Daemon」后，`.team3-project.json` 里有 `daemon_port` / `init_daemon`
- 用 `.team3-project.json` 里的 `daemon_port` 检查进程，例如：`lsof -ti :<daemon_port>`
- 群聊区出现 Arch 上线消息

### 按 team3/spec/uat_stories.md 逐 Story 手动执行

打开 `team3/spec/uat_stories.md`，从 Story 1 开始：

| Story | 你要做什么 | 观察什么 |
|-------|-----------|---------|
| Story 1 | 创建项目、发消息、编辑文档、关闭重开 | init 完整、Arch 上线回复、文档保存、断线重连 |
| Story 2 | 告诉 Arch 拆 module、给 UAT 发 uat_design | 双线并行启动、feature_list 生成、uat_stories 产出 |
| Story 3 | 观察（不操作） | Dev 交付 → Arch 验收/退回 → Dev 修复 → 消息队列 |
| Story 4 | 观察（不操作，耗时较长） | 系统自主跑完所有 module，全 done |
| Story 5 | 触发 uat_check，观察 UAT agent | 黑盒执行、puppeteer 操作、uat_report.md 生成 |

**每个场景的"验证"部分 = 你的 checklist**，逐项对照。

### 辅助

可以开一个 claude code 在 workspace 目录辅助查文件：

```bash
cd example/badminton   # 或你的 workspace
claude
```

常用：
- `tail -5 spec/actions.jsonl` — 最近消息
- `cat spec/modules_progress.json` — 进度
- `cat .team3-project.json` — session 状态
- `ls logs/` — agent 日志

### 结果

- **全部通过** → team_coding3 验证完成
- **有失败** → 记录到 `spec/uat_report.md`（参考之前的报告格式），修复后重新验证对应 story

---

## 源码 zip 打包（git archive）

只打 git 已跟踪文件（`example/` 等已被 `.gitignore` 忽略，不会进包）。
- **会打进包**：顶层目录 `draft/`、`team3/`，以及 `.gitignore`。
- 跳过 `node_modules`、`.next`、`embedded-prompts.js` 等编译后产物。

### 打包

在 **仓库根目录**（`team_coding3/`）执行：

```bash
cd team_coding3
git archive --format=zip HEAD -o team_coding3.zip
```

### 使用

```bash
# 确认文件
unzip team_coding3.zip
ls .gitignore draft team3   
# 安装依赖
cd team3
npm install --prefix web && npm install --prefix daemon
# build
bash build/build.sh
npm install -g ./pkg/team3-*.tgz
# 启动 http://localhost:9001
team3 start -p 9001
```