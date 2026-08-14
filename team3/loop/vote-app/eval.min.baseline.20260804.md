# 回归报告 — vote-app

- benchmark: min
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-04 21-36-00
- 结束时间: 2026-08-04 22-27-28

## 指标

- 回归是否通过：是
  - story 通过数 1/1
  - uat_report.md 是否生成: 是

- 总耗时: 61m 3s（仅 agent 执行，不含互等空转；从开始到完成经过时间 51m 28s）
  - arch：18m 8s
  - dev：20m 54s
  - uat：20m 35s
  - judge：1m 26s

- token 估算: total 405143（in 283968 / out 121175）
  - arch: 114348（in 83493 / out 30855）· 5 个 session
  - dev: 135463（in 85317 / out 50146）· 2 个 session
  - uat: 151814（in 111783 / out 40031）· 3 个 session
  - judge: 3518（in 3375 / out 143）· 7 个 session

- 总 llm 请求数：204
  - arch：70
  - dev：79
  - uat：48
  - judge：7

- Arch 派发的返工：无
  - dev_fix 0 次
  - uat_fix 0 次

- UAT 自修轮次: 0 轮
  - script_issue 0
  - product_issue 0

- 总 action 数: 19
  - 按任务类型: to_arch=6, to_human=5, note=3, dev_do=2, uat_design=1, to_uat=1, uat_check=1
  - 按谁发送的: arch=10, uat=4, human=3, dev=2

## 基线对比
- （评测模式：本次未对比效率基线）
