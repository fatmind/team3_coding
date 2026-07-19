# Decision Log 合并（team3 + 各被管理项目）

> 从多个项目的 spec/decision_log.md 原始合并，用于 harness 问题提炼。仅追加，不改写。

---

# ===== team3（工具自身） =====

## 2026-06-06 10:30:00 | dev | 经验教训
**背景**
Feature #22 stdout-parser 首版实现基于猜测的 stream-json 格式（`{type:"assistant", subtype:"text", content:"..."}`），与真实 claude code CLI 输出完全不匹配。真实格式无 `subtype` 字段，数据嵌套在 `message.content[]` 数组中，每个 block 类型的字段名不同（thinking 内容在 `block.thinking` 而非 `block.text`，tool_use 的名称在 `block.name`、参数在 `block.input`）。问题直到 Arch 用真实日志文件（example/badminton_call/logs/）比对才被发现。
**结论**
1. 涉及外部工具输出格式解析时，必须先查看真实日志/样本数据，不能凭文档描述或推测编码。即使 spec 用了 `assistant/text` 这样的简写，也应先确认实际 JSON 结构
2. 项目中已有的真实运行日志（如 example/ 目录）是验证格式的最佳参考——stub/mock 的输出格式可能与真实输出差异很大
3. 单测中增加"真实日志格式验证"用例（直接从真实 log 截取 JSON 行作为测试输入），可以防止格式偏差在 mock 环境中被掩盖

## 2026-05-29 | human | 产品优先级
**背景**
人类对产品方向做判断：让别人喜欢并用起来，关键在 ① 好上手（简易安装、随时启停）② 好看（被开发出的产品成果好看）③ 稳定（各种异常自恢复）；并认为当前不必追求多大/多难的系统开发，也不必急于优化 token。Claude 独立评估后基本认同，并做两点修正。
**结论**
1. **精力分配权重（后续所有取舍按此排序）**：首次成果体验 ≥ 好上手 > 稳定 >> 成本(token)看护 >> 大系统/token 优化（暂时不碰）
2. **"好看"重定义为"成果可信"**：界面好看是表层，真正决定口碑的是产出物能跑、像人会骄傲交出去的东西。漂亮但跑不起来的代码比丑但正确的更伤信任。"好看"是结果可信的代理指标，不是目标本身
3. **token 是生存底线而非功能**：现在不做精细优化（时机对，勿过早优化），但要盯绝对量级别失控——建个小 app 烧 $50 就是非卖品。这是闸门，不是项目
4. **不堆大系统/复杂编排**：meta 工具最易把精力浪费在调度框架上而用户看不到。MVP = 一个循环可靠产出一个漂亮可信的成果 + 装起来零摩擦，这是信任飞轮第一圈
5. **采纳漏斗视角**：安装(好上手)→首次出活(成果可信)→无人值守重跑(稳定)→长期用(成本可接受)。顶部漏斗=好上手+首次成果(决定传播)，留存=稳定，成本=闸门

## 2026-05-28 23:30 | arch | 经验教训
**背景**
人类手工 dogfood 通过 UI 创建项目后，发现 spec/agents/ 和 uat/ 为空——模板文件没有被 copy。根因：initWorkspace 中 getTemplatesDir() 使用 __dirname 做路径解析，Turbopack 编译后 __dirname 被替换为虚拟路径 "/ROOT/src/lib/init"，导致 path.resolve 解析到不存在的目录，fs.existsSync 返回 false 静默跳过。Module 2 Feature #2 的 e2e 通过 vitest 直接 import initWorkspace（不经过 Next.js 编译），__dirname 正常工作所以测试通过，但通过 HTTP API（经 Turbopack 编译）调用时就失效了。
**结论**
1. Next.js Turbopack 编译环境中不能用 __dirname 做路径解析——用 process.cwd() 替代
2. 模板文件等被 initWorkspace 消费的资源，应该放在 web/ 工程目录下（而非 dynamics/ 根），这样 process.cwd() + 相对路径就能正确解析
3. **验收盲区**：当同一函数既有"vitest 直接 import"的 e2e 又有"Next.js HTTP API 调用"的 e2e 时，Arch 必须确认后者覆盖了模板 copy 这种依赖 __dirname 的路径逻辑。直接 import 的 e2e 掩盖了编译环境差异
4. Feature #8 e2e 验证了 `spec/` 目录存在但没验证 `spec/agents/` 有内容——"目录存在"和"文件被正确 copy"是两个不同的断言，后者才是用户关心的

## 2026-05-28 23:00 | dev | 经验教训
**背景**
Feature #8 首版实现用 scanProjects() 扫描 .team3-project.json 来发现项目，人类反馈指出 .team3-project.json 是特殊文件不能扫。重构为 data/projects.json 文件注册表后，发现 getWorkspaceRoot() 被 health/route.ts 和 web-logger.ts 间接引用，删除 getWorkspaceRoot 后 TypeScript 编译失败。此外旧的 workspace.test.ts 还保留了 4 个 getWorkspaceRoot 测试用例。
**结论**
1. 删除核心工具函数（如 getWorkspaceRoot）时，必须全局搜索所有 import 点——不仅包括 API route，还要检查工具类（web-logger.ts）、辅助路由（health/route.ts）和测试文件中的 import 及 mock
2. 项目发现机制（扫描 vs 注册表）属于架构决策，实现前应与人类确认。文件注册表比目录扫描更可控——不会意外包含工具自身目录
3. 向后兼容 → 强制参数的迁移：移除 API 的 fallback 行为（getWorkspaceRoot 兜底）时，旧的单测 mock 可能仍然返回有效值掩盖 400 分支——需要在 e2e 中显式验证 "无参数 = 400"

