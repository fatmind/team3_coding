# 回归报告 — vote-app

- benchmark: min
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-04 22-28-42
- 结束时间: 2026-08-04 23-25-18

## 指标

- 回归是否通过：是
  - story 通过数 2/2
  - uat_report.md 是否生成: 是

- 总耗时: 61m 31s（仅 agent 执行，不含互等空转；从开始到完成经过时间 56m 36s）
  - arch：14m 8s
  - dev：19m 9s
  - uat：26m 45s
  - judge：1m 30s

- token 估算: total 266481（in 168957 / out 97524）
  - arch: 76808（in 56281 / out 20527）· 4 个 session
  - dev: 91829（in 54179 / out 37650）· 2 个 session
  - uat: 96943（in 57615 / out 39328）· 3 个 session
  - judge: 901（in 882 / out 19）· 2 个 session

- 总 llm 请求数：114
  - arch：42
  - dev：38
  - uat：32
  - judge：2

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
