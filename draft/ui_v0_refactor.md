# v0 ↔ 代码双向流转方案

## Context

team3/web 的 UI 需要持续迭代。日常小改 Claude Code 直接处理；大的交互调整需要用 v0 可视化设计。核心目标是建立低成本的双向流转机制，避免每次来回都大量冲突合并。

---

## 核心架构：Hooks 隔离数据层

```
组件层 (components/)     ← v0 修改区，纯 UI 渲染
        │ 调用
Hook 层 (hooks/)         ← 数据抽象，统一接口
        │ 调用                真实版: fetch API + WebSocket
        │                     Mock 版: 返回静态数据
API 层 (app/api/)         ← v0 永不触碰
```

组件通过 hooks 获取数据，不直接 fetch。导出到 v0 时，hooks 目录替换为 mock 版本，组件零修改。从 v0 导入时，只覆盖 components/，hooks 自动提供真实数据。

---

## 目录结构

移除 `src/` 与 v0 对齐（`tsconfig.json` paths: `@/*` → `./*`）。

> **为什么移除 `src/`**：v0 始终生成不带 `src/` 的目录结构。保留 `src/` 意味着每次导入导出都要搬文件路径，增加摩擦。一次性移除后，双向流转零路径适配。

```
team3/web/
├── app/
│   ├── page.tsx          # 项目列表首页（保留独立页面）
│   ├── workspace/
│   │   └── page.tsx      # 主工作台：sidebar + tabs 单页架构 (v0 设计)
│   ├── api/              # API routes (v0 不碰)
│   ├── globals.css       # Tailwind v4 + shadcn 主题变量 (CSS-first, 无 tailwind.config.ts)
│   └── layout.tsx
├── components/           # 业务组件 (v0 交换区)
│   ├── ui/               # shadcn 基础组件
│   ├── sidebar.tsx
│   ├── chat-area.tsx
│   ├── document-panel.tsx
│   ├── modules-view.tsx
│   └── timeline-view.tsx
├── hooks/                # 真实 Data Hooks
│   ├── use-chat.ts
│   ├── use-files.ts
│   ├── use-modules.ts
│   ├── use-timeline.ts
│   └── use-daemon-socket.ts
├── hooks-mock/           # Mock Hooks (v0 导出时替换 hooks/)
│   ├── use-chat.ts
│   ├── use-files.ts
│   ├── use-modules.ts
│   └── use-timeline.ts
├── lib/
│   ├── types.ts          # 共享类型定义 (核心契约)
│   ├── utils.ts          # cn() 等
│   └── mock-data.ts      # Mock 数据
├── scripts/
│   ├── export-v0.sh
│   └── import-v0.sh
├── test/
├── e2e/
├── components.json       # shadcn 配置
└── V0_RULES.md           # v0 项目约束说明
```

---

## 共享类型定义（`lib/types.ts` — 核心契约）

hooks 和 components 共享的类型。这些类型决定了两层之间的数据格式，是 v0 ↔ 代码兼容的基础：

```typescript
// lib/types.ts

export interface ChatMessage {
  action: string;       // to_arch / dev_do / dev_fix / to_human / uat_design / uat_check / note
  from: string;         // human / arch / dev / uat
  to: string;           // human / arch / dev / uat / ""
  ts: number;           // unix 秒级时间戳
  message: string;      // 消息内容
}

export interface FileEntry {
  name: string;
  type: "file" | "dir";
}

export interface ModuleInfo {
  id: string;
  name: string;
  cwd: string;
  status: string;       // "done" | "in_progress" | "pending"
  features: { id: number; description: string; status: string }[];
}

export interface FeatureDetail {
  id: number;
  description: string;
  checkpoint: string[];
  passes: boolean;
}

export type DaemonStatus = "connected" | "connecting" | "disconnected";

// sidebar / page 级别的视图状态类型（共享，不要放在 app/page.tsx 中）
export type MainTab = "chat" | "tasks" | "files";
export type SidebarView = "main" | "modules" | "timeline";
```

