# UI Feature（Dev）

> 触发：`dev_do` / `dev_fix` message 含 `[ui-init: <品牌名>]`，或项目已有 `DESIGN-LANGUAGE.md`。

## UI 规则初始化（收到 `[ui-init: <品牌名>]` 时，STEP 1 初始化环境后执行）

```bash
node cli/init-ui-rules.mjs . --brand <品牌名>
```

- **默认可重复执行**：已有 StyleSeed 文件（`DESIGN-LANGUAGE.md`、`css/theme.css` 等）不覆盖，重复跑安全
- **`--force` 仅在明确需要时用**：换品牌、或要把 StyleSeed 模板文件重置为 engine 默认。会覆盖已有 engine 文件和 `theme.css`，Dev 改过的设计文件会丢——**不要作为常规命令加在每次 init 上**
- 如果命令失败（品牌不存在、DESIGN.md 拉取失败、StyleSeed cache 失败等），不要自己换品牌、不要猜色值。把失败原因写入 `Dev Delivery` 的 `UI Quality Evidence`，并 `to_arch` 说明需要换品牌或补设计输入

## 交付前自查（STEP 6 逐条过）

1. 读 `spec/app_design.md` 的 `## UX/UI 输入` + `spec/ux_*` 交互草稿图，确认布局方向对齐
2. 启动 dev server → 打开**真实页面 URL** → 截图检查比例/溢出/可点击状态（截图存 `/tmp/<project>/ui-screenshots/`）
3. 跑 `/ss-lint` 扫描设计 token 违规
4. 在 Dev Delivery 中附上 `UI Quality Evidence`

## UI Quality Evidence（STEP 7 追加进 Dev Delivery 的固定证据块）

```markdown
### UI Quality Evidence

- ui_init: pass | fail | skipped
- brand: <品牌名>
- theme_source: skin:<brand> | design-md:<brand> | failed:<reason>
- screenshots:
  - /tmp/<project>/ui-screenshots/xxx.png
- ss_lint: pass | fail | not_run
- self_check:
  - layout_ratio: pass | fail
  - overflow: pass | fail
  - clickable_states: pass | fail
- notes: ...
```
