# 回归报告 — vote-app

- benchmark: min
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-05 18-35-02
- 结束时间: 2026-08-05 18-55-44

## 指标

- 回归是否通过：是
  - story 通过数 1/1
  - uat_report.md 是否生成: 是

- 总耗时: 22m 54s（仅 agent 执行，不含互等空转；从开始到完成经过时间 20m 42s）
  - arch：6m 53s
  - dev：8m 15s
  - uat：7m 24s
  - judge：0m 21s

- token 估算: total 213822（in 152468 / out 61354）
  - arch: 79774（in 68947 / out 10827）· 7 个 session
  - dev: 75199（in 43537 / out 31662）· 2 个 session
  - uat: 57901（in 39055 / out 18846）· 3 个 session
  - judge: 948（in 929 / out 19）· 2 个 session

- 总 llm 请求数：130
  - arch：67
  - dev：36
  - uat：25
  - judge：2

- Arch 派发的返工：无
  - dev_fix 0 次
  - uat_fix 0 次

- UAT 自修轮次: 0 轮
  - script_issue 0
  - product_issue 0

- 总 action 数: 19
  - 按任务类型: to_arch=7, note=3, to_human=3, dev_do=2, uat_check=2, uat_design=1, to_uat=1
  - 按谁发送的: arch=9, uat=5, human=3, dev=2

## 基线对比
- （评测模式：本次未对比效率基线）
