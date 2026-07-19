# Issues — loop_004

> 提取时间: 2026-07-18T10:38:58.584Z
> 来源: (auto-discover)
> 新增条目: 89

# Issues

## Issue: 技术栈版本/环境变量未锁死，跨项目重复踩坑
- **分类**: 5 — 技术栈约束
- **改进建议**: harness 应在项目初始化阶段（init.sh 或脚手架模板）锁死关键运行时参数：Next.js 版本、`NODE_ENV`、`TURBOPACK`、npm `omit` 配置等。具体做法：① 在 `init.sh` 模板中统一 `env -u TURBOPACK -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NODE_PATH NODE_ENV=development`；② `npm install --include=dev` 写死在 init 脚本中；③ 将已知的版本兼容矩阵（如 Next 14 + React 18 + webpack mode）记录在 harness 级 tech-stack constraint 文件中，Arch/Dev agent 启动时自动加载。
- **证据**:
  - hero_accessories | 2026-06-01 | dev | Next.js 16 build 失败，`TURBOPACK=1` + `NODE_ENV=development` 导致 dispatcher null，降级到 Next.js 14 才解决
  - hero_accessories | 2026-06-18 | dev | Next.js 16.2.9 Turbopack distDirRoot bug + `NODE_ENV=production` 导致 `npm install` 跳过 devDependencies，CSS loader 缺失
  - vote-app | 2026-07-09 | dev | 同一组环境变量问题再次复现：`npm config get omit=dev` 跳过 devDeps + 父进程泄漏 `__NEXT_PRIVATE_STANDALONE_CONFIG` 等环境变量导致 `next dev` 崩溃

## Issue: Arch 验收只查「存在性」不查「内容质量」
- **分类**: 7 — 验证集有效
- **改进建议**: Arch 验收 checklist 应增加「输出质量审查」环节：对生成类 feature，不能只看 HTTP 状态码/文件是否创建，必须抽样检查生成内容是否有意义。具体做法：① 在 Arch 验收 prompt 中增加硬约束——"对每个生成型交付物，必须打开文件检查内容非空且非占位符，抽查至少 1 个完整样本的内容质量"；② 对按钮/功能名称做「语义兑现检查」——名称暗示的功能（如"自动补全"）必须在验收中实际触发并检查输出。
- **证据**:
  - hero_accessories | 2026-06-22 | arch | AddProductDialog 按钮标注"保存并自动补全"但实际只解析文本提取 brand/name，其余 8 个字段全空字符串；Arch 验收只检查了"HTTP 201 返回、文件创建了、页面刷新了"，未检查生成内容质量

## Issue: UAT 暴露出 Dev 阶段应捕获的基础缺陷
- **分类**: 7 — 验证集有效
- **改进建议**: 在 Dev 阶段的 e2e 验收标准中增加「基础可用性门禁」：① 所有默认路径必须支持环境变量覆盖（用于测试隔离）；② CLI 命令必须有明确的参数文档；③ LLM 输出解析必须有 fallback 机制。这些应在 Dev e2e 阶段就验证，而非留到 UAT 才发现。harness 可在 dev_do 派发模板中加入「可测试性检查清单」。
- **证据**:
  - bohan_habit | 2026-06-11 | human | UAT 发现 7 个问题：默认路径在项目目录下无法隔离产出（应改到 `~/.bohan_habit/`）、CLI 不支持路径参数、distill 生成中文文件名、inject 命令语义不明确、LLM 输出解析偶发失败——这些问题本应在 Dev e2e 阶段捕获

## Issue: e2e 测试数据分布与真实场景脱节
- **分类**: 7 — 验证集有效
- **改进建议**: harness 应要求 Arch 在验收算法/逻辑类 feature 时，对照 UAT stories 中的具体场景数据分布构造 e2e 测试数据。具体做法：① Arch 验收时主动读取 uat_stories.md，提取其中描述的真实场景（如混合类型、边界条件），将其转化为 e2e 测试 fixture；② 禁止只用"干净分布"（理想化输入）作为唯一 e2e 数据源；③ 对算法类 feature，e2e 必须覆盖 UAT 将验证的边界分布。
- **证据**:
  - badminton_call | 2026-06-17 | arch | Feature #4（上场均衡算法修复）e2e 使用"干净分布"（10M+5F、8M+4M+4F）22/22 全通过，但 UAT 真实场景是"混合分布"（部分人 both 类型、部分人仅一种、有女性选了男双但因性别不符无法参赛、有绑定报名），发现严重回归（3轮→22轮、gap 2→11）