## 2026-05-28 11:00 | human | 人类决策
**背景**
人类手工验收产品，发现首页直接进入项目工作台，没有项目列表/创建入口。且 dynamics/（工具自身目录）被当作用户项目展示。人类多次强调 dynamics/ 不允许展示。根因：getWorkspaceRoot() 从 process.cwd() 向上查找 .team3-project.json，web 进程从 dynamics/web/ 启动，必然找到 dynamics/.team3-project.json，把工具自身当成用户项目。
**结论**
1. 首页（/）必须展示项目列表或创建项目引导，不能直接进入单个项目的工作台
2. dynamics/ 路径下的 .team3-project.json 是工具自身的项目元数据，永远不允许出现在用户项目列表中——这是产品底线，不可妥协
3. 所有 API 需要支持 workspace 参数，由前端在选定项目后传入，不再依赖 getWorkspaceRoot() 的 cwd 向上查找逻辑

## 2026-05-27 12:00 | dev | 经验教训
**背景**
将 Feature #6/#7 的 e2e 也从 stub-claude 迁移到真实 claude 时，发现两个新问题：（1）Feature #6 的 getLastPromptFromLog() 依赖 stub-claude 的 log 文件验证传给 claude 的 prompt，改用 DaemonOrchestrator 转发的 spawn event 中的 prompt 字段替代；（2）Feature #7 test1 断言 stream-json 首行为 system/init，但真实 claude 首行输出是 hook_started 事件。
**结论**
1. 验证传给 claude 的参数时，优先用 AgentScheduler 的 spawn event（包含 role/sessionId/isNew/prompt/args/messageCount），不依赖 claude 内部日志格式
2. 真实 claude 的 --output-format stream-json 输出顺序：hook_started → system/init → content → result/success。断言特定事件时应 find() 而非假设固定位置

## 2026-05-27 10:45 | dev | 经验教训
**背景**
将 e2e 从 stub-claude 迁移到真实 claude CLI 时，遇到两个核心问题：（1）project json 中 session.initialized=true 但 session UUID 无对应真实 session → claude --resume 失败 exit 1；（2）Feature #5 roundtrip 测试的 actionsFile 路径在 tmpDir/actions.jsonl，但 prompt 指向 spec/actions.jsonl，claude 写入位置和 ActionWatcher 监听位置不一致。
**结论**
1. 真实 claude e2e 中 project json 的 initialized 字段必须和真实 session 状态一致：新环境用 initialized=false → --session-id 创建真实 session → exit 0 后 initialized=true → 后续 --resume 才能成功
2. 凡是 prompt 中引用相对路径的文件，e2e setup 的文件布局必须与 cwd 下的相对路径匹配。路径不一致时 claude 正常 exit 0 但目标文件未写入——这类 "静默失败" 比 crash 更难排查
3. 真实 claude 遵循 -p prompt 中的显式指令（如"写入 spec/actions.jsonl"），但不一定遵循 --system-prompt-file 中的操作指令。需要文件写入行为时，应放在 -p prompt 而非仅放在 system prompt

## 2026-06-15 14:33 | human | 人类决策
**背景**
`session.initialized` 曾用于区分 `--session-id` / `--resume`，但 Arch / UAT 已按任务切换多个 session；继续用该字段会让 action 语义和 CLI 状态语义重叠。
**结论**
1. `.team3-project.json` 的 session 只保留当前 `runing` 和历史 `done[]`。
2. Daemon 只按 action 判断新 session / 复用 session：`dev_do`、`uat_design`、`uat_check` 是新任务；`dev_fix`、`uat_fix` 是复用当前任务；Arch 按当前 module 绑定切换。
3. 若 `--resume` 返回 `No conversation found`，只作为技术修复处理：替换 `runing` 为新 UUID，并用同一条消息以 `--session-id` 重试。

## 2026-05-27 00:00 | human | 测试原则
**背景**
UAT 阶段发现 Module 3 全部 e2e 基于 stub-claude 测试，无法暴露真实 claude code 交互中的问题（session 管理、超时、输出格式等）。人类决策确立 e2e 测试的核心原则。
**结论**
关键原则：**像真实用户一样测试，不走捷径**
1. **e2e 不允许 mock 被测主体**（spawn / bash / 工具 等）。单测已经全 mock，e2e 的存在意义就是验真
2. 实在无法真实跑的 checkpoint → 在交付里**显式标记** "checkpoint Step N: 后续再验"，Arch 允许 feature 通过但必须追加 follow-up feature 补回真实 e2e

## 2026-05-26 15:00 | arch | 经验教训
**背景**
Arch 派发 Module 1 Feature #7 dev_do 时，用 `echo '...\n...'` 写入 actions.jsonl，shell 将 `\n` 展开为真实换行，JSONL 行被拆成 20+ 行碎片导致 daemon 解析全部失败；同时多余追加了一条重复的简短 dev_do。
**结论**
1. actions.jsonl 必须严格单行 JSON——用 `printf '%s\n' '...'` 或 heredoc + `jq -c`，绝不用 `echo` + 内嵌 `\n`
2. 每个 action 只写 1 行，三件套的"追加 actions.jsonl"是指该 action 本身，不需要额外写一条"日志摘要"
3. 长消息保持单行：用空格/句号分段替代换行符

