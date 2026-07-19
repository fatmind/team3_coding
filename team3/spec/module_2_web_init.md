# Module 2: 项目初始化（目录结构 + Daemon + Agent）

## 一句话

为每个角色（Arch / Dev / UAT）定义 prompt，并通过 prompt 约束 agent 在每次任务，开始读取项目全局知识、末尾自我总结写入 `decision_log.md`。
初始化项目本地目录结构，启动 daemon 和 agent。

## 架构思路

### agent 拆分和定义

1、拆分定义 Agent，避免单 Agent 混淆过多角色
- 定义 arch、dev、uat 角色，prompt 通过 embedded prompts 内联传递（详见 `packaging_design.md`），不再 copy 到项目目录
- 全局工作流说明已内联在各 agent 的 system prompt 中

2、Arch、Dev、Uat 要求建立项目全局认识

```
1. system prompt（内联）— 全局工作流和协作规则
2. `spec/app_design.md` — 产品架构设计
3. `spec/decision_log.md` — 人类决策记录 + Agent 历史经验教训
4. `spec/modules_progress.json` — 整体进展总览
5. module 设计文档 `spec/module_X.md`
    - Arch / Dev：**当前正在处理的** module_X.md
    - UAT：**所有** module_X.md（需要产品全局视野） 
```

3、Arch / Dev / UAT 提炼人类决策、自己执行过程的经验教训
- prompt 指导 agent **按需**写入 `spec/decision_log.md` —— 满足触发条件才写，写入前合并同主题、冲突标 `//conflict` 不自行裁决，且通知人类去判断
- **触发条件**（满足任一才写，不强制每次任务必写）：
    - 人类做出非显然决策（讨论中的判断）
    - 自己踩到非显然坑或独到调试技巧
    - 发现既有记录需修订或与现状冲突
- decision_log.md 格式要求
```markdown
## YYYY-MM-DD HH:mm:ss | 记录者 | 类型（人类决策/经验教训）
**背景**
**结论**
```

4、Uat 验收产品、独立执行，不受 Arch、Dev 影响
  - **UAT**：阶段 1 基于 app_design.md + 所有 module_X.md 设计 `spec/uat_stories.md`；阶段 2 跑 uat_stories.md 验收产品。
  - 全程不读 feature_list / progress / 业务代码，黑盒验证，**不允许任何 mock/stub**。

### 整体初始化流程

- 初始化本地项目目录：按照 app_design "项目工作目录结构"，初始化 Team3 协作骨架（spec/、.team3-project.json、uat/ 等），成功后更新 <.team3-project.json> init_workspace
    - 提醒：业务代码目录不在初始化阶段预建，由 Dev 首次开发时按技术栈在 workspace root 下创建
- 启动 daemon：返回进程 PID、更新 <.team3-project.json> init_daemon
- 初始化 agent：执行 module3 init_agent 接口，初始化 arch、uat
- dev 启动：由 arch 动态决策，写入 actions.jsonl，daemon 监测到后，会调度 spawn claude 启动 dev


## 验收场景

| # | 场景 | 验证要点 |
|---|------|---------|
| S1 | 项目初始化本地目录 | `spec/`、`cli/`、`uat/`、`logs/` 存在，cli/ 含 scaffold 工具，遵循 app_design "项目工作目录结构"  |
| S2 | 启动 daemon | 启动成功后，更新 .team3-project.json |
| S3 | 初始化 Agent | 调用 module3 init_agent 接口返回成功，actions.jsonl 中写入通知人类 arch 在线  |
| S4 | 验证 Agent，全局知识读取 | 验证每个 Agent 正确读取前置全局知识文件  |
| S5 | Arch、Dev Agent，记录人类决策/总结经验 | 人类消息/Agent 执行，验证每个 Agent 更新 decision_log.md |
| S6 | 写入 actions.jsonl 符合规范 | 写入 actions.jsonl 符合规范 |


## 技术栈

- daemon spawn 启动 Agent 时，通过 `--system-prompt` 内联传递 embedded prompts（详见 `packaging_design.md`）
- 更新 actions.jsonl：Agent 使用 `cli/write-action.mjs` 写入（格式校验 + 单行保证 + appendFileSync 原子追加），详见 app_stability.md 消息总线写入端约束
- TODO：decision_log.md 未来需要考虑，人类沟通时特殊性，一个决策发送多条消息、有前后上下文

## 工程位置

- 与 Module 1 同属一个工程，`team3/web/src/lib/init/`