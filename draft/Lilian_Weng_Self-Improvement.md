# Lilian Weng 两篇文章大白话总结

> 原文：[Harness Engineering for Self-Improvement](https://lilianweng.github.io/posts/2026-07-04-harness/) (2026-07-04) + [Scaling Laws, Carefully](https://lilianweng.github.io/posts/2026-06-24-scaling-laws/) (2026-06-24)

---

## 靠不靠谱？

**置信度：高。** Lilian Weng 是 OpenAI Applied Research 负责人，两篇都是综述性质——把近两年顶会论文、开源实验、业界实践系统梳理了一遍，每个结论都有对应论文引用和实验数据。Scaling Laws 那篇甚至附了可交互的拟合 demo，让你亲手拖滑块看拟合有多脆弱。不是她自己的一家之言，而是"把散落的拼图拼成一张图"。

---

# 第一篇：Harness Engineering for Self-Improvement

## 一、讲了什么

核心论点：**模型自我改进的近期突破口不在改权重，在改 Harness（模型外面那层调度系统）。**

Harness = 包裹裸模型的一整套东西：怎么拆任务、调什么工具、上下文怎么管、结果怎么评估、失败了怎么重试。Claude Code、Codex 这类产品的核心差异就在 Harness，不在底层模型。

文章的主线是一个递进关系：

```
手写 Prompt → 结构化上下文 → 工作流设计 → Harness 代码 → 让模型自己优化 Harness 代码
```

越往右，优化对象越复杂，但也越通用——一旦 Harness 本身变成可执行的搜索空间，模型就能用和人类工程师一样的设计空间来自我改进。

## 二、作者观点和关键经验

**1. "Harness 就是操作系统，不是 Prompt 模板"**

Harness 的设计模式更像 runtime/系统编程：状态机、权限控制、持久化存储、进程管理。早期 agent 框架（"LLM + memory + tools"）太简单了。

批判：说得对，但"像操作系统"也意味着复杂度爆炸。目前没看到哪家有稳定的 Harness 标准化方案。

**2. "文件系统是最好的长期记忆"**

不把所有状态塞进上下文窗口，而是写文件。实验 log、代码 diff、错误轨迹都落盘，下次任务从文件读。好处：天然持久、模型本来就会读写文件、上下文永远不会爆。

批判：对 coding 场景完美适配，但对非文件型任务（对话、决策）需要额外映射层。

**3. "可验证 = 一切，不可验证的场景，自己造验证函数"**

文章反复强调：自我改进循环能跑起来的前提是有自动评估。没有 verifier 的领域（科研品味、创意、UX），循环跑不动。

批判：这和 Boris 的观点完全一致。问题是"造验证函数"本身就是最难的工程动作。

**4. "底层模型必须够强，Harness 优化才有意义"**

STOP 实验里，GPT-4 跑递归自我改进能涨分，GPT-3.5 和 Mixtral 跑同样的循环反而降分。Harness 放大能力，但不能无中生有。

批判：直接的结论——小模型不要指望自我改进循环，先把模型换好再说。

## 三、核心方案

文章覆盖了 5 类 Harness 自我改进方法，从简到复杂：

### 整体图谱

```
                    Harness 自我改进方法
                           │
      ┌────────────┬───────┼───────┬────────────┐
      │            │       │       │            │
  上下文工程    工作流搜索  自改代码  进化搜索   联合改权重
  (ACE/MCE)   (ADAS/AFlow) (STOP/   (AlphaEvolve/ (SIA)
                           Self-     DGM)
                           Harness)
```

### 方法 1：上下文工程——ACE / MCE

**问题**：Agent 跑久了上下文爆炸。全塞进去模型读不动，随便砍又丢关键信息。

**ACE（Agentic Context Engineering）做法**：

把上下文当成一本「不断修订的手册」，三个角色维护：
- Generator：跑任务，产出轨迹
- Reflector：从成功/失败轨迹里提炼经验，写成 bullet points
- Curator：把新 bullet merge 进手册，去重、去过时的

关键细节：Curator 不是重写整个 prompt，而是输出结构化条目（ID + 描述），用确定性逻辑 merge 进 logbook，定期去重。这避免了"每次重写都丢信息"。

**MCE（Meta Context Engineering）做法**：

比 ACE 高一层——不只优化上下文内容，还优化"怎么管上下文"的策略本身。用 crossover 从历史 skill 里产生新 skill，再在新 skill 下优化上下文。实现：skill 就是一个目录（`skill.md` + 数据文件），用标准工具（Read/Write/Edit/Bash/Glob/Grep/TodoWrite）操作文件。

### 方法 2：工作流搜索——ADAS / AFlow

**ADAS**：用"元 agent"写代码生成新 agent。维护 archive（初始放 CoT、self-refine），元 agent 参考 archive 写新 agent 代码，跑 eval，好的加入 archive。

**AFlow**：把工作流表示成图（节点=LLM 调用，边=代码逻辑），用 MCTS 优化——选节点、让 LLM 根据评测结果改该节点、跑 eval、好的加回树，直到 top-k 均分不再涨。实验比手写工作流和 ADAS 都强（QA/代码/数学任务）。

### 方法 3：自改 Harness 代码——Self-Harness

**三阶段循环**：

```
挖弱点 → 提改动 → 验证合入
  │         │         │
  ▼         ▼         ▼
聚类失败轨迹  生成最小   回归测试：
成模式       代码修改    held-in 通过？
                       held-out 没退步？
                         │
                    通过 → 合入 h_{t+1}
                    不过 → 记录，不改
```

关键技术细节：
- **挖弱点不只看表面报错**：要记录三层信息——verifier 判定原因、agent 行为因果、轨迹暴露的抽象机制。因为表面相同的错误可能根因完全不同。
- **提改动有约束**：只改"editable surfaces"（可编辑表面），提案必须小而多样，不搞大改。
- **验证要两份数据**：held-in（弱点是否修了）+ held-out（别的没坏），缺一不合入。

实测结果（Terminal-Bench-2）：MiniMax M2.5 从 40.5%→61.9%，Qwen3.5 从 23.8%→38.1%，GLM-5 从 42.9%→57.1%。

### 方法 4：进化搜索——AlphaEvolve / DGM

**AlphaEvolve**：

Google DeepMind 做的进化式 coding agent。在代码里标记 `# EVOLVE-BLOCK-START` / `# EVOLVE-BLOCK-END`，让 LLM 只改这些区域。Prompt 里包含父代代码+评测结果+元信息。meta-prompt 本身也跟着一起进化（类似解和策略共同演化）。

成果：4×4 复数矩阵乘法用 48 次标量乘法搞定——56 年来首次改进 Strassen 算法。

**Darwin Gödel Machine (DGM)**：

把 agent 的整个代码仓库作为可进化对象：
1. 维护一个 agent 池子
2. 按性能概率选父代（性能高+子代少的优先）
3. 父代 agent 看自己的评测 log，用 `bash` 和 `editor` 工具改自己的 Harness 代码
4. 跑 eval，分数够高就加入池子
5. 循环

结果：Claude 3.5 Sonnet 上 SWE-bench 从 20%→50%，Polyglot 从 14.2%→30.7%。自发学会了：更好的代码编辑工具、长上下文管理、peer-review 机制。

### 方法 5：联合改权重——SIA

同时改 Harness 和模型权重。一个 Feedback-Agent 看轨迹，决定"这次该调 Harness 还是该 finetune 模型"。

作者自己的批判：实验设计有问题——做任务的 agent 用弱模型，做决策的 agent 用强模型（gpt-oss-120b vs Claude Sonnet 4.6），baseline 太弱，结果说服力不够。方向有意思但证据不充分。

## 四、七个没解决的硬伤

| # | 硬伤 | 大白话 |
|---|------|--------|
| 1 | 评估器太弱/太模糊 | 很多任务没法自动打分，循环跑不起来 |
| 2 | 上下文和记忆管理 | Agent 越自主，记忆越长，怎么裁剪是核心问题 |
| 3 | 不会放弃 | 文献偏向成功案例，模型不善于判断"该停了" |
| 4 | 多样性坍缩 | 进化/RL 容易陷入局部最优，群体趋同 |
| 5 | Reward hacking | 刷分、过拟合 judge、钻 benchmark 漏洞 |
| 6 | 只优化短期 | 代码可维护性、迁移成本、向后兼容性没人管 |
| 7 | 人的角色 | 人应该往上走（管方向），不是被踢出循环 |

---

# 第二篇：Scaling Laws, Carefully

## 一、讲了什么

**训练 LLM 时，模型大小 N 和数据量 D 该怎么分配算力？** 核心结论早就有了（Chinchilla 2022），但 Lilian 这篇的价值在于：把拟合过程拆开，让你看到 Scaling Law 有多脆弱——小数点精度、拟合区域、参数计数方式，随便动一个，外推结果就差几倍。

## 二、关键结论

**1. Chinchilla 定律：模型翻倍，数据也要翻倍**

给定算力 C，最优配置是 N 和 D 同比例增长（$N_{opt} \propto C^{0.5}$）。

这推翻了更早 Kaplan 的结论（Kaplan 说优先堆模型大小，$N_{opt} \propto C^{0.73}$，数据不用等比增长）。

验证：同样算力下，Chinchilla（70B 参数 + 1.4T token）全面超过 Gopher（280B 参数 + 300B token）。模型小 4 倍，数据多 4 倍，效果更好。

**2. Kaplan 和 Chinchilla 为什么结论不同？**

Kaplan 实验模型太小（768M–1.5B），embedding 占比大影响计数；加上 log-log 空间微小斜率差异外推后放大。Pearce & Song (2024) 证明：把 embedding 参数加回去后，两者在各自实验范围内并不矛盾。

**3. 数据重复训练有代价，但不是线性衰减**

没有新数据只能多轮训练。两篇研究的共同结论：重复数据的边际价值指数衰减（类似半衰期），但比多余参数衰减慢——数据不够时，多跑几轮比堆模型大小更划算。另外模型越大对重复越敏感，强 weight decay 能缓解。

**4. Scaling Law 拟合极其脆弱（这篇最重要的 takeaway）**

文章用 Besiroglu et al. 的 toy simulation 演示了三种"拟合翻车"：
- Loss 精度：把小数位从 4 位砍到 2 位，拟合参数就变了
- Loss 噪声：加 ±0.001 的扰动，结果就飘了
- 拟合区域：只用小模型数据拟合 vs 用全部数据拟合，外推差好几倍

Chinchilla 自己的 Method 3 之所以和 Method 1/2 有偏差，就是因为 L-BFGS 优化器早停 + 参数四舍五入。

## 三、硬伤

- **Power law 为什么成立？** 两个假说（数据流形维度 / 知识量子化），但都没有一锤定音的证明。经验公式好用但理论根基不稳。
- **拟合窗口太小就别外推**：所有 Scaling Law 的实际用法都是"小模型拟合→大模型外推"。如果小模型训练不充分，或者拟合区域和目标差太远，外推就是赌博。
- **数据质量没进公式**：D 只是 token 数量，同样 1T token 用不同清洗策略效果天差地别。公式假设数据质量恒定，现实中这是最大变量。
- **架构/优化器/tokenizer 变了就得重新拟合**：公式假设"只变 N 和 D，其他不动"。换了架构或训练 recipe，之前拟合的参数可能全废。

---

## 四、链接

- [Harness Engineering for Self-Improvement](https://lilianweng.github.io/posts/2026-07-04-harness/) —— Lilian Weng 关于 Harness 自我改进的综述
- [Scaling Laws, Carefully](https://lilianweng.github.io/posts/2026-06-24-scaling-laws/) —— Lilian Weng 关于 Scaling Law 拟合细节的综述
- [Self-Harness (arXiv:2606.09498)](https://arxiv.org/abs/2606.09498) —— 模型自己改自己的 Harness 代码
- [Darwin Gödel Machine (arXiv:2505.22954)](https://arxiv.org/abs/2505.22954) —— 进化式自改 agent 代码仓库
- [AlphaEvolve (arXiv:2506.13131)](https://arxiv.org/abs/2506.13131) —— Google DeepMind 进化 coding agent
- [Chinchilla (Hoffmann et al. 2022)](https://arxiv.org/abs/2203.15556) —— 算力最优分配的经典论文
- [Besiroglu et al. 2024](https://arxiv.org/abs/2404.10102) —— Chinchilla 复现，揭示拟合脆弱性