> **注意**：v0 的 mock-data.ts 中的类型（如 `ChatMessage` 有 `id/content/timestamp`）与真实代码不同（`action/from/to/ts/message`）。以此处 `types.ts` 为准，v0 的 mock-data 需要对齐。

---

## Hook 接口（核心契约）

```typescript
// hooks/use-chat.ts
export function useChat(workspace: string): {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  daemonStatus: DaemonStatus;
  send: (action: string, to: string, message: string) => Promise<void>;
  startDaemon: () => Promise<void>;
}

// hooks/use-files.ts
export function useFiles(workspace: string, basePath?: string): {
  entries: FileEntry[];
  content: string;
  mtime: number;
  selectedFile: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  mode: "preview" | "edit";
  setSelectedFile: (path: string) => void;
  setMode: (m: "preview" | "edit") => void;
  save: (content: string) => Promise<void>;
  fetchSubDir: (dirPath: string) => Promise<FileEntry[]>;
}

// hooks/use-modules.ts
export function useModules(workspace: string): {
  modules: ModuleInfo[];
  dependencies: { from: string; to: string }[];
  selectedModule: string | null;
  features: FeatureDetail[];
  loading: boolean;
  featuresLoading: boolean;
  setSelectedModule: (id: string) => void;
}

// hooks/use-timeline.ts
export function useTimeline(workspace: string, moduleId: string): {
  content: string;
  loading: boolean;
  error: string | null;
}
```

Mock 版本接口完全相同，返回 `mock-data.ts` 静态数据 + noop 函数。mock 版的 `use-chat.ts` 内部不需要 `use-daemon-socket`（因为直接返回静态数据，无 WebSocket）。

---

## 三种场景复杂度分析

### 场景 1：v0 初始化项目

**操作**：首次把代码导出到 v0，建立 v0 项目。

**步骤**：
1. 运行 `scripts/export-v0.sh ~/temp/v0-export`（1 分钟）
2. 将导出目录上传/打开到 v0.app
3. 在 v0 中发一条初始化 prompt（见下方模板）

**复杂度：低**。一次性操作，脚本自动化。

**关键动作**：在 v0 项目中放置 `V0_RULES.md`，并在首次对话中建立约定。

---

### 场景 2：小改动（改颜色、调间距、微调布局）

**推荐路径：Claude Code 直接改，不走 v0 round-trip。**

小改动走 v0 的成本：export → v0 修改 → download → import → 验证 ≈ 15 分钟。
Claude Code 直接改：描述需求 → 改 Tailwind class → 验证 ≈ 2 分钟。

**复杂度：极低（Claude Code 直接改时）。**

**判断标准**：如果改动只涉及 CSS/Tailwind class 修改、文案调整、组件内部微调，不走 v0。只有涉及新组件设计、交互模式变化、整体布局重构时才走 v0。

---

### 场景 3：大改动来回

**操作**：重大 UI 改版，需要在 v0 中可视化迭代。

**步骤**：
1. `scripts/export-v0.sh ~/temp/v0-export`
2. 在 v0 中多轮对话迭代设计（每次对话带约束前缀）
3. 满意后下载 v0 输出
4. `scripts/import-v0.sh ~/temp/v0-download`
5. 脚本自动 diff 提示类型/hooks 变化
6. 如有新增数据需求，更新真实 hooks
7. `npm run build && npm test` 验证

**复杂度分析**：

| 环节 | 耗时 | 风险 |
|------|------|------|
| export | 1 分钟 | 无 |
| v0 对话迭代 | 取决于需求 | v0 可能违反约束 |
| import 覆盖 | 2 分钟 | 无（脚本处理） |
| hooks 不匹配修复 | 0-30 分钟 | v0 改了 hook 接口需要同步 |
| build + test 验证 | 5 分钟 | 类型错误、测试失败 |

**总复杂度：中等**。主要耗时在 hooks 同步和验证。

**降低复杂度的关键**：v0 对话中的约束越严格，hooks 不匹配修复的时间越短。

---

## v0 约束体系（降低 merge 成本的核心）

