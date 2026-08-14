# 回归报告 — vote-app

- benchmark: min
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-04 18-52-26
- 结束时间: 2026-08-04 19-41-21

## 指标

- 回归是否通过：是
  - story 通过数 1/1
  - uat_report.md 是否生成: 是

- 总耗时: 54m 47s（仅 agent 执行，不含互等空转；从开始到完成经过时间 48m 55s）
  - arch：16m 14s
  - dev：16m 5s
  - uat：20m 49s
  - judge：1m 40s

- token 估算: total 251064（in 161721 / out 89343）
  - arch: 87651（in 62156 / out 25495）· 5 个 session
  - dev: 75286（in 43578 / out 31708）· 2 个 session
  - uat: 86763（in 54653 / out 32110）· 3 个 session
  - judge: 1364（in 1334 / out 30）· 3 个 session

- 总 llm 请求数：117
  - arch：41
  - dev：34
  - uat：39
  - judge：3

- Arch 派发的返工：无
  - dev_fix 0 次
  - uat_fix 0 次

- UAT 自修轮次: 0 轮
  - script_issue 0
  - product_issue 0

- 总 action 数: 16
  - 按任务类型: to_arch=5, to_human=4, note=2, dev_do=2, uat_design=1, to_uat=1, uat_check=1
  - 按谁发送的: arch=8, uat=4, human=2, dev=2

## 基线对比
- 无问题