## 2026-05-26 11:00 | human | hands on
**背景**
module_3 完成，人类主动检查、判断
**结论**
| 阶段 | 案例结论 | 背后思考 |
|------|---------|---------|
| 架构 | message-router.js 10 行逻辑独立成文件，应合并 | 不为几行逻辑造抽象，简单的事放一起 |
| 架构 | orchestrator 合理保留 | 模块各自独立，启动串联 + 运行时转发，有必要存在 |
| 代码 | claude hang 无 timeout，需补超时 kill + 通知 | 外部依赖必须有兜底，不能信任它一定正常退出 |
| 代码 | 人类消息 spawn 失败后丢失，需补通知 | 要考虑异常情况下的消息丢失和恢复 |
| e2e | 只覆盖 happy path，异常场景未覆盖 | 测试和代码要各自独立思考，测试不是代码的附属品 |
| e2e | 必须运行测试 + 检查中间产出验证真实性 | 看代码只知道意图，跑起来 + 检查中间产出才确认事实 |
| Arch | Checklist 加 ⑤ 异常/边界 + 必须输出至少 1 个疑点 | 纯绿灯太容易水过，主动找茬 + 留证据才有效 |

## 2026-05-26 09:35 | dev | 经验教训
**背景**
Feature #3 的 Puppeteer e2e 测试中，页面 React 客户端组件始终停留在 "Loading..." 状态，useEffect 不触发。排查发现 Next.js 16 Turbopack dev 模式下，从 `127.0.0.1` 访问的页面会被拦截 HMR WebSocket 连接（报 "Blocked cross-origin request to Next.js dev resource"），导致 Turbopack 客户端运行时无法初始化，React hydration 不执行。
**结论**
使用 Puppeteer 或任何非 localhost 方式访问 Next.js 16+ dev server 时，必须在 `next.config.ts` 中配置 `allowedDevOrigins: ["127.0.0.1"]`（或其它访问来源），否则客户端组件不会 hydrate。此问题不影响 production build。

## 2026-05-25 11:00 | Arch | 经验教训
**背景**
Feature #1/#2/#3 验收时，Arch 未执行对抗式 checklist（e2e mock 检查、tautology 检查、跨 feature 接口复用检查），直接信任 Dev 交付总结中的"全部通过"。人类更新 MODE B 审查规则后，回顾发现：Feature #2 e2e 全 mock spawn + tautology 测试、Feature #3 重复实现 buildClaudeArgs。
**结论**
1. Arch 验收必须先独立审查 src 再对照 Dev Delivery（顺序不能反）
2. e2e 测试中 mock spawn/bash 等外部工具时，需判断是否 mock 了被测主体本身
3. 跨 feature 交付时，必须检查新 feature 是否复用了前序 feature 暴露的接口，而非平行重新实现
4. 每次验收必须抽测运行至少 1 个 e2e 脚本

---

# ===== example/badminton_call =====

# Decision Log

## 2026-06-15 19:40:00 | dev | 经验教训
**背景**：Dev 在 init.sh 启动应用后需要停止服务时，如果使用 `killall node` 或 `pkill node` 会误杀用户其他 node 进程（daemon、其他项目等），已多次出现。
**结论**：停止 dev server 时必须使用端口过滤 `lsof -ti:$PORT | xargs kill`，而非进程名过滤。init.sh 已内置此逻辑，Dev 手动停止时也应遵循。

## 2026-06-16 01:30:00 | arch | 经验教训
**背景**：UAT Story 3 发现 product_issue（取消活动后非管理员视图仍显示报名表单），Arch 直接修改了 src/app/events/[id]/page.tsx 修复，违反了「NEVER 写业务代码」的 CRITICAL RULE。
**结论**：Arch 不写 src/ 代码。UAT product_issue 修复必须走正确流程：新增 feature → dev_do 派 Dev 修复 → MODE B 验收 → uat_fix 触发重验。即使修复看起来简单（几行代码），也不能越界。

## 2026-06-17 | arch | 经验教训
**背景**：Feature #4（上场均衡算法修复）验收时，e2e 测试使用了"干净分布"场景（10M+5F、8M+4M+4F），但 UAT Story 1 的真实场景是"混合分布"（部分人 both 类型、部分人仅一种、有女性选了男双但因性别不符无法参赛、有绑定报名）。e2e 22/22 全通过，但 UAT 发现严重回归（3轮→22轮、gap 2→11）。
**结论**：算法修复的 e2e 测试必须覆盖 UAT 的端到端场景数据分布，不能只用理想化的干净输入。Arch 验收算法类 feature 时，应主动对照 UAT stories 中的具体场景构造测试数据，确认 e2e 覆盖了 UAT 将验证的边界分布。

## 2026-06-17 18:48:00 | dev | 经验教训
**背景**：Feature #5 修复上场均衡回归。根因是 eligibleIds 集合包含了"选了某类型但因性别不符无法参赛"的玩家（如女性选了男双）。这些玩家永远 0 场上场 → hasZeroPlay 永远 true → round extension 无限扩展 → stuck detection 反复 bump maxTarget → 已上场玩家被重复安排到 max=11。三层 bug 级联放大：数据过滤缺失 → 循环条件失控 → 兜底机制无上限。
**结论**：调度算法中 "eligible" 的定义必须区分 "选了某类型" 和 "能实际参加某类型"。性别、水平等过滤条件在构建 eligible 集合时就要应用，不能仅在调度选人时才检查。涉及循环终止条件的集合（如 zero-play 检测）尤其要严格过滤，否则一个不可调度的玩家就能让整个算法死循环。

---

# ===== example/human_distillation =====

# Decision Log

## 2026-06-01 | human | Web↔Daemon 端口发现必须读持久化值，不可重算

**背景**：群聊消息不实时更新——daemon 日志显示消息已收到并 broadcast，但 ChatPanel 收不到 WebSocket 推送，刷新页面才能看到新消息。

**根因**：`/api/project/status` 用 Java hashCode 风格重新计算 daemon 端口（得到 3846），但 `start-daemon.ts` 实际用 `crypto.createHash("md5")` 分配端口（3761）并持久化到 `.team3-project.json` 的 `daemon_port` 字段。两套算法产出不同端口，ChatPanel 连到了空端口。

**架构教训**：系统是 "Web 1 个实例 → 每项目 1:1 Daemon → 1:3 Agent"。多项目并行时每个 daemon 端口不同，端口是 daemon 启动时一次性分配的，写入 `.team3-project.json`。任何需要知道端口的地方（status API、ChatPanel、健康检查）必须从这个文件读，不可重算。重算 = 隐含假设只有一种 hash 算法，一旦实现侧改了算法，所有消费方全部失联且无报错。

**结论**：删掉 status API 中的 hash 计算逻辑，改为直接读 `projectData.daemon_port`。同类问题的预防原则：凡是启动时计算并持久化的值（端口、session ID、PID），下游一律从持久化文件读，不重新派生。

## 2026-06-01 | human | Module ID 格式不能硬编码为 module_\<数字\>

**背景**：整体进度面板点击模块后显示 "No features yet"，开发过程面板显示 "Failed to load progress"。

**根因**：`/api/modules` 和 `/api/timeline` 的校验正则 `/^module_\d+$/` 只接受 `module_1`、`module_2` 等数字后缀。但 Arch 实际创建的模块 ID 是 `module_monitor`、`module_distill`、`module_chat`（语义化命名），被校验拒绝。

**结论**：Module ID 格式由 Arch agent 在运行时决定，Web 层不应硬编码格式假设。校验改为 `/^module_[a-zA-Z0-9_]+$/`。同时 ProgressPanel 增加 fallback：当 feature_list.json 加载失败时，从已加载的 modules_progress.json 提取内联 features 展示。

## 2026-06-01 | dev | Next.js build 环境变量陷阱
**背景**：Feature #1 初始化 Next.js 项目时，`npm run build` 反复失败。先是 Next.js 16 预渲染 `_global-error` 报 `useContext` null，降级到 14 后又遇到 turbopack 不支持 build 和 React SSG 渲染错误。
**结论**：当前开发环境预设了 `TURBOPACK=1` 和 `NODE_ENV=development` 两个环境变量。Next.js 14 的 build 不支持 turbopack，且 `NODE_ENV=development` 会导致 React production build 时 dispatcher 为 null。build 脚本中必须显式设置 `NODE_ENV=production TURBOPACK=` 来覆盖。后续所有 feature 的 build 命令都已在 package.json 中内置此修复，无需重复处理。

## 2026-06-01 | arch | 本地 LLM 代理：OpenAI SDK 必须禁用 Authorization header
**背景**：本地 LLM 代理（`http://localhost:3002/v1`）不需要 API Key，但 OpenAI SDK v6 强制发送 `Authorization: Bearer <apiKey>` header。代理收到此 header 后校验 key 并返回 400 "无效的api key"。
**结论**：在 `new OpenAI({...})` 构造时，当有自定义 `baseURL` 时，添加 `defaultHeaders: { Authorization: null as any }` 来禁止发送 auth header。这是 OpenAI SDK v6 唯一能阻止发 auth header 的方式（设空字符串、undefined 都不行，只有 null 有效）。同时，当 `LLM_BASE_URL` 存在时，chat API 不传 temperature/maxTokens（代理可能不支持）。配置文件：`src/.env.local`，端口按实际代理修改即可。

## 2026-06-01 | dev | 选用 Next.js 14 而非 16
**背景**：`create-next-app@latest` 生成了 Next.js 16.2.6 + React 19 项目，但 build 时 `_global-error` 页面预渲染报错（疑似 Next.js 16 与当前环境变量组合的 bug），尝试多种修复均无效。
**结论**：降级到 Next.js 14.2.29 + React 18.3.1（稳定 LTS 组合），配合环境变量修复后 build 通过。app_design.md 只要求 "Next.js" 未指定版本，14 满足需求且更稳定。若后续需要 Next.js 15/16 特性，需重新排查环境变量兼容性。

---

# ===== workspace/vote-app =====

# Decision Log

## 2026-07-09 16:32:00 | dev | 经验教训
**背景**：本次开发 Feature #1（文件存储层），首次在本机脚手架 Next.js 项目并启动 dev server 时踩到两个非显然的环境坑。
**结论**：
1. **npm 默认 omit=dev**：本机 `npm config get omit` = `dev`，`npm install` 会跳过 devDependencies，导致 vitest/tsx/typescript 全部缺失。安装与 `init.sh` 一律用 `npm install --include=dev`。
2. **父进程泄漏 Next 私有环境变量**：daemon/父进程（team3/web）向子进程注入了 `__NEXT_PRIVATE_STANDALONE_CONFIG`（指向 team3/web 的 next.config.ts + turbopack root）、`__NEXT_PRIVATE_ORIGIN`、`TURBOPACK=1`、`NODE_ENV=production`、`NODE_PATH`。这些会覆盖本项目 next.config，使 `next dev` 崩溃 `ERR_INVALID_ARG_TYPE at verifyTypeScriptSetup`（tsconfigPath=undefined）。解决：`init.sh` 启动前 `env -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NEXT_DEPLOYMENT_ID -u TURBOPACK -u NODE_PATH NODE_ENV=development npm run dev`。后续任何 Next 相关 feature 直接复用 `init.sh`，勿在裸 shell 里跑 `next dev`。

