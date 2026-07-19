# CodeCli 适配层改造方案

## 背景

当前 daemon 硬绑定 claude code（`claude` 命令），要支持 qodercli 和未来其它 CLI 工具。

## 实际验证结论

跑了 `qodercli -p "xxx" --output-format stream-json` 和 `claude -p "xxx" --output-format stream-json --verbose`，对比结果：

**协议几乎一致**——事件类型、字段结构相同：

```
system (hook_started / hook_response / init)  → 两者一样
assistant (message.content: [{type:"text"/"thinking", ...}])  → 一样
result (subtype:"success", result:"xxx")  → 一样
```

**核心参数对照**：

| 能力 | claude code | qodercli | 差异 |
|------|------------|----------|------|
| 非交互 | `-p` | `-p` | 无 |
| 新建 session | `--session-id <uuid>` | `--session-id <id>` | 无 |
| 恢复 session | `--resume <uuid>` | `--resume <id>` 或 `-r` | 无 |
| system prompt | `--system-prompt <text>` | `--system-prompt <text>` | 无 |
| 输出格式 | `--output-format stream-json` | `--output-format stream-json` | 无 |
| 跳过确认 | `--dangerously-skip-permissions` | `--dangerously-skip-permissions` | 无 |
| 额外要求 | 必须加 `--verbose` | 不需要 | **唯一差异** |
| 二进制名 | `claude` | `qodercli` | 不同 |

虽然当前协议几乎一致，但 claude code 和 qodercli 是两个独立产品，未来发展路径可能不同。设计上必须强制隔离，每个 CLI 一个独立 Provider，方便后续加入其它 code cli。

## 改造方案

### 1. 新增全局配置文件 `~/.team3/config.json`

用户安装 team3 后的初始化动作之一，选择自己用哪个 CLI：

```json
{
  "codeCli": {
    "type": "qoder-code",
    "command": "qodercli"
  }
}
```

type 枚举值：`claude-code` | `qoder-code`

### 2. Provider 隔离：每个 CLI 一个独立文件

目录结构：

```
daemon/src/code-cli/
├── index.js              # loadProvider(type) → 返回对应 provider 实例
├── claude-code.js        # ClaudeCodeProvider
└── qoder-code.js         # Qoder Code provider
```

每个 Provider 导出相同接口：

```javascript
// claude-code.js
module.exports = {
  command: 'claude',

  buildArgs({ prompt, sessionId, isNew, role, systemPrompt }) {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    args.push(isNew ? '--session-id' : '--resume', sessionId);
    args.push('--system-prompt', systemPrompt);
    return args;
  },

  buildSkipPermissionArgs() {
    return ['--dangerously-skip-permissions'];
  },

  parseStdoutLine(line) {
    // claude code 特有的解析逻辑（当前逻辑搬过来）
  },

  extractResult(fullStdout) {
    // 从 type:"result" 提取最终回复
  },

  isMissingSessionError(stderr) {
    return stderr.includes('No conversation found');
  },
};
```

```javascript
// qodercli.js
module.exports = {
  command: 'qodercli',

  buildArgs({ prompt, sessionId, isNew, role, systemPrompt }) {
    const args = ['-p', prompt, '--output-format', 'stream-json'];
    args.push(isNew ? '--session-id' : '--resume', sessionId);
    args.push('--system-prompt', systemPrompt);
    return args;
  },

  buildSkipPermissionArgs() {
    return ['--dangerously-skip-permissions'];
  },

  parseStdoutLine(line) {
    // qodercli 自己的解析逻辑（当前格式相同，但独立维护）
  },

  extractResult(fullStdout) {
    // 同上，独立维护
  },

  isMissingSessionError(stderr) {
    // qodercli 的错误信息待确认，先同 claude
    return stderr.includes('No conversation found');
  },
};
```

**为什么不共用一个 parser？** 两个独立产品，今天一样不代表明天一样。隔离后各自改互不影响，加新 CLI 也只需加一个文件。

### 3. index.js 加载逻辑

```javascript
const providers = {
  'claude-code': require('./claude-code'),
  'qoder-code': require('./qoder-code'),
};

function loadProvider(config) {
  const provider = providers[config.type];
  if (!provider) throw new Error(`未知 codeCli type: ${config.type}`);
  return provider;
}
```

