# Badcase 分析：Qwen-latest-series-invite-beta-v118 vs 基线

## 结论速览

被测功能全部达成（任务完成率 100%、Story 一次通过、零返工），但**任务耗时退化 2.2x**（22m54s → 49m37s），问题几乎全在 **dev 角色**。根因是行为习惯而非能力：dev 把长思考摊到每一步、执行步长过碎，加上少量工具绕路，"轮次多 × 单轮慢"相乘拖出 2.2x。（Token 仅多 5%，属正常波动，不作分析。）

## 现象分析

### 现象1：任务耗时退化 2.2x，全部压在 dev 角色

被测总耗时 22m54s → 49m37s（2.2x）。差出的 27 分钟里，dev 一个角色就占了 18.5 分钟（495s → 1,603s，+1,108s），arch/uat 基本无退化。dev 耗时 = 请求数 62 vs 36（+72%）× 单请求平均耗时 25.9s vs 13.75s（+88%），相乘 ≈ 3.2x，与实测吻合——即"轮次更多 × 单轮更慢"双升相乘。

**证据**

1、长思考拖慢每一轮：被测 dev1 请求间隔 p90=106s、中位 21s、最慢单轮 129s；基线 dev1 p90=11s、中位 0s（连续工具调用），除开头 136s 大规划外没超过 28s。被测 >3000 字符的长思考 11 次 vs 基线 3 次，"中等思考"轮次（3k-6k 字符）每次要等 30-60s、出现 8 次。

2、行为性绕路推高轮次：① 读错路径——dev1 第 1 轮读 `/tmp/t3-regress/vote-app/dev-tech-stack.md` 报 `File does not exist`，下一轮才改绝对路径（1 次无效请求），基线一次成功；② e2e 配置折腾——先 Edit `vitest.config.ts` 再新建 `vitest.e2e.config.ts` 再分别跑，多花 3-4 轮并留下基线没有的产物 `vitest.e2e.config.ts`、`tsconfig.tsbuildinfo`，基线直接 `npm test` + 一条 node 脚本一轮过；③ e2e 脚本反复调试——dev2 对 `e2e/feature_2/test1_create_api.mjs` 连续 Read 7 次、Edit 3 次才跑通，基线一次写对；④ 步长过碎——TaskUpdate 一次一个请求单独成轮（dev1 有 9 次），基线批量放进同一条消息。

3、数据来源：轨迹 `eval.min.evidence.20260805` 的 dev 会话，对照被测/基线的 `request-ids.jsonl` 时间戳、各轮 assistant 消息，以及两模型保留工程目录的产物 diff（多余的 `vitest.e2e.config.ts` 等可证）。

**根因**

三层叠加——(a) 单轮思考过长且分散，拖慢每一轮；(b) 轮次多（小步化 + 多余的配置/调试往返）；(c) 少量工具绕路（读错路径、另起 vitest 配置）。三者都是行为习惯，不是理解或编码能力（最终代码正确、e2e 全绿、零返工）。