## 2026-07-09 | arch | 经验教训
**背景**：Feature #3 投票提交需在本地 JSON 文件存储上防重复投票，而「读现有票→查重→appendVote」是读-判-写序列，并发同问卷请求存在 lost-update / 双写窗口。
**结论**：采用 `src/lib/lock.ts` 的 `withLock(surveyId, fn)` 进程内 per-key async 互斥锁，把查重+追加串成临界区；无副作用的 404/403/400 校验放锁外避免阻塞。**适用边界**：该锁仅在单 Node 进程内有效——本项目 dev/prod 均单实例，成立。若未来横向扩容为多实例/多进程（PM2 cluster、多容器），此锁失效，防重复与追加需改为文件锁或原子 rename/CAS 方案。后续涉及并发写本地文件的 feature 复用 withLock，并牢记单进程前提。

## 2026-07-09 | human | 人类决策
**背景**：module_2 UI 品牌在 app_design.md 初稿写为 `minimaxi`，Dev 执行 `init-ui-rules.mjs --brand minimaxi` 失败——minimaxi 非 builtin skin，且 awesome-design-md `design-md/minimaxi/DESIGN.md` 404。Arch 独立复核确认 minimaxi/MiniMax/minimax-ai 全 404，仅 `minimax` 200（MiniMax AI 品牌）。
**结论**：
1. 人类确认 `minimaxi` 为笔误，视觉品牌为 `minimax`（getdesign.md/minimax）。已修正 app_design.md 全部三处引用。后续 UI feature 一律用 `--brand minimax`。
2. **StyleSeed 无 GitHub 网络绕过**：默认 cache 需 `git clone github.com/bitjaru/styleseed` 拉取，本机无 GitHub 网络会失败。本机已有有效副本 `/Users/bohan.sj/dev/open/styleseed`，用 `--styleseed-dir /Users/bohan.sj/dev/open/styleseed` 绕过。后续 UI init 复用此参数。

## 2026-07-09 18:00:00 | dev | 经验教训
**背景**：module_2 Feature #1 是首个 UI feature，`init-ui-rules --brand minimax` 生成的 `css/theme.css` 走 Tailwind v4 管线（`@import 'tailwindcss'`、`@theme inline`、`@apply`、依赖 `tw-animate-css`），但本机离线、`tw-animate-css` 拉不到，Tailwind v4 + Next 14 管线在离线环境难以稳定接通。同时 init-ui 会把整套 engine 模板文件（`components/ui/*`、`docs/*`、`scaffold/*`、`motion/*`）拷进项目根。
**结论**：
1. **离线套用品牌主题 = 只取 token 值，不接 Tailwind 运行时**：把生成的 `theme.css` `:root` token 值（品牌色/圆角/间距刻度/字体，逐字照抄）落到 `src/app/globals.css` 纯 CSS 全局样式，页面用 CSS Modules + `var(--token)` 消费。既真实还原设计语言又离线安全，且 ss-lint 无硬编码 hex（唯一需要的派生色如 hover 也抽成 `--brand-hover` token）。删掉 init-ui 生成的 `postcss.config.mjs`，避免它强制 Tailwind v4 PostCSS 管线作用到普通 CSS。联网后若要切官方 Tailwind 管线再单独处理。
2. **tsconfig 必须 exclude engine 模板目录**：`components/docs/scaffold/motion/utils/tokens.ts` 引用 radix/lucide/framer-motion/clsx 等未安装包，`**/*.tsx` glob 会把它们纳入编译，导致 `tsc --noEmit` 与 `next build` 报大量 TS2307。在 tsconfig `exclude` 加这些目录即可（业务组件放 `src/components/**` 不受影响）。
3. **e2e 目录命名跨 module 去重**：module_2 的 feature 编号从 1 重启，与 module_1 的 `e2e/feature_1` 冲突。约定用 `e2e/module_2_feature_N/` 命名，脚本 `e2e:m2fN`。
4. **纯前端 UI 的注水一致性**：用于 React key 的本地自增 id（module 级计数器）会在 SSR/客户端产生不同值，触发 hydration mismatch 警告。initial state 的 id 必须确定性固定，自增计数器只用于注水后用户新增的项。
5. **离线跑真实浏览器 e2e**：`puppeteer-core` 未装可 `npm install --prefer-offline puppeteer-core` 从 cache 装（登记为 devDep），Chrome 走本机 `cli/browser.mjs` 的 `/Applications/Google Chrome.app`。远程 Google Fonts `@import` 离线会 404 报 console error——UI feature 不要远程 @import 字体，字体名留在 font stack 首位 + system 回退即可；顺手加 `src/app/icon.svg` 消除 `/favicon.ico` 404。

---

# ===== example/game_loopit（空） =====

# Decision Log

---

# ===== open/cbce_policy_dog（webclaw3 pipeline 类，harness 教训可借鉴） =====

# Decision Log

## 2026-07-03 10:00:00 | Arch | 经验教训

**背景**
UAT Story 2 repair_round 2：policy_official skill.mjs synthesis 阶段 Claude 返回元回复（"政策版本文件已生成并写入..."）而非 policy markdown。Feature #4 的 validatePolicyContent 校验逻辑正确（检查首行 <!-- effective_date --> 格式），但元回复仍出现在最终文件。

**根因**
wc3-claude.mjs 使用 `claude -p --dangerously-skip-permissions` 运行 Claude，Claude 拥有文件写入工具权限。流程冲突：
1. `runSynthesis()` 将 `outputPath`（最终 policy_v1.md 路径）传给 `callClaudeWithFile`
2. `wc3-claude.mjs` 将 `--output outputPath` 传给 claude 子进程
3. Claude 使用 Write 工具直接将正确的 policy markdown 写入 outputPath
4. Claude 的文本响应是元描述（"文件已生成并写入..."）
5. `wc3-claude.mjs` 将 Claude 的文本响应写入同一个 outputPath — **覆盖了正确内容**
6. `runSynthesis` 读回文件时看到元回复，校验失败，删除文件