### 层 1：项目级约束文件 V0_RULES.md

随代码导出到 v0 项目中。v0 不一定自动读取此文件，因此关键约束必须同时在对话 prompt 中重复。

```markdown
# V0 Project Rules

## 数据获取
- 所有数据通过 hooks/ 目录的自定义 Hook 获取
- 组件中不允许直接 import mock-data.ts 的数据
  正确: const { messages, send } = useChat(workspace)
  错误: import { chatMessages } from "@/lib/mock-data"
- 组件中不允许直接写 fetch() 调用
- 不要创建 app/api/ 目录

## 修改范围
- ✅ 可以修改: components/*, app/workspace/page.tsx, app/globals.css
- ✅ 可以修改: hooks/ (修改返回值结构), lib/mock-data.ts (修改 mock 数据)
- ❌ 不要创建: app/api/*
- ⚠️ 需要新数据 → 在已有 hook 上加字段 + mock-data.ts 加对应数据，不要创建新 hook

## 代码规范
- 所有可交互元素必须加 data-testid 属性（参考已有组件的命名）
- hooks 的函数签名不要改变已有字段，只能新增字段
- 共享类型放在 lib/types.ts，不要从 app/page.tsx 导出类型
- 每个业务组件单独一个文件，不要在 page.tsx 中内联定义组件
- 不要安装新的 npm 包，用已有的 shadcn + lucide-react
- 不要添加 next-themes、@vercel/analytics 等未讨论的功能

## 必须保留的 data-testid 列表
chat-panel, chat-messages, chat-input, chat-send-btn, chat-target-select,
chat-status-bar, chat-status-dot, start-daemon-btn, view-work-btn,
doc-panel, doc-viewer, doc-preview, doc-editor, btn-edit, btn-save,
file-tree, modules-page, modules-cards, features-section, features-list,
timeline-page, timeline-content, projects-page, projects-grid
```

### 层 2：v0 对话 prompt 模板

**首次对话（建立上下文）— 直接复制使用：**

```
这个项目是一个 Next.js 协作工具的 UI。请严格遵守以下约定：

1. 组件通过 hooks/ 获取数据（如 useChat、useFiles），不要在组件内直接 import mock-data.ts 的数据
   正确: const { messages, send } = useChat(workspace)
   错误: import { chatMessages } from "@/lib/mock-data"
2. 如果需要新的数据字段，在对应的 hooks/use-xxx.ts 里添加返回字段，并在 lib/mock-data.ts 中添加 mock 数据
3. 不要创建 app/api/ 目录
4. 所有可交互元素必须加 data-testid 属性（参考已有组件中的命名）
5. 只修改 components/、app/workspace/page.tsx、app/globals.css、hooks/、lib/mock-data.ts
6. 共享类型放在 lib/types.ts，不要从 app/page.tsx 导出或导入类型
7. 不要安装新的 npm 包，用已有的 shadcn + lucide-react
8. 不要添加 next-themes、@vercel/analytics 等未讨论的功能
9. 每个业务组件单独一个文件，不要在 page.tsx 中内联定义组件

请先了解项目结构，然后我会告诉你具体需求。
```

**后续对话（大改动）— 前 3 行是约束前缀，每次带上：**

```
约束不变：数据通过 hooks 获取，不直接 import mock-data；保留 data-testid；不装新依赖。

请重新设计 [sidebar / chat 区域 / 文件面板 / ...]。

要求：
- 数据仍然通过现有 hooks 获取（useChat/useFiles/useModules）
- 如果设计需要新数据，在 hooks 返回值中加字段，并更新 mock-data.ts
- [具体设计需求描述...]
```

**后续对话（改单个组件）：**

```
请只修改 components/chat-area.tsx：[具体改动]。
不改其他文件，保持 hooks 调用和 data-testid 不变。
```

### 层 3：减少 v0 对话中 "偏离" 的技巧

