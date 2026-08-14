# 回归报告 — vote-app

- benchmark: min
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-04 17-59-07
- 结束时间: 2026-08-04 18-49-24

## 指标

- 回归是否通过：是
  - story 通过数 1/1
  - uat_report.md 是否生成: 是

- 总耗时: 52m 55s（仅 agent 执行，不含互等空转；从开始到完成经过时间 50m 18s）
  - arch：14m 15s
  - dev：18m 49s
  - uat：17m 12s
  - judge：2m 39s

- token 估算: total 263485（in 169638 / out 93847）
  - arch: 74067（in 55403 / out 18664）· 4 个 session
  - dev: 102963（in 63406 / out 39557）· 2 个 session
  - uat: 84118（in 48552 / out 35566）· 3 个 session
  - judge: 2337（in 2277 / out 60）· 5 个 session

- 总 llm 请求数：142
  - arch：46
  - dev：53
  - uat：38
  - judge：5

- Arch 派发的返工：无
  - dev_fix 0 次
  - uat_fix 0 次

- UAT 自修轮次: 0 轮
  - script_issue 0
  - product_issue 0

- 总 action 数: 16
  - 按任务类型: to_arch=5, to_human=4, note=2, dev_do=2, uat_design=1, to_uat=1, uat_check=1
  - 按谁发送的: arch=8, uat=4, human=2, dev=2