# UAT Scaffold 工具（UAT）

> 触发：MODE B 动手写 `uat/story_N/verify.mjs` 前。工具在 `uat/` 目录下，init 时已拷贝。

## 工具清单

| 文件 | 用途 | 用法 |
|------|------|------|
| `simulate_human.mjs` | 模拟产品最终用户的决策/内容生成 | `import { createHumanSimulator } from './simulate_human.mjs'` |
| `logger.mjs` | 写 `logs/uat.log`，带时间戳 | `import { createLogger } from './logger.mjs'` |
| `browser.mjs` | puppeteer-core + 本地 Chrome | `import { launchBrowser } from './browser.mjs'` |

## simulate_human.mjs 说明

- 包装 `claude -p` 调用，内置 system prompt（模拟产品用户角色）
- 一个 session 模拟所有角色（群主、同学等），通过传入上下文切换
- session 自动复用（`--session-id` 首次，`--resume` 后续），保持上下文连贯
- 只返回内容/决策文本，**不返回操作代码**——操作由你写 puppeteer 执行
- 超时自动重试 2 次

```javascript
const human = createHumanSimulator({ workspace: process.cwd(), logger: log });
const { content } = await human.ask('你是群主，要创建周六的羽毛球活动，给出活动信息 JSON');
// content = '{"venue":"阳光馆","date":"2026-06-01",...}'
// 然后你自己写 puppeteer 代码：
await page.type('#venue', JSON.parse(content).venue);
```
