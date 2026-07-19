# 效率基线 — vote-app（profile: full）

- 建立时间: 2026-07-18T02:27:02.546Z
- 一次性完成: 否
- token 估算: 1829906
- 耗时: 139m 57s
- 总 action 数: 94
- acceptance: 未运行（harness 超时导致跳过）

> 后续回归对比下方 json；一次性完成由「是」变「否」→ 强报警；token/耗时 ≥ 2× → 弱提示。
> 注：本次因检测逻辑 bug（要求 uat_report 覆盖全部 spec story，实际 UAT 只跑了 5/7）导致 harness 超时，
> 但项目实际已完成（state.json 5/5 pass）。检测逻辑已修复（新增 detectStateCompletion）。

```json
{
  "profile": "full",
  "oneShot": false,
  "tokensTotal": 1829906,
  "durationMs": 8397000,
  "totalActions": 94,
  "acceptance": null,
  "createdAt": "2026-07-18T02:27:02.546Z",
  "detail": {
    "devRework": 3,
    "uatRework": 3,
    "repairRounds": 2,
    "storiesPassed": 5,
    "storiesInSpec": 7,
    "commits": 17,
    "tokensByRole": {
      "arch": { "input": 357969, "output": 87274, "total": 445243, "results": 31 },
      "dev": { "input": 489151, "output": 101244, "total": 590395, "results": 12 },
      "uat": { "input": 686039, "output": 108229, "total": 794268, "results": 10 }
    },
    "actionDistribution": {
      "to_arch": 29,
      "note": 21,
      "to_human": 12,
      "dev_do": 11,
      "dev_done": 8,
      "uat_check": 5,
      "dev_fix": 3,
      "uat_fix": 3,
      "uat_done": 1,
      "uat_design": 1
    }
  }
}
```