**结论**
- 当 Claude 子会话有文件工具权限时，**不能让 wc3-claude.mjs 和 Claude 工具写入同一个文件路径**
- 修复方案：`runSynthesis` 应让 wc3-claude.mjs 写入 tmpDir 下的临时文件，读取校验后再复制到最终 outputPath
- 通用原则：spawn 子进程写文件时，优先写临时位置，校验后再移动到目标位置（write-then-validate-then-move 模式）

## 2026-07-02 17:45:00 | Arch | 经验教训

**背景**
UAT Story 1 通过后，人类删除了 Story 2~5（uat_stories.md 只保留 Story 1）。但我在收到"Story 2 通过"的消息时，没有先重读 uat_stories.md 确认当前有哪些 Story，凭记忆继续派发 Story 2/3 的 uat_check，并在 progress History 中记录了错误的验收结果。

**根因**
1. **凭记忆行动**：没有在执行前重读 spec 文件确认当前状态，而是依赖之前读过的旧内容
2. **信任消息不核实**：用户说"Story 2 通过"时我应该重读 uat_stories.md 验证 Story 2 是否还存在

**结论**
- **每次派发 uat_check / dev_do 前，必须重读对应的 spec 文件**（uat_stories.md / feature_list.json），确认目标对象当前存在且状态正确
- 用户的消息可能是基于旧状态发的，不能当作 Source of Truth——spec 文件才是
- 与 2026-06-30 教训同根：**先读文件，再行动；不凭记忆，不信任消息**

## 2026-06-30 11:08:58 | Arch | 经验教训

**背景**
用户让我看"整体设计文档"并告知 `webclaw3/skill-pipeline/cli.mjs` 路径。我错误地将 webclaw3 项目（`/Users/bohan.sj/dev/open/webclaw3/`）当成当前项目，完整阅读了它的 spec 目录（webclaw3_design.md、skill-pipeline.md、architecture-evolution.md 等），产出了基于 webclaw3 架构的讨论回复——全部答非所问。

**根因**
1. **项目识别错误**：当前工作目录是 `cbce_policy_dog`，不是 `webclaw3`。我应该先读 `spec/app_design.md`（当前项目的设计文档），而不是去读另一个项目的 spec。
2. **依赖关系误判**：`webclaw3/skill-pipeline/cli.mjs` 是当前项目的**外部工具依赖**（用来生成数据采集 skill 的 CLI），不是当前项目本身的代码。用户给出这个路径是为了说明"数据采集 skill 通过 webclaw3 生成"，而非让我去审阅 webclaw3 的架构。

**结论**
- 收到任务时，**先确认当前项目目录**（`pwd`），读当前项目的 `spec/app_design.md`，不要跑去读其他项目
- 用户提到的外部路径（如 `webclaw3/skill-pipeline/cli.mjs`）是**依赖说明**，不是审阅对象。除非用户明确说"去看那个项目"，否则只记路径、不展开读

---

# ===== open/hero_accessories（webclaw3 pipeline 类，harness 教训可借鉴） =====

# Decision Log

## 2026-06-22 | arch | 经验教训：功能名必须匹配实际行为，验收必须检查输出质量

**背景**：AddProductDialog 的按钮标注为"保存并自动补全 ↗"，但实际只解析了输入文本提取 brand 和 name，其他 8 个字段（category/description/key_features/target_users/amazon_url/notes/price_usd/launch_date）全留空。用户输入 "oura ring 5" 后得到一堆空字符串的 JSON，体验很差。Arch 验收时只检查了"HTTP 201 返回、文件创建了、页面刷新了"，没有检查生成内容的质量。

**结论**：
1. **按钮文字暗示的功能必须真实兑现**——"自动补全"意味着系统要主动查询数据源填充字段，不是只做文本解析。如果做不到真正的自动补全，按钮就应该叫"保存"。
2. **Arch 验收时必须检查输出质量**——不能只看"文件创建了、HTTP 201 返回了"就通过，必须检查生成内容是否有意义。一堆空字符串不等于"功能完成"。
3. **做事情要动脑子**——看到功能名"自动补全"时，应该主动思考：自动补全什么？从哪补全？补全后用户看到什么？而不是机械地实现"解析文本 → 写入文件"。

---

## 2026-06-10: 1688 旺旺询盘未完成——接受为已知限制

**背景**：alibaba-1688-supply skill 在真实 pipeline 运行中，搜索、详情页采集、供应商筛选均正常工作（成功采集到揭阳市揭东区磐东东卓表带厂等供应商的价格/MOQ/定制能力等数据），但旺旺实时询盘对话未完成——output 中 inquiry.status=N/A, messages=0。

**根因**：skill 层面旺旺弹窗自动化不稳定，不是 orchestrator 或 run.mjs 的问题。

**决策**：接受当前状态作为迭代一已知限制，不阻塞。step7 机会卡片已自行标注"询盘未完成"风险。旺旺对话能力作为迭代二 skill 优化项。

---

## 2026-06-09 | dev | e2e mock 脚本与真实脚本共存时需 backup/restore

**背景**：Module 1 的 feature_6 e2e 测试将 `e2e-run.mjs` 拷贝为 `run.mjs` 供 orchestrator 调用。拷贝逻辑只在 `run.mjs` 不存在时执行。Module 2 开发 step2 真实 `run.mjs` 后，feature_6 测试不再拷贝 mock，改用真实脚本——真实脚本尝试调 skill + Claude，对假产品名必然失败，25 个测试全挂。

**结论**：e2e 测试中 mock/真实脚本共存场景必须用 backup/restore 模式——先备份真实文件，用 mock 替换，测试后恢复。在 `process.on('exit')` 中做恢复，确保即使崩溃也能恢复。后续 step3-step7 各有真实 run.mjs 后，同样受此保护。