### 4. 改动点

**`agent-scheduler.js`**

构造函数接收 provider，spawn 时用 provider：

```javascript
// 之前
const args = this._buildArgs(role, sessionId, isNew, prompt);
const proc = this.spawnFn('claude', args, opts);

// 之后
const args = this.provider.buildArgs({ prompt, sessionId, isNew, role, systemPrompt });
if (process.env.TEAM3_SUPERMAN) {
  args.push(...this.provider.buildSkipPermissionArgs());
}
const proc = this.spawnFn(this.provider.command, args, opts);
```

**`init-agent.js`**

同上，provider 作为参数传入。

**`stdout-parser.js`**

拆到各 provider 内部。scheduler 调用 `this.provider.parseStdoutLine(line)` 替代直接 import。

**`reply-fallback.js`**

拆到各 provider 内部。scheduler 调用 `this.provider.extractResult(stdout)`。

**删除 `claude-args.js`**

逻辑已拆进各 provider 的 buildArgs。

### 5. 读配置逻辑

`daemon/src/config.js` 新增：

```javascript
const globalConfigPath = path.join(os.homedir(), '.team3', 'config.json');

function loadCodeCliConfig() {
  const raw = fs.readFileSync(globalConfigPath, 'utf8');
  const config = JSON.parse(raw);
  return config.codeCli;
}
```

daemon 启动时：读配置 → loadProvider → 注入 scheduler。

### 6. 初始化流程

Web 初始化或首次启动 daemon 时，检查 `~/.team3/config.json`：
- 不存在 → 提示用户选择 CLI 类型，写入配置
- 存在 → 直接用

## 改动文件清单

| 文件 | 动作 |
|------|------|
| `~/.team3/config.json` | 新增，用户全局配置 |
| `daemon/src/code-cli/index.js` | 新增，loadProvider |
| `daemon/src/code-cli/claude-code.js` | 新增，claude code provider |
| `daemon/src/code-cli/qodercli.js` | 新增，qodercli provider |
| `daemon/src/claude-args.js` | 删除，逻辑拆入各 provider |
| `daemon/src/stdout-parser.js` | 删除，逻辑拆入各 provider |
| `daemon/src/reply-fallback.js` | 删除，逻辑拆入各 provider |
| `daemon/src/agent-scheduler.js` | 改为用 this.provider 调用 |
| `daemon/src/init-agent.js` | 改为用 provider |
| `daemon/src/config.js` | 加 loadCodeCliConfig() |
| `daemon/src/daemon-orchestrator.js` | 启动时 loadProvider 传给 scheduler |

## 验证方式

### 单元验证

- `code-cli/index.js`：loadProvider 2 种 type 都能正确返回
- `code-cli/claude-code.js`：buildArgs 生成正确参数（含 --verbose）
- `code-cli/qodercli.js`：buildArgs 生成正确参数（无 --verbose）
- 各 provider 的 parseStdoutLine / extractResult / isMissingSessionError

### 集成验证

daemon 用 qodercli 配置启动，跑 `init-agent`（arch），检查：
- session 正常创建（.team3-project.json 写入 sessionId）
- stdout 正常解析（agent-log 事件正常推送到 WebSocket）

### e2e 验证

在 `/tmp/` 创建一个临时项目（如"投票调查系统"）：

1. 手动准备：
   - `/tmp/vote-app/` 目录
   - 写入 `.team3-project.json`（配好 partner）
   - 写入 `spec/app_design.md`（简单的投票系统描述）
   - 写入 1 个 `spec/module_vote.md`
   - `~/.team3/config.json` 设为 qodercli

2. 启动 daemon，触发流程：
   - 往 `spec/actions.jsonl` 写入 `{"action":"to_arch","from":"human","to":"arch","message":"module 设计完毕，开始 feature 拆解"}`
   - 观察 arch agent 用 qodercli 启动，拆出 feature_list.json
   - arch 写 dev_do → dev agent 用 qodercli 启动，完成第一个 feature
   - dev 写 to_arch → arch 验收

3. 通过标准：
   - 全程 qodercli 进程正常退出（exit 0）
   - actions.jsonl 有完整的 dev_do → to_arch 往返
   - agent-log WebSocket 事件正常推送
   - .team3-project.json 的 session 记录正确