1. **每次只改一个组件或一个区域** — 改动范围越大，偏离约束的概率越高
2. **改完一个组件后确认再继续** — 不要一次性要求 v0 重写所有组件
3. **如果 v0 生成了不该有的 fetch 调用，立即纠正** — "请删除组件中的 fetch 调用，改为使用 useChat hook"
4. **在 v0 中保留 hooks/ 目录** — 这样 v0 的 preview 能正常渲染（因为 mock hooks 返回数据）
5. **不要让 v0 安装新的 npm 包**，除非确实需要 — "不要 npm install 新依赖，用已有的 shadcn + lucide"

---

## 导出/导入脚本

### export-v0.sh

```bash
#!/bin/bash
# 用法: ./scripts/export-v0.sh [输出目录]
# 生成一个可以直接上传到 v0.app 的目录

cd "$(dirname "$0")/.." || exit 1

OUT="${1:-../v0-export}"
rm -rf "$OUT" && mkdir -p "$OUT"

# UI 层
cp -r app "$OUT/app"
rm -rf "$OUT/app/api"                        # 剔除 API routes
cp -r components "$OUT/components"

# Mock hooks 替代真实 hooks
cp -r hooks-mock "$OUT/hooks"

# 工具和数据
mkdir -p "$OUT/lib"
cp lib/types.ts lib/utils.ts lib/mock-data.ts "$OUT/lib/"

# 配置
cp package.json tsconfig.json components.json postcss.config.mjs "$OUT/"
cp next.config.mjs "$OUT/" 2>/dev/null
cp -r public "$OUT/public" 2>/dev/null
cp -r styles "$OUT/styles" 2>/dev/null
cp V0_RULES.md "$OUT/" 2>/dev/null

echo "✅ 已导出到 $OUT"
echo "   文件数: $(find "$OUT" -type f | wc -l | tr -d ' ')"
```

### import-v0.sh

```bash
#!/bin/bash
# 用法: ./scripts/import-v0.sh <v0下载目录>
# 只覆盖 UI 层，不碰 API/hooks(真实版)/test

cd "$(dirname "$0")/.." || exit 1

V0="${1:?用法: ./scripts/import-v0.sh <v0目录>}"

echo "=== 1. 覆盖组件 ==="
cp -r "$V0/components/" components/

echo "=== 2. 覆盖页面 ==="
# 注意：不覆盖 app/api/ 和 app/page.tsx(项目列表首页)
[ -f "$V0/app/workspace/page.tsx" ] && cp "$V0/app/workspace/page.tsx" app/workspace/page.tsx
[ -f "$V0/app/globals.css" ] && cp "$V0/app/globals.css" app/globals.css
[ -f "$V0/app/layout.tsx" ] && cp "$V0/app/layout.tsx" app/layout.tsx

echo "=== 3. 同步 mock 数据 ==="
[ -f "$V0/lib/mock-data.ts" ] && cp "$V0/lib/mock-data.ts" lib/mock-data.ts

echo "=== 4. 检查 hooks 变化 ==="
KNOWN_HOOKS="use-chat.ts use-files.ts use-modules.ts use-timeline.ts"
for f in "$V0"/hooks/use-*.ts; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  # 检查是否是已知 hook
  if echo "$KNOWN_HOOKS" | grep -qw "$name"; then
    if [ -f "hooks-mock/$name" ]; then
      if ! diff -q "hooks-mock/$name" "$f" > /dev/null 2>&1; then
        echo "⚠️  hooks/$name 有变化 — 请更新 hooks/$name (真实版) 匹配新接口"
        diff "hooks-mock/$name" "$f" || true
      fi
    fi
    cp "$f" hooks-mock/
  else
    echo "⚠️  v0 新增了 hooks/$name — 评估是否需要创建真实版本"
  fi
done

echo "=== 5. 检查类型变化 ==="
[ -f "$V0/lib/types.ts" ] && diff lib/types.ts "$V0/lib/types.ts" || true

echo "=== 6. 检查依赖变化 ==="
if [ -f "$V0/package.json" ] && command -v jq >/dev/null 2>&1; then
  NEW_DEPS=$(diff <(jq -r '.dependencies // {} | keys[]' package.json 2>/dev/null | sort) \
                  <(jq -r '.dependencies // {} | keys[]' "$V0/package.json" 2>/dev/null | sort) | grep "^>" | sed 's/^> //')
  if [ -n "$NEW_DEPS" ]; then
    echo "⚠️  v0 新增了以下依赖，请评估是否需要安装："
    echo "$NEW_DEPS"
  fi
fi

echo "=== 7. 检查 data-testid ==="
MISSING=0
for f in components/*.tsx; do
  [ -f "$f" ] || continue
  if ! grep -q 'data-testid' "$f"; then
    echo "⚠️  $(basename "$f") 缺少 data-testid 属性"
    MISSING=$((MISSING+1))
  fi
done
[ $MISSING -gt 0 ] && echo "共 $MISSING 个组件缺少 data-testid，测试可能失败"

echo ""
echo "✅ 导入完成。请执行："
echo "   npm run build   # 检查编译"
echo "   npm test         # 检查测试"
```