---

## 2026-06-09: 架构重构——从 sN-prompt.md 到 run.mjs

**背景**：迭代一前半程采用"orchestrator 组装 prompt → Claude session 执行一切"的架构。暴露了两个根本问题：
1. **prompt 膨胀**：prevStepOutputs 内联到 prompt 中，到 step5 时累积到 59KB，超出 `claude -p` 的 CLI 参数长度限制，Claude 收不到 prompt 直接超时
2. **确定性不足**：skill 调用、文件读写、错误处理全写在 prompt 里让 Claude 执行，Claude 可能遗漏步骤、格式不对、或执行顺序错误

**决策**：重构为 run.mjs 架构。核心思路——**确定性的放到外层代码、动态决策的再交给 Claude，提升确定性**。

具体分工：

| 层 | 职责 | 由谁执行 |
|---|---|---|
| orchestrator | 迭代 step、检查 decision.json、收集 prevOutputs 路径、调用 run.mjs | Node.js 代码（确定性） |
| run.mjs | 调用 skill（spawn）、读写文件、组装 prompt、启动 Claude session | Node.js 代码（确定性） |
| Claude session | 业务分析：读取采集数据 → 判断 → 写 data.md + decision.json | LLM（动态决策） |

之前 Claude 同时承担了"调 skill"和"做分析"两个职责，现在 skill 调用和文件管理由 run.mjs 代码完成（必然成功或明确报错），Claude 只负责它擅长的业务判断。

**影响**：
- orchestrator 不再组装 prompt 或启动 Claude，只调 run.mjs
- 新建 session.mjs 共享工具（buildProductContext、runClaudeSession）
- prompt 直接写在 run.mjs 中，不需要单独 .md 文件
- sessions.json 和 --resume 机制去掉（run.mjs 自行管理断点）
- prevStepOutputs 作为 CLI 参数（JSON 文件路径列表）传给 run.mjs，不再膨胀 prompt

**经验**：当 LLM 既要做确定性操作（调 API、写文件）又要做判断时，应该把确定性操作提到外层代码，只让 LLM 做它的强项（理解、推理、判断）。混在一起会导致可靠性下降和调试困难。

---

## 2026-06-08: e2e 测试命名规范（产出 + 脚本文件）

**决策**：
1. **测试产出**：e2e 测试中产品名统一用 `e2e-` 前缀（如 `e2e-step4-test`）。已有 e2e 不改，旧残留 batch 人工删除。
2. **mock 脚本文件**：放在 `src/pipeline/steps/` 下的 e2e mock 脚本必须用 `e2e-` 前缀命名（如 `e2e-run.mjs`），不得占用生产文件名（如 `run.mjs`）。e2e 测试运行时由 test harness 临时复制 `e2e-run.mjs` → `run.mjs`，测试结束后清理。

**原因**：
- 产出：真实 pipeline 运行和 e2e 测试产出混在 `data/` 下难以区分。统一前缀方便清理和排查。
- 脚本：mock 脚本直接命名为 `run.mjs` 会与未来真实业务代码冲突（Module 2 各 step 的真正 `run.mjs`），且阅读代码时无法一眼区分 mock 和生产代码。`e2e-` 前缀让意图一目了然。

---

## 2026-06-08: amazon-reviews skill 后续补入

**决策**：先用 Reddit-only 数据跑完 step4-step7 全流程，验证端到端可行性。amazon-reviews skill 在 Module 2 完成后通过 follow-up feature 补回。

**原因**：Reddit 数据已足够支撑配件方案推导（46 posts → 11 demands → 6 方案），优先验证完整流水线。Amazon 评论补入后需重跑 step2-step7（上下文依赖），不适合中途插入。

---

## 2026-06-04: 迭代一开发节奏

**决策**：今天只实现 module_1（流水线编排框架）。module_2（Fitbit Air 端到端）的设计人类尚未 review，不启动开发。

**原因**：module_2 涉及真实 skill 采集和业务 prompt 设计，人类需要先确认方案再动手。

---

## 2026-06-04: session 状态集中管理

**背景**：每个 step 启动独立 Claude session，断点恢复需要知道哪个 step 对应哪个 session_id。

**决策**：session_id 映射集中存储在 case 级别的 `sessions.json`（与 case.json 同级），不在每个 step 目录下各存一份。

**原因**：避免文件分散，一个文件管理所有 step 的 session 状态，查询和更新更简单。

**经验**：状态/元数据类信息优先集中管理（一个文件），而不是分散到每个子目录。分散存储增加遍历成本且容易不一致。

---

## 2026-06-04 | dev | e2e 测试超时需随实现演进

**背景**：Feature #1 的 e2e 测试为 CLI 执行设了 10s 超时。当时 `runPipeline()` 是空占位函数，10s 绰绰有余。Feature #2 实现真实 Claude session 执行后，step2 需要 ~30s 完成，原测试超时失败。

**结论**：e2e 测试的超时值必须随被测功能的实际耗时演进。占位函数阶段的超时不适用于真实实现。后续 feature 如果显著改变 CLI 执行时间（如增加更多 step），需同步审查已有 e2e 测试的超时设置。

---

## 2026-06-05: Module 1 完成后待办

**待办项**（低优先级，不阻塞 Module 2）：
1. storage 单测写入真实 `data/` 目录（非 tmpdir），测试残留未清理 → 后续改为 tmpdir 隔离
2. case.json status 字段在 pipeline 完成后未更新为 "completed"/"error" → 后续补上终态写入

---

## 2026-06-05 | dev | gen-skill.mjs 入口守卫：CLI 脚本被 import 时不应自动执行 main()

**背景**：重构 gen-skill.mjs 后，新增 `parseSkillMd`/`parseSkillMdContent` 的 named export 供单测 import。但单测 import 该模块时，底部的 `main().catch(...)` 也被执行，导致因缺少 `--file` 参数而 exit(1)，测试框架报 exitCode 1 失败。

**结论**：ES module 的 CLI 脚本如果需要 export 函数供其他模块 import，必须在 `main()` 调用处加入口守卫（检查 `process.argv[1]` 是否指向自身）。否则 import 即执行 side-effect，破坏测试和复用。

---

## 2026-06-04 | dev | prompt 文件缺失应优雅降级

**背景**：`assemblePrompt()` 读取 `sN-prompt.md` 时，如果文件不存在会抛 ENOENT。最初这个异常没有被 `executeStep()` 的 try-catch 覆盖，导致 CLI 直接崩溃退出，而不是写入 error decision。

**结论**：step 执行的所有阶段（prompt 组装、session 启动、产出读取）都应在同一个 try-catch 里，失败时统一写 error decision 并继续（或终止 case），而不是让异常传播到 CLI 层导致未捕获崩溃。

---

## 2026-06-09 | dev | skill 入参 brand_name 需与 Amazon 实际显示品牌一致

**背景**：step4 调用 amazon-review-analysis skill 时，config 中 `brand_name` 设为 "Fitbit"（从产品数据中提取），但 Amazon 上 Fitbit Air 配件的品牌显示为 "Google"。skill 用 `brand_name` 判断 first_party/third_party，导致官方配件被错误分类为 third_party。

**结论**：`brand_name` 应填写 Amazon 品牌字段中实际显示的值（如 "Google"），而非产品数据中的品牌名。后续 prompt 可在 brand_name 提取指引中增加说明："使用 Amazon 卖家品牌名（by 字段），可能与产品品牌不同"。当前 step4 的分析结论不受影响（分析内容正确，仅 first/third 标签有误），无需紧急修复。

---

## 2026-06-09 | dev | skill 定义 md 与业务 prompt 是两个文件，不可混用

**背景**：step4-competitor/ 目录下原来 `s4-prompt.md` 的内容实际是 skill 定义（含 Task/Accept/入参定义），而非 orchestrator 使用的业务 prompt。导致已有单测（检查 s4-prompt.md 包含 `{{PRODUCT_CONTEXT}}`）失败 3 个。

**结论**：每个 step 目录中，`sN-prompt.md` 专用于 orchestrator 的业务 prompt（含 `{{PRODUCT_CONTEXT}}`/`{{SKILLS_DIR}}` placeholder），skill 定义 md（含 Task/Accept/入参定义）用 `<skill-name>.md` 命名。两者职责完全不同，不可合并到同一文件。

---

## 2026-06-10 | dev | 完整 pipeline 真实执行的 timeout 经验（更新 2026-06-08 条目）

**背景**：Feature #6 真实 pipeline 执行中，step2 skill 在 600s 超时（Phase 5 内部 Claude 分析 18 帖×6 批次），step6 Claude session 在 600s 超时（分析 step4+step5 共 ~40KB 数据 + 20 个 calc 结果）。

**结论**：
1. **Skill timeout**（step2）：reddit-discussion 含 6 个 Phase，Phase 5 并行 6 批 Claude 分析，总耗时可达 12-15 分钟。已从 600s→1200s（20min）
2. **Claude session timeout**（step6）：纯 LLM step 但输入数据量大（~40KB prev-step data + 20 个 calc JSON）时，Claude 分析+写 data.md+decision.json 可超 10 分钟。已从 600s→900s（15min）
3. **经验法则**：timeout = max(数据量/1KB × 30s, 600s)。每 10KB 输入数据大约需要 5 分钟 Claude 分析时间。Skill 采集额外加 10-15 分钟。

---

## 2026-06-18 | arch | 经验教训：不读图片文件（当前模型不支持多模态）

**背景**：Architect 在审查 UI feature 时，可能尝试读取 `spec/ux_hero.png` 等图片文件来理解交互设计，但当前使用的 Claude 模型不支持多模态输入，读图片会得到无法解析的内容或报错。

**结论**：Architect（以及所有 Agent）在已知当前模型不支持多模态时，**禁止读取图片文件**（如 `spec/ux_*.png`）。UI 设计信息应通过 `spec/app_design.md`、`spec/module_X.md` 等文本文件中的描述来理解，而非直接读图。若后续切换为支持多模态的模型，此限制可解除。

---

## 2026-06-18 | dev | 经验教训：Next.js 16.2.9 Turbopack distDirRoot bug + NODE_ENV 陷阱

**背景**：Module 3 Feature #1 搭建 Next.js App Router 项目时遇到三个环境问题：
1. Turbopack（Next.js 16 默认 bundler）panic: "Invalid distDirRoot: '.next'. distDirRoot should not navigate out of the projectPath." — 即使清除 .next 目录也复现
2. 环境中 `TURBOPACK=1` env var 与 `--webpack` flag 冲突，Next.js 直接拒绝启动
3. 环境中 `NODE_ENV=production` 导致 `npm install` 跳过 devDependencies（postcss 等），CSS loader 缺失

**结论**：
1. 当前环境（claude session sandbox）下 Turbopack 有 distDirRoot 解析 bug，需切换为 webpack 模式（`next dev --webpack`）
2. dev 脚本中必须 `TURBOPACK=` 清空环境变量 + `NODE_ENV=development` 确保 devDeps 安装
3. `init.sh` 中 `npm install` 也必须带 `NODE_ENV=development`，否则 CI/daemon 环境可能同样跳过 devDeps
4. package.json dev 脚本格式：`"dev": "NODE_ENV=development TURBOPACK= next dev --port 3001 --webpack"`
