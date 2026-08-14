# 回归报告 — vote-app

- benchmark: min
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-05 18-56-52
- 结束时间: 2026-08-05 19-42-33

## 指标

- 回归是否通过：是
  - story 通过数 1/1
  - uat_report.md 是否生成: 是

- 总耗时: 49m 37s（仅 agent 执行，不含互等空转；从开始到完成经过时间 45m 41s）
  - arch：8m 39s
  - dev：26m 43s
  - uat：12m 36s
  - judge：1m 40s

- token 估算: total 224783（in 153955 / out 70828）
  - arch: 60229（in 50802 / out 9427）· 5 个 session
  - dev: 117356（in 68243 / out 49113）· 2 个 session
  - uat: 45761（in 33525 / out 12236）· 3 个 session
  - judge: 1437（in 1385 / out 52）· 3 个 session

- 总 llm 请求数：131
  - arch：37
  - dev：62
  - uat：29
  - judge：3

- Arch 派发的返工：无
  - dev_fix 0 次
  - uat_fix 0 次

- UAT 自修轮次: 0 轮
  - script_issue 0
  - product_issue 0

- 总 action 数: 14
  - 按任务类型: to_arch=5, note=2, dev_do=2, to_human=2, uat_design=1, to_uat=1, uat_check=1
  - 按谁发送的: arch=6, uat=4, human=2, dev=2

## 基线对比
- （评测模式：本次未对比效率基线）
