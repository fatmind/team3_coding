# Dev Tech Stack Constraints (team3)

> 单一事实源。任何 team3 项目（被开发/被回归）的 Next.js 技术栈都必须遵循本文件。
> Dev 动手写/改 init.sh 或 package.json 前必须先读本文件再选版本/写脚本/装依赖。
>
> 修改本文件需要人类 review 后才生效。

---

## 1. Next.js 版本策略

**业务项目（被 team3 开发的）与 team3 自托管（`team3/web`）统一**：
- **Next.js 16.x**（当前主流稳定线，与 `team3/web` 对齐）
- 配套 **React 19.x**、`react-dom 19.x`

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
    next dev --port 3001
```

- Next 16 默认使用 Turbopack，**不需要**也不要传 `--turbopack` / `--webpack` 参数
- `env -u TURBOPACK` 只是清掉父进程泄漏的变量值，不是禁用 Turbopack
- `NODE_ENV` 清掉是为了避免父进程的 production 状态污染（npm install 会跳过 devDependencies）
- `NODE_ENV=development` 在 dev 模式必须显式声明

---

## 3. package.json 必选字段

### `scripts`（写死，不要改顺序）
```json
{
  "scripts": {
    "dev": "env -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NEXT_DEPLOYMENT_ID -u TURBOPACK -u NODE_PATH NODE_ENV=development next dev --port 3001",
    "build": "env -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NEXT_DEPLOYMENT_ID -u TURBOPACK -u NODE_PATH NODE_ENV=production next build",
    "start": "env -u __NEXT_PRIVATE_STANDALONE_CONFIG -u __NEXT_PRIVATE_ORIGIN -u NEXT_DEPLOYMENT_ID -u TURBOPACK -u NODE_PATH NODE_ENV=production next start --port 3001",
    "test": "vitest run",
    "lint": "eslint ."
  }
}
```

> Next 16 已移除 `next lint`，lint 直接用 ESLint CLI（`eslint-config-next` 提供规则）。

### `dependencies`（必选）
- `next: ^16.0.0`
- `react: ^19.0.0`
- `react-dom: ^19.0.0`

### `devDependencies`（必选）
- `typescript: ^5.9.0`
- `@types/node: ^22.0.0`
- `@types/react: ^19.0.0`
- `@types/react-dom: ^19.0.0`
- `vitest: ^3.0.0`
- `@vitejs/plugin-react: ^4.0.0`
- `jsdom: ^26.0.0`
- `@testing-library/react: ^16.0.0`
- `vite-tsconfig-paths: ^5.0.0`
- `eslint: ^9.0.0`
- `eslint-config-next: ^16.0.0`
- `puppeteer-core: ^24.0.0`

### 测试配置（vitest.config.ts，写死）

**用 Vitest，禁止 jest 全家桶**——Vitest 是 Next.js 官方推荐的单测方案，原生 ESM/TS，无需任何转换器配置，速度远超 jest + ts-jest。

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: { environment: 'jsdom' },
});
```

- 组件测试用 `@testing-library/react`
- 纯 Node 逻辑的测试文件可在文件头用 `// @vitest-environment node` 覆盖环境
- 跑测试统一 `vitest run`（CI 模式，跑完退出），不要用 watch 模式

**禁止**：
- `jest` / `ts-jest` / `babel-jest` / `@types/jest`（统一 Vitest）
- `puppeteer`（用 `puppeteer-core` + 系统 Chrome，UAT 工具链 `cli/browser.mjs` 依赖此约定）

### lint 配置（eslint.config.mjs，写死）

`eslint-config-next@16` **原生导出 flat config 数组**，直接展开即可：

```js
import next from 'eslint-config-next';

export default [
  ...next,
  { ignores: ['node_modules/**', '.next/**', 'data/**', 'logs/**'] },
];
```

> **踩坑结论（比正确答案更省一轮时间）**：旧版那层 `FlatCompat` 兼容配置**已经不需要**了。
> 还按老写法用 `FlatCompat` 包一层会直接崩在 eslintrc 校验器里，**且报的是"循环引用"之类跟真实原因毫无关系的错**，顺着报错文字查会白花一轮。
> 见到 lint 配置类报错，先怀疑"配置格式代际不匹配"：去看 `node_modules/<pkg>/package.json` 的 `exports` 与版本，确认包导出的是新格式还是旧格式，再决定要不要兼容层。

### npm install 硬规则
```bash
npm install --include=dev --prefer-offline
```
**必须 `--include=dev`**，否则父进程 `omit=dev` 会跳过 devDeps 导致 vitest/puppeteer/typescript 缺失。

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

参考 `node_modules/next/dist/docs/` 实际文档，**不要靠记忆写**。Next.js 16 关键行为：
- App Router 是默认（不要再用 Pages Router）
- 请求相关 API 全部异步：`params`、`searchParams`、`cookies()`、`headers()` 必须 `await`
- 服务端组件默认异步（`async function Page()`）
- `next/image`、`next/link`、`next/navigation` 走 16 文档

---

## 6. 已记录在案的踩坑

- 2026-07-09 vote-app：父进程泄漏 NEXT_PRIVATE_STANDALONE_CONFIG → `env -u` 修复
- 2026-07-09 vote-app：`npm config get omit=dev` 跳过 devDeps → 显式 `--include=dev`
- 2026-08-04 vote-app：后端先行项目首个 feature 常无 2xx 路由，init.sh 就绪探针若只认 2xx（`curl -sf`），每次启动白等 60s → 探针默认 `curl -s -o /dev/null`（任意 HTTP 状态算就绪）；仅当项目自带首页等 2xx 路由时才用 `curl -sf`。404 可不可接受以 checkpoint 为准
- 2026-08-04 vote-app：`eslint-config-next@16` 已原生导出 flat config，仍按旧写法用 `FlatCompat` 包一层 → 崩在 eslintrc 校验器，报"循环引用"等与真实原因无关的错，白花一轮排查 → 正确写法见 §3「lint 配置」，兼容层直接删掉

任何项目发现新坑，**追加到本节并通知 Arch 升级本文件**。