---

## 首次合并实施步骤

### Step 1: 目录结构迁移

移除 `src/`，将文件平铺到根目录：

```
src/app/          → app/
src/components/   → components/
src/lib/          → lib/
```

更新路径配置（3 处）：
- `tsconfig.json`: `"@/*": ["./src/*"]` → `"@/*": ["./*"]`
- `vitest.config.ts`: `"@": path.resolve(__dirname, "./src")` → `"@": path.resolve(__dirname, ".")`
- `vitest.config.e2e.ts`: 同上

运行 `npm run build && npm test` 确认迁移无误后再继续。

### Step 2: 引入 Tailwind + shadcn 基础设施

安装依赖：
```bash
npm install tailwindcss@4 @tailwindcss/postcss postcss tailwind-merge clsx class-variance-authority lucide-react react-resizable-panels
```

添加配置文件：
- `postcss.config.mjs`（使用 `@tailwindcss/postcss` 插件）
- `components.json`（shadcn 配置）
- Tailwind v4 使用 CSS-first 配置，**不需要** `tailwind.config.ts`

替换 `globals.css`：
- 现有的组件级 CSS class（`.chat-panel`, `.doc-viewer` 等）全部移除
- 替换为 v0 的 shadcn 主题变量（oklch 色彩空间）+ `@import 'tailwindcss'`
- 暗色模式从 `@media (prefers-color-scheme: dark)` 改为 `.dark` class variant
- **注意**：替换后现有组件会暂时失去样式，Step 5 替换 UI 后恢复

### Step 3: 定义类型契约

创建 `lib/types.ts`，定义所有共享类型（ChatMessage, FileEntry, ModuleInfo, FeatureDetail, DaemonStatus, MainTab, SidebarView）。

创建 `lib/utils.ts`（`cn()` 函数）。

创建 `lib/mock-data.ts`：基于 v0 版本，但类型必须对齐 `types.ts`（v0 的 ChatMessage 格式和真实代码不同，需要适配）。

### Step 4: 提取 Data Hooks

从现有组件中提取数据逻辑到 `hooks/`：
- `ChatPanel.tsx` 的 fetch + WebSocket + 发送逻辑 → `hooks/use-chat.ts`
- `DocPanel.tsx` + `DocViewer.tsx` + `FileTree.tsx` 的 fetch → `hooks/use-files.ts`
- `modules/page.tsx` 的 fetch → `hooks/use-modules.ts`
- `modules/[mid]/timeline/page.tsx` 的 fetch → `hooks/use-timeline.ts`
- `useDaemonSocket.ts` 移到 `hooks/use-daemon-socket.ts`（内部实现，被 use-chat 调用）

同步创建 `hooks-mock/` 对应的 mock 版本（返回 mock-data.ts 数据 + noop 函数）。

### Step 5: 搬入 shadcn + 替换组件 UI