## Issue: stub 全绿 ≠ 真实可用，LLM 类 feature 缺 live smoke
- **分类**: 7 — 验证集有效
- **改进建议**: 对涉及 LLM 输出的 feature，harness 验收标准应要求：① stub e2e 只验证链路连通性和解析逻辑，不作为"真实可用"的证据；② 必须至少跑一次真实模型 live smoke，由 Arch 逐条核对输出质量；③ stub fixture 必须覆盖真实模型的自然句式（含区间句、缩写、近似值等），不能只用"校验器友好格式"；④ 对「拒绝/拦截型」逻辑，验收必须逐条打开被拒样本核对，区分真阳性和假阳性，不能只看拒绝率。
- **证据**:
  - lazada-hackathon5 | 2026-07-18 | arch | F4 验收：stub e2e 全绿、Dev 声称"10/11 被拒证明校验器真能抓张冠李戴"，但 Arch 逐卡核对发现全是假阳性，真实接受率仅 9%。根因：stub fixture 全是"校验器友好格式"（数字显式带轴+周标签），与真实 LLM 自然句式差距巨大
  - lazada-hackathon5 | 2026-07-18 | dev | Dev 自述"stub e2e 全绿不等于真实可用"，录的 6 个 fixture 全是校验器友好格式，证明不了对真实模型输出的鲁棒性

## Issue: 确定性操作写在 prompt 里导致膨胀和不可靠
- **分类**: 1 — Prompt 具体化（兼 2 — CLI 脚本化）
- **改进建议**: harness 应在 Arch 设计阶段强制区分「确定性操作」和「动态决策」：① 文件读写、API 调用、skill 调用、数据传递等确定性操作必须由外层代码（run.mjs）执行，不写入 prompt；② prompt 只包含 LLM 擅长的业务分析和判断；③ harness 可在 Arch 设计模板中增加「确定性/动态决策分工表」，要求 Arch 明确标注每个步骤由代码还是 LLM 执行。
- **证据**:
  - hero_accessories | 2026-06-09 | dev | 原"orchestrator 组装 prompt → Claude session 执行一切"架构暴露两个根本问题：① prevStepOutputs 内联到 prompt 中，到 step5 累积 59KB 超出 CLI 参数长度限制；② skill 调用、文件读写等确定性操作由 Claude 执行，可能遗漏步骤、格式不对、执行顺序错误。重构为 run.mjs 架构后解决

## Issue: 阶段间契约缺失——上游产出格式与下游假设不一致
- **分类**: 3 — 上下文架构
- **改进建议**: harness 应在 Arch 和 Web/Dev 之间建立显式的产出契约：① Arch 创建的实体 ID 格式（如 module ID）应写入共享契约文件（如 `spec/contracts.json`），下游校验逻辑从契约读取而非硬编码正则；② 对跨角色产出（Arch→Dev→Web），harness 应要求 Arch 在 module 设计文档中明确列出所有实体 ID 及其格式规范；③ Web 层校验应使用宽松正则（如 `/^module_[a-zA-Z0-9_]+$/`），不假设具体命名模式。
- **证据**:
  - team3 | 2026-06-01 | human | `/api/modules` 和 `/api/timeline` 的校验正则 `/^module_\d+$/` 只接受数字后缀，但 Arch 实际创建的模块 ID 是 `module_monitor`、`module_distill`、`module_chat`（语义化命名），被校验拒绝，导致进度面板显示 "No features yet"

## Issue: Agent 角色边界靠 prompt 约束不可靠，需结构性强制
- **分类**: 1 — Prompt 具体化
- **改进建议**: harness 应通过结构性机制而非仅靠 prompt 中的 "NEVER" 规则来约束角色边界：① Arch agent 的工具权限应移除 src/ 目录的写权限（只允许写 spec/ 目录）；② 或在 harness 的文件操作 hook 中增加角色校验——当 agent role=arch 且目标路径匹配 `src/**` 时自动拒绝；③ 同类约束（如 Dev 不写 spec）也应结构性实施。
- **证据**:
  - badminton_call | 2026-06-16 | arch | UAT Story 3 发现 product_issue，Arch 直接修改了 `src/app/events/[id]/page.tsx` 修复，违反了「NEVER 写业务代码」的 CRITICAL RULE。即使修复看起来只有几行代码，也不能越界

