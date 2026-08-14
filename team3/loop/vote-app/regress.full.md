# 回归报告 — vote-app

- benchmark: full
- workspace: /tmp/t3-regress/vote-app
- 开始时间: 2026-08-03 20-05-41
- 结束时间: 2026-08-04 02-01-29

## 指标

- 回归是否通过：是
  - story 通过数 2/2
  - uat_report.md 是否生成: 是

- 总耗时: 349m 31s（仅 agent 执行，不含互等空转；从开始到完成经过时间 355m 48s）
  - arch：91m 11s
  - dev：247m 51s
  - uat：8m 34s
  - judge：1m 55s

- token 估算: total 3088426（in 2346589 / out 741837）
  - arch: 916501（in 768315 / out 148186）· 20 个 session
  - dev: 2112955（in 1536230 / out 576725）· 14 个 session
  - uat: 54917（in 38110 / out 16807）· 2 个 session
  - judge: 4053（in 3934 / out 119）· 8 个 session

- 总 llm 请求数：1166
  - arch：357
  - dev：789
  - uat：12
  - judge：8

- Arch 派发的返工：无
  - dev_fix 0 次
  - uat_fix 0 次

- UAT 自修轮次: 1 轮
  - script_issue 0
  - product_issue 1

- 总 action 数: 54
  - 按任务类型: to_arch=20, dev_do=13, note=11, to_human=7, uat_design=1, to_uat=1, uat_check=1
  - 按谁发送的: arch=31, dev=12, human=8, uat=3

## 基线对比
- 提示: token 明显上升：3088426 vs 基线 1207729（≥2×）
- 提示: llm 请求数明显上升：1166 vs 基线 493（≥2×）
- 提示: 执行耗时明显上升：349m 31s vs 基线 97m 25s（≥2×）
