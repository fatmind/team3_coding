// init-project.mjs — 回归用的「项目初始化 CLI」
//
// 把一次 team3 项目从零拉起：建 workspace 骨架 + .team3-project.json、
// 注册 ~/.team3/projects.json、启动 daemon（orchestrator-entry.js）、
// 可选追加首条 to_arch 消息 kick off Arch。
//
// 初始化/注册/启 daemon 的核心逻辑【直接复用 web 的原始实现】（单一来源，
// 避免 copy 漂移）。Node 直接 import 这些 .ts（内置类型擦除）。loop 不进 npm
// 包，是 dev-time 工具，可自由相对引用源码树。
//
// 既可被 run-regression.mjs import，也可独立运行做验证。
//
// 独立运行（前台，保持 daemon 存活直到 Ctrl-C）：
//   node init-project.mjs --workspace /abs/path --design ./vote-app/spec/app_design.md --kick
//
// daemon 是本进程的子进程；本进程退出时 web 的 cleanup 钩子会 SIGTERM 它，
// 所以独立运行时脚本会一直前台阻塞，直到收到 SIGINT。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// —— 直接复用 web 的原始实现（不 copy）——
import { initWorkspace } from '../web/src/lib/init/init-workspace.ts';
import { addProject } from '../web/src/lib/workspace.ts';
import { startDaemon } from '../web/src/lib/init/start-daemon.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEAM3_DIR = path.resolve(__dirname, '..'); // team3/
const DAEMON_ENTRY = path.join(TEAM3_DIR, 'daemon', 'src', 'orchestrator-entry.js');

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// —— loop 专属胶水：design 种子 ——
// web 的 initWorkspace 只在 app_design.md 不存在时写默认值；回归需要用指定 design
// 作为「干净起点」，所以在 initWorkspace 之后覆盖它。
function seedDesign(workspacePath, designPath) {
  const src = path.resolve(designPath);
  if (!fs.existsSync(src)) throw new Error(`design 文件不存在: ${src}`);
  fs.writeFileSync(path.join(path.resolve(workspacePath), 'spec', 'app_design.md'), fs.readFileSync(src, 'utf-8'), 'utf-8');
}

// —— loop 专属胶水：首条 to_arch（kick off Arch）——
const DEFAULT_BRIEF =
  '请先阅读 spec/app_design.md，按其中的产品意图开始整体设计。若有产品决策需要确认，通过 to_human 向我提问。';

export function kickArch(workspacePath, message) {
  // 默认参数只在实参为 undefined 时生效；调用方常传 null（未指定 --brief），
  // 那样会写出 message:null 被 daemon 校验拒收 —— 所以在函数体内兜底。
  const text = (message && String(message).trim()) || DEFAULT_BRIEF;
  const actionsPath = path.join(path.resolve(workspacePath), 'spec', 'actions.jsonl');
  const entry = { action: 'to_arch', from: 'human', to: 'arch', ts: Math.floor(Date.now() / 1000), message: text };
  fs.mkdirSync(path.dirname(actionsPath), { recursive: true });
  fs.appendFileSync(actionsPath, JSON.stringify(entry) + '\n', 'utf-8');
  return entry;
}

// —— 一站式：初始化 + 注册 + 启动 daemon（+ 可选 kick）——
export async function initProject(workspacePath, { name, designPath, kick = false, brief } = {}) {
  const absWorkspace = path.resolve(workspacePath);

  initWorkspace(absWorkspace);
  if (designPath) seedDesign(absWorkspace, designPath);

  const projName = name || path.basename(absWorkspace);
  addProject({ name: projName, workspace: absWorkspace, createdTime: getToday() });

  // daemon 入口：
  // - 打包模式（TEAM3_PKG_DIR 已设）→ 不传，让 web 的 resolveDaemonEntry 解析成
  //   $TEAM3_PKG_DIR/daemon.min.js，从而验证终端用户真实链路；
  // - 源码模式 → 显式传 DAEMON_ENTRY，避开它基于 process.cwd() 的入口推断。
  const startOpts = process.env.TEAM3_PKG_DIR ? {} : { daemonEntryPath: DAEMON_ENTRY };
  const { pid, port } = await startDaemon(absWorkspace, startOpts);

  let kicked = null;
  if (kick) kicked = kickArch(absWorkspace, brief);
  return { workspace: absWorkspace, name: projName, pid, port, kicked };
}

// —— CLI ——

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { workspace: null, name: null, design: null, kick: false, brief: null };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if ((k === '--workspace' || k === '-w') && args[i + 1]) { out.workspace = args[++i]; }
    else if (k === '--name' && args[i + 1]) { out.name = args[++i]; }
    else if (k === '--design' && args[i + 1]) { out.design = args[++i]; }
    else if (k === '--brief' && args[i + 1]) { out.brief = args[++i]; }
    else if (k === '--kick') { out.kick = true; }
    else if (!out.workspace) { out.workspace = k; }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.workspace) {
    process.stderr.write('用法: node init-project.mjs --workspace <abs> [--name N] [--design app_design.md] [--kick] [--brief "..."]\n');
    process.exit(1);
  }
  const res = await initProject(opts.workspace, {
    name: opts.name,
    designPath: opts.design,
    kick: opts.kick,
    brief: opts.brief,
  });
  process.stdout.write(`✓ 项目就绪: ${res.name}\n`);
  process.stdout.write(`  workspace: ${res.workspace}\n`);
  process.stdout.write(`  daemon:    PID ${res.pid}, port ${res.port}\n`);
  if (res.kicked) process.stdout.write(`  已发送首条 to_arch\n`);
  process.stdout.write(`\ndaemon 由本进程持有；按 Ctrl-C 结束（daemon 随之退出）。\n`);

  // 前台保活：web startDaemon 已注册 SIGINT→exit 与 exit→kill daemon 的钩子，
  // 本进程退出即会带走 daemon。这里只需阻塞。
  await new Promise(() => {});
}

// 仅在被直接执行时跑 CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { process.stderr.write(`init-project 失败: ${err.message}\n`); process.exit(1); });
}