## Issue: Agent 凭记忆行动/项目识别错误——缺乏「先读后做」的结构化强制
- **分类**: 3 — 上下文架构
- **改进建议**: harness 应在关键流程节点（派发 dev_do/uat_check/验收前）强制 agent 重读 spec 文件：① 在 agent prompt 模板中加入结构化前置步骤——"Step 0: 读取 {spec_file} 确认当前状态，不得基于上下文缓存行动"；② 对任务起始动作，强制 `pwd` + 读取当前项目的 `spec/app_design.md`，而非依赖上下文推断项目身份；③ 考虑在 harness 的 dispatch 逻辑中，将当前项目的 spec 文件路径作为显式参数传入 agent context，而非让 agent 自行推断。
- **证据**:
  - cbce_policy_dog | 2026-07-02 | arch | 用户删除了 Story 2~5，Arch 凭记忆继续派发 uat_check 并记录错误验收结果，未重读 uat_stories.md 确认当前状态
  - cbce_policy_dog | 2026-06-30 | arch | 收到任务后错误地将外部依赖项目 webclaw3（`/Users/bohan.sj/dev/open/webclaw3/`）当成当前项目 cbce_policy_dog，完整阅读了错误项目的 spec 目录，产出全部答非所问

## Issue: 测试环境隔离不标准——mock/真实脚本共存、共享状态导致 flaky
- **分类**: 6 — 验证环境
- **改进建议**: harness 应为 e2e 测试提供标准化的隔离机制：① 定义 mock 脚本的 backup/restore 标准模式——测试前备份真实文件、用 mock 替换、`process.on('exit')` 中恢复；② 测试产出统一前缀（如 `e2e-`）便于区分和清理；③ 测试必须使用隔离的临时目录（通过环境变量覆盖默认路径），禁止共享全局文件系统状态；④ 对 `node --test` 嵌套调用场景，提供标准化的 env 清理 wrapper（如剥掉 `NODE_TEST_CONTEXT`）。
- **证据**:
  - hero_accessories | 2026-06-09 | dev | e2e mock 脚本 `e2e-run.mjs` 与真实 `run.mjs` 共存时，拷贝逻辑只在 `run.mjs` 不存在时执行，Module 2 开发真实脚本后 e2e 不再拷贝 mock，真实脚本对假产品名失败，25 个测试全挂
  - bohan_habit | 2026-06-10 | dev | `node:test` 默认并发执行不同文件的 describe 块，多个 e2e 套件共享全局文件系统状态（`data/offsets/`），一个套件的 `after()` 清理 hook 与另一个套件的测试并发执行导致文件被意外删除
  - bohan_habit | 2026-06-10 | dev | collect 和 distill 共享同一个 offset 目录时，collect 更新 offset 后 distill 看到 0 条新消息（数据已被 collect 消费）

## Issue: 父进程/daemon 环境变量泄漏到子项目
- **分类**: 6 — 验证环境
- **改进建议**: harness 的 init.sh 模板应在启动 dev server 前统一清理已知的环境变量污染源：① 在 init.sh 中硬编码 `env -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NEXT_DEPLOYMENT_ID -u TURBOPACK -u NODE_PATH`；② 在 harness 的 daemon 架构文档中明确列出 daemon 向子进程注入的环境变量清单，供子项目 init.sh 参考；③ 考虑在 daemon 启动子项目时主动清理框架级私有环境变量。
- **证据**:
  - vote-app | 2026-07-09 | dev | 父进程（team3/web daemon）向子进程注入 `__NEXT_PRIVATE_STANDALONE_CONFIG`（指向 team3/web 的 next.config.ts）、`__NEXT_PRIVATE_ORIGIN`、`TURBOPACK=1`、`NODE_ENV=production`、`NODE_PATH`，覆盖本项目 next.config 导致 `next dev` 崩溃 `ERR_INVALID_ARG_TYPE at verifyTypeScriptSetup`

## Issue: 子进程与编排代码写同一文件路径导致覆盖
- **分类**: 2 — CLI 脚本化（兼 3 — 上下文架构）
- **改进建议**: harness 应在涉及 spawn 子进程写文件的编排逻辑中，强制使用 write-then-validate-then-move 模式：① 子进程写入临时文件（tmpDir），编排代码读取校验后再移动到最终路径；② 禁止子进程和编排代码写入同一文件路径；③ 在 harness 的 skill/orchestrator 模板中提供标准的 `writeTempAndValidate()` 工具函数。
- **证据**:
  - cbce_policy_dog | 2026-07-03 | arch | `wc3-claude.mjs` 将 `--output outputPath` 传给 claude 子进程，Claude 用 Write 工具直接将正确 policy markdown 写入 outputPath，但随后 wc3-claude.mjs 将 Claude 的文本响应（元描述"文件已生成并写入..."）写入同一 outputPath 覆盖了正确内容
