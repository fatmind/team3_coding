# 回归报告 — vote-app

- benchmark: min
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-05 10-50-07
- 结束时间: 2026-08-05 11-49-50

## 指标

- 回归是否通过：是
  - story 通过数 2/2
  - uat_report.md 是否生成: 是

- 总耗时: 66m 6s（仅 agent 执行，不含互等空转；从开始到完成经过时间 59m 43s）
  - arch：16m 34s
  - dev：21m 51s
  - uat：26m 27s
  - judge：1m 15s

- token 估算: total 274751（in 167702 / out 107049）
  - arch: 75962（in 51390 / out 24572）· 4 个 session
  - dev: 95900（in 53091 / out 42809）· 2 个 session
  - uat: 102413（in 62755 / out 39658）· 3 个 session
  - judge: 476（in 466 / out 10）· 1 个 session

- 总 llm 请求数：120
  - arch：40
  - dev：43
  - uat：36
  - judge：1

- Arch 派发的返工：无
  - dev_fix 0 次
  - uat_fix 0 次

- UAT 自修轮次: 0 轮
  - script_issue 0
  - product_issue 0

- 总 action 数: 15
  - 按任务类型: to_arch=5, to_human=3, note=2, dev_do=2, uat_design=1, to_uat=1, uat_check=1
  - 按谁发送的: arch=7, uat=4, human=2, dev=2

## 基线对比
- （评测模式：本次未对比效率基线）
