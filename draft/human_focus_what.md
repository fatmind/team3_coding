# 人类该聚焦什么

> 一次和 AI 协作发现"Arch 验收形同虚设"，由此提炼人-AI 分工的具体做法。

---

## 1. 问题

> "arch 要起到一个很大作用是 【MODE B: REVIEWING DEV'S DELIVERY】，从前面 3 个 feature 交付来看，arch 全部都通过了，一点问题都没找到，甚至建议都没有。这个机制，看起来并没有生效，你帮我 review 下"

下沉一查，3 个 feature 里藏了 3 类硬伤：

- `daemon/e2e/feature_2/test3_actions_jsonl.js` 是 tautology——mock spawn 自己往 `actions.jsonl` 写一行，再断言文件里有那行，被 Arch 标 ✅
- `daemon/e2e/feature_3/` 4 个 e2e 全部 mock spawn，claude 从未真实启动
- `daemon/src/agent-scheduler.js` 自生成 UUID 写 `.team3-project.json`，绕过了 Feature #2 的 `init-agent.js`，但 Arch 验收声称"Feature #1/#2 回归全绿"

Arch 写的"亮点"全是照抄 Dev 交付总结的关键词，没有一条独立观察。

---

## 2. 感受

> "我现在感受是：和 ai 配合，人不能频繁切换在多个事项上，还是得聚焦在长距离思考上，主要在 spec / feature checkpoint / ux 交互，其它的要敢于放给 AI。"
> "让大脑要能休息，能聚焦把一个事想透彻、跨天跨周长思考，否则都在表面考虑、人脑疲于应付，你是很难和 ai 协作，因为 ai 生产内容太快，而且你觉得 ai 大部分都是对的。"

---

## 3. 原则

### 3.1 人跑慢环、AI 跑快环

人聚焦 **错了成本高、自动化又抓不住** 的事：

- **spec**：错了整个 module 得重来
- **feature checkpoint**：强迫你重新琢磨，什么是重点、什么可以简化
- **UX 交互**：ai 没有主观感觉
- **决定不做什么**：AI 倾向"完整覆盖"，砍是全局的、负向的，AI 很少做

> 人下沉到快环和 AI 拼速度 —— 必输（AI 太快、且大部分是对的），被反噬。

### 3.2 但"放手"不是"不看"

若只在慢环、不去看，就会出现这次问题：spec 写得再好，AI 用 mock 把真东西架空，spec 等于空转。

**人在慢环 + 定时下潜**。下潜是带着慢环里想透的判断框架下去核查一两个点。

### 3.3 定时下潜怎么做

**啥时候下来看？**
- 一个 module 做完

**看啥？**
- 你先说清，你对这个 module 定位、核心能力 vs 当前功能实现、是否做多了、是否做复杂了
- 从架构上，是否保持 简单、低耦合、易扩展，对未来迭代友好 vs 当前代码实现
- 找 1 个 feature，你认为的最关键的
    - review 核心代码
    - review e2e 验收代码
- 警惕 arch "全过"

> 要求：人脑带宽是有限的，此时分析一定要摒弃繁琐细节、抓关键，大白话讲清楚

---

## 附 1：案例 —— Arch 重写 MODE B（"机制问题改 prompt"实操）

发现 Arch 漏了 3 类问题（mock spawn / tautology / 跨 feature 接口绕过）。**不是人工去修，而是改要求，让 AI 自己修：**

**1. 改 `human_coding/ARCHITECT_PROMPT.md` 的 MODE B**
- 加入"对抗式 checklist" 4 项（单测 assert 真测逻辑 / e2e 真实端到端 / 无 tautology / 跨 feature 接口真复用）
- 调整审查顺序 ... 等

**2. 改 `human_coding/DEV_PROMPT.md`**
用同一把尺让 Dev 在 STEP 4/5 提前自查：写代码前先扫 `src/` 复用 / 单测禁止 tautology / e2e 不许 mock 被测主体 等

**3. 让 Arch 重新 Review**
- 新增 Feature #8（重构：抽出共享 `claude-args.js`，消除平行实现）
- 新增 Feature #9（消除 tautology + 引入 `stub-claude.sh` 替代 mock spawn 函数）

**4. 先修问题不累积**
- 先暂停 Feature #4 开发
- 先开发 #8、#9，让问题不要累积、越到后面影响越多