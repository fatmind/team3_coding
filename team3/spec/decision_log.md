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
