# 回归报告 — vote-app

- benchmark: min
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-05 10-21-00
- 结束时间: 2026-08-05 10-49-13

## 指标

- 回归是否通过：是
  - story 通过数 1/1
  - uat_report.md 是否生成: 是

- 总耗时: 29m 46s（仅 agent 执行，不含互等空转；从开始到完成经过时间 28m 13s）
  - arch：7m 59s
  - dev：12m 47s
  - uat：8m 33s
  - judge：0m 27s

- token 估算: total 272490（in 206666 / out 65824）
  - arch: 79867（in 65029 / out 14838）· 7 个 session
  - dev: 115555（in 81193 / out 34362）· 4 个 session
  - uat: 76099（in 59513 / out 16586）· 4 个 session
  - judge: 969（in 931 / out 38）· 2 个 session

- 总 llm 请求数：185
  - arch：49
  - dev：83
  - uat：51
  - judge：2

- Arch 派发的返工：有
  - dev_fix 1 次
  - uat_fix 1 次

- UAT 自修轮次: 1 轮
  - script_issue 0
  - product_issue 1

- 总 action 数: 19
  - 按任务类型: to_arch=7, dev_do=3, note=2, to_human=2, uat_design=1, to_uat=1, uat_check=1, dev_fix=1, uat_fix=1
  - 按谁发送的: arch=8, uat=5, dev=4, human=2

## 基线对比
- （评测模式：本次未对比效率基线）
