# 效率基线 — vote-app（由一次通过的回归结果另存）

- benchmark: full
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-03 17-23-58
- 结束时间: 2026-08-03 18-51-57

## 指标

- 回归是否通过：是
  - story 通过数 2/2
  - uat_report.md 是否生成: 是

- 总耗时: 97m 25s（仅 agent 执行，不含互等空转；从开始到完成经过时间 87m 59s）
  - arch：25m 41s
  - dev：55m 58s
  - uat：14m 31s
  - judge：1m 14s

- token 估算: total 1207729（in 938970 / out 268759）
  - arch: 336434（in 278189 / out 58245）· 9 个 session
  - dev: 749116（in 581255 / out 167861）· 7 个 session
  - uat: 118856（in 76373 / out 42483）· 3 个 session
  - judge: 3323（in 3153 / out 170）· 7 个 session

- 总 llm 请求数：493
  - arch：126
  - dev：293
  - uat：67
  - judge：7

- Arch 派发的返工：有
  - dev_fix 1 次
  - uat_fix 0 次

- UAT 自修轮次: 0 轮
  - script_issue 0
  - product_issue 0

- 总 action 数: 27
  - 按任务类型: to_arch=10, dev_do=6, to_human=5, note=2, dev_fix=1, uat_design=1, to_uat=1, uat_check=1
  - 按谁发送的: arch=14, dev=7, uat=4, human=2
