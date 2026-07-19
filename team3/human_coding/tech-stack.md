# Tech Stack Constraints (team3)

> 单一事实源。任何 team3 项目（被开发/被回归）的 Next.js 技术栈都必须遵循本文件。
> Arch/Dev 启动 session 后必须先读本文件再选版本/写 init.sh/装依赖。
>
> 修改本文件需要人类 review 后才生效。

---

## 1. Next.js 版本策略

**业务项目（被 team3 开发的）**：
- **Next.js 14.2.x**（LTS 稳定线）
- 配套 **React 18.3.x**、`react-dom 18.3.x`

为什么不是 16.x（基于 2026-06~07 多次踩坑）：
- Next.js 16 的 Turbopack `distDirRoot` panic + 与 `--webpack` 冲突
- Next.js 16 的 `_global-error` 预渲染 useContext null
- 多次降级到 14.2 才稳定

**team3 自托管（`team3/web`）**：可以继续用 Next 16.2 + React 19（不是被开发项目，无业务回归风险）。

---

## 2. 启动前必须清理的环境变量

父进程/daemon 可能向子进程注入下列污染变量，会让 `next dev/build` 崩或行为异常。**所有 init.sh 启动命令前必须先 `env -u`**：

```bash
env -u __NEXT_PRIVATE_STANDALONE_CONFIG \
    -u __NEXT_PRIVATE_ORIGIN \
    -u NEXT_DEPLOYMENT_ID \
    -u TURBOPACK \
    -u NODE_PATH \
    -u NODE_ENV \
    next dev --port 3001 --webpack
```

`NODE_ENV` 也清掉是为了避免父进程的 production 状态污染（npm install 会跳过 devDependencies）。

**显式设置该清的清、该留的留**：
- `NODE_ENV=development` 在 dev 模式必须显式声明
- `TURBOPACK=`（空）显式禁用 Turbopack

---

## 3. package.json 必选字段

### `scripts`（写死，不要改顺序）
```json
{
  "scripts": {
    "dev": "env -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NEXT_DEPLOYMENT_ID -u TURBOPACK -u NODE_PATH NODE_ENV=development next dev --port 3001 --webpack",
    "build": "env -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NEXT_DEPLOYMENT_ID -u TURBOPACK -u NODE_PATH NODE_ENV=production next build",
    "start": "env -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NEXT_DEPLOYMENT_ID -u TURBOPACK -u NODE_PATH NODE_ENV=production next start --port 3001",
    "test": "jest",
    "lint": "next lint"
  }
}
```

### `dependencies`（必选）
- `next: ^14.2.0`
- `react: ^18.3.0`
- `react-dom: ^18.3.0`

### `devDependencies`（必选）
- `typescript: ^5.4.0`
- `@types/node: ^20.0.0`
- `@types/react: ^18.3.0`
- `@types/react-dom: ^18.3.0`
- `jest: ^29.7.0`
- `ts-jest: ^29.1.0`
- `@types/jest: ^29.5.0`
- `puppeteer-core: ^21.11.0`

**禁止**：
- `puppeteer`（用 `puppeteer-core` + 系统 Chrome）
- `vitest`（业务项目用 jest，与回归基线对齐）
- 任何 Turbopack 插件（`--webpack` 锁死）

### npm install 硬规则
```bash
npm install --include=dev --prefer-offline
```
**必须 `--include=dev`**，否则父进程 `omit=dev` 会跳过 devDeps 导致 jest/puppeteer/typescript 缺失。

---

## 4. 端口与进程管理

- 业务 App 端口：**`3001`**（写死在 init.sh，不读 `PORT` 环境变量）
- 保留端口（业务项目不得使用、不得清理）：
  - `7001` — `team3/web` 的 `npm run dev`
  - `9001` — `team3 start` 主进程
- 端口被占用但不是当前项目 PID → **直接报错退出，禁止自动 kill**

**禁止**：
- `lsof -ti:<port> | xargs kill`
- `kill $(lsof -ti:<port>)`
- `pkill node` / `killall node`
- `PORT=... npx next dev`（不允许手动覆盖端口）
- `npm run dev -- --port ...`（不允许在 scripts 外覆盖）

**关服唯一方式**：`./init.sh stop`（关闭 PID 文件里的进程）。

---

## 5. Next.js 代码约束

参考 `node_modules/next/dist/docs/` 实际文档，**不要靠记忆写**。Next.js 14 与 13/15 行为差异：
- App Router 是默认（不要再用 Pages Router）
- `next/image`、`next/link`、`next/navigation` 走 14 文档
- 服务端组件默认异步（`async function Page()`）

---

## 6. 已记录在案的踩坑

- 2026-06-01 hero_accessories：Next 16 dispatcher null → 降级 14
- 2026-06-18 hero_accessories：Next 16.2.9 Turbopack distDirRoot + NODE_ENV=production 跳过 devDeps
- 2026-07-09 vote-app：父进程泄漏 NEXT_PRIVATE_STANDALONE_CONFIG → `env -u` 修复
- 2026-07-09 vote-app：`npm config get omit=dev` 跳过 devDeps → 显式 `--include=dev`

任何项目发现新坑，**追加到本节并通知 Arch 升级本文件**。