1. 安装实际使用的 shadcn 组件到 `components/ui/`（约 15 个：button, avatar, badge, tabs, scroll-area, separator, tooltip 等）
2. 用 v0 的组件设计替换现有组件：
   - `ChatPanel.tsx` → `chat-area.tsx`（v0 样式 + `useChat` hook）
   - `DocPanel.tsx` + `DocViewer.tsx` + `FileTree.tsx` → `document-panel.tsx`（v0 样式 + `useFiles` hook）
   - `modules/page.tsx` → `modules-view.tsx`（v0 样式 + `useModules` hook）
   - `modules/[mid]/timeline/page.tsx` → `timeline-view.tsx`（v0 样式 + `useTimeline` hook）
   - 新增 `sidebar.tsx`
3. 采用 v0 的 sidebar + tabs 单页架构（在 `/workspace` 路由下）
4. **关键**：v0 组件目前直接 `import { chatMessages } from mock-data`，必须改为通过 hooks 获取。这是首次合并的主要手动工作量。
5. 确保所有 `data-testid` 属性保留（v0 原生代码没有 testid，需要手动添加）

### Step 6: 创建脚本 + 约束文件
- `scripts/export-v0.sh`, `scripts/import-v0.sh`
- `V0_RULES.md`

### Step 7: 验证
- `npm run build` 编译通过
- `npm test` 测试通过（测试中的 mock 从 `vi.mock("@/lib/useDaemonSocket")` 改为 `vi.mock("@/hooks/use-chat")`）
- 运行 export 脚本，检查导出目录结构正确、mock hooks 能让组件正常渲染
- dev server 手动验证：项目列表 → 进入 workspace → Chat/Files/Modules/Timeline 四个视图正常
- 启动 daemon 验证 WebSocket 推送正常

---

## Review 记录

方案经过 2 轮自查，发现并修复了以下关键问题：

### 已修复的关键问题

| # | 问题 | 严重性 | 修复 |
|---|------|--------|------|
| 1 | **v0 组件直接 import mock-data，不走 hooks** | 致命 | 在 V0_RULES + prompt 模板中明确禁止直接 import mock-data；Step 5 标注为首次合并主要工作量 |
| 2 | **`lib/types.ts` 只提概念没定义** | 高 | 新增完整的共享类型定义段落，包含 ChatMessage/FileEntry/ModuleInfo 等，并标注 v0 数据格式与真实代码的差异 |
| 3 | **v0 组件零 data-testid** | 高 | V0_RULES 中列出必须保留的 testid 列表；import 脚本增加 testid 检查步骤 |
| 4 | **Hook 接口遗漏字段** | 中 | useChat 补 `sending`；useFiles 补 `saving/error/basePath`；useModules 补 `dependencies/featuresLoading` |
| 5 | **v0 组件从 page.tsx 导入类型** | 中 | 移到 lib/types.ts，V0_RULES 明确禁止跨层类型导入 |
| 6 | **移除 src/ 影响范围低估** | 高 | Step 1 详细列出 3 处配置需更新（tsconfig + 2 个 vitest config）|
| 7 | **导入脚本缺 package.json diff** | 中 | 新增 Step 6 检查新增依赖 |
| 8 | **导入脚本 hooks-mock 覆盖不过滤** | 低 | 改为只同步已知 hooks，非预期 hooks 发出警告 |
| 9 | **脚本工作目录假设不明确** | 低 | 脚本开头加 `cd "$(dirname "$0")/.."` |
| 10 | **v0 prompt 模板太笼统** | 高 | 从 5 条扩充到 9 条，加入反例（正确 vs 错误写法）|
| 11 | **首次合并步骤跳跃太大** | 高 | 从 5 步扩充到 7 步，增加类型契约、CSS 迁移说明等中间步骤 |
| 12 | **项目列表首页未提及** | 中 | 目录结构中保留 `app/page.tsx` 作为项目列表，v0 单页架构放在 `app/workspace/` |
| 13 | **Tailwind v4 配置方式未说明** | 低 | 明确 CSS-first 配置，不需要 tailwind.config.ts |
| 14 | **export 脚本遗漏 next.config.mjs** | 低 | 已补充 |
