// run-eval.mjs — 集团评测编排器：同一 Benchmark 用两个模型各跑一次，产出对比 HTML
//
// 背景：team3 切模型 = 换 CLI 二进制（基线 qodercli / 被测 qoderclicn），由
// ~/.team3/config.json 的 codeCli.command 决定（daemon 经 loadProvider 读它）。
// 本脚本自动完成：切基线模型跑一次 →（导基线轨迹）→ 切被测模型跑一次 →（导被测轨迹）
//   → 抽 badcase 输入并交模型分析 → gen-report 出对比 HTML → 打包证据轨迹。
//   全程不删项目目录/会话，收尾只还原 config、清理回归进程（下一轮回归开头才清空 workspace）。
//
// 用法：
//   node run-eval.mjs [--profile full|min]
//                     [--baseline-cmd qodercli] [--compare-cmd qoderclicn]
//                     [--baseline-label "..."] [--compare-label "..."]
//
// 说明：
//   - full 单模型一轮 ~1–6h，两个模型串跑耗时很长，建议 nohup/后台运行。
//   - 每次子回归都在「无基线」状态下跑（纯 harness 判定），规避 run-regression
//     自带的基线退化闸门把「回归是否通过」写成否，干扰双模型对比。
//   - 运行期间会临时改写 ~/.team3/config.json 的 codeCli.command，结束（含异常）
//     一定会还原为原值；开跑前已备份到 workspace。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectTrajectories } from './collect-trajectories.mjs';
import { genBadcase } from './gen-badcase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOOP_DIR = __dirname;
const VOTE_DIR = path.join(LOOP_DIR, 'vote-app');
const CONFIG_PATH = path.join(os.homedir(), '.team3', 'config.json');
const RUN_REGRESSION = path.join(LOOP_DIR, 'run-regression.mjs');
const GEN_REPORT = path.join(LOOP_DIR, 'gen-report.mjs');
const EVAL_TMP = '/tmp/t3-eval';
// team3 回归默认 workspace（run-regression 的默认值，run-eval 不覆盖）。
// 轨迹收集要读它下面的 .team3-project.json，且该文件会被下一轮回归开头清掉，故须及时收集。
const WORKSPACE = '/tmp/t3-regress/vote-app';
// badcase 中间产物目录（放临时区）
const BADCASE_DIR = path.join(EVAL_TMP, 'badcase');

function parseArgs(argv) {
  const out = {
    profile: 'full',
    baselineCmd: 'qodercli',
    compareCmd: 'qoderclicn',
    baselineLabel: 'qodercli Performance（猜测 GPT-5.5）',
    compareLabel: 'Qwen-latest-series-invite-beta-v118',
    baselineShort: '基线',
    compareShort: 'v118',
  };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i]; const v = a[i + 1];
    if (k === '--profile' && v) out.profile = (i++, v);
    else if (k === '--baseline-cmd' && v) out.baselineCmd = (i++, v);
    else if (k === '--compare-cmd' && v) out.compareCmd = (i++, v);
    else if (k === '--baseline-label' && v) out.baselineLabel = (i++, v);
    else if (k === '--compare-label' && v) out.compareLabel = (i++, v);
    else if (k === '--baseline-short' && v) out.baselineShort = (i++, v);
    else if (k === '--compare-short' && v) out.compareShort = (i++, v);
  }
  return out;
}

function log(m) { process.stdout.write(`[run-eval] ${m}\n`); }

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error(`找不到 ${CONFIG_PATH}，请先 team3 init`);
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// 切换 ~/.team3/config.json 的 codeCli.command（保留其余字段）
function setCommand(command) {
  const cfg = readConfig();
  cfg.codeCli = { ...(cfg.codeCli || {}), type: cfg.codeCli?.type || 'qoder-code', command };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  log(`已切换 codeCli.command = ${command}`);
}

let _activeChild = null;
function spawnP(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    _activeChild = p;
    p.on('close', (code) => { _activeChild = null; resolve(code); });
    p.on('error', (e) => { _activeChild = null; log(`spawn 失败: ${e.message}`); resolve(-1); });
  });
}

// 只清理明确属于本回归的进程，绝不误伤用户其它服务。三路取证后并集：
//   a) 命令行含 /tmp/t3-regress 的进程（next dev、build worker 等）；
//   b) 被跟踪的 run-regression 子进程的整棵后代树（递归 ppid），覆盖它在 team3
//      根目录 cwd 下拉起、argv 里看不到 t3-regress 的进程（含 daemon），赶在 reparent 前抓到；
//   c) 监听 daemon(3853)/acceptance(3001) 端口，且 cwd 在 /tmp/t3-regress 下，
//      或命令匹配 team3 daemon 入口(orchestrator-entry/daemon.min)/next 的进程 ——
//      补上"daemon cwd=team3 根、argv 不含 t3-regress"这个盲点。
// webclaw3(3003/9003)、其它端口的 next-server 等一律不匹配。先 TERM，1.5s 后 KILL 残留。
function cleanupOrphans() {
  const root = (_activeChild && _activeChild.pid) ? _activeChild.pid : '';
  const sh = `
SELF=${process.pid}
ROOT="${root}"

# b) 递归收集 ROOT 的后代
descendants() {
  local parent=$1
  local kids
  kids=$(ps -Ao pid=,ppid= 2>/dev/null | awk -v p="$parent" '$2==p{print $1}')
  for k in $kids; do echo "$k"; descendants "$k"; done
}

PIDS=""
# a) argv 含 /tmp/t3-regress
PIDS="$PIDS $(ps -Ao pid=,command= 2>/dev/null | grep '/tmp/t3-regress' | grep -v grep | awk '{print $1}')"
# b) ROOT 后代
if [ -n "$ROOT" ]; then PIDS="$PIDS $(descendants "$ROOT")"; fi
# c) 端口监听者（cwd 在 t3-regress 下，或命令是 team3 daemon/next）
for PORT in 3853 3001; do
  for L in $(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null); do
    CWD=$(lsof -a -p "$L" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    CMD=$(ps -p "$L" -o command= 2>/dev/null)
    case "$CWD" in *t3-regress*) PIDS="$PIDS $L"; continue;; esac
    case "$CMD" in *orchestrator-entry*|*daemon.min*|*"next dev"*|*next-server*) PIDS="$PIDS $L";; esac
  done
done

UNIQ=$(echo "$PIDS" | tr ' ' '\\n' | grep -E '^[0-9]+$' | sort -u | grep -v "^$SELF$")
[ -z "$UNIQ" ] && exit 0
for pid in $UNIQ; do kill -TERM "$pid" 2>/dev/null && echo "[run-eval] TERM 回归进程 $pid"; done
sleep 1.5
for pid in $UNIQ; do
  if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null && echo "[run-eval] KILL 残留进程 $pid"; fi
done
`;
  try { execSync(sh, { shell: '/bin/bash', stdio: 'inherit' }); } catch { /* best-effort */ }
}

// 信号/异常时：还原 config + 清理回归进程，避免留下孤儿。可重入保护。
let _originalCommand = null;
let _cleaning = false;
function cleanupAndExit(reason, code) {
  if (_cleaning) return;
  _cleaning = true;
  log(`收到 ${reason}，开始清理…`);
  try { if (_originalCommand) setCommand(_originalCommand); } catch (e) { log(`还原 config 失败: ${e.message}`); }
  cleanupOrphans();
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => cleanupAndExit(sig, 130));
}

// 跑一次子回归：--no-baseline 保证不读不写固定基线（不碰手工基线），报告落到 outPath
async function runOne(profile, command, outPath, workspace) {
  setCommand(command);
  // 每个模型用各自独立的工作区目录（--no-clean 不清空父目录、也不动别的模型的目录）；
  // 先把本模型目录清空重建，保证干净起点。
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  log(`开始回归：command=${command} profile=${profile} workspace=${workspace} → ${outPath}`);
  const code = await spawnP('node', [
    RUN_REGRESSION, '--profile', profile, '--no-baseline',
    '--workspace', workspace, '--no-clean', '--out', outPath,
  ]);
  const passed = fs.existsSync(outPath) && /- 回归是否通过[：:]\s*是/.test(fs.readFileSync(outPath, 'utf-8'));
  log(`回归结束：exit=${code}，报告通过=${passed ? '是' : '否'}`);
  return { code, passed, outPath };
}

// 收集本轮轨迹（best-effort）：导进同一 evidence 目录，用 prefix（baseline/compare）区分文件名。
// 失败不致命——轨迹是加分证据，缺了不该挡住报告生成。
function safeCollect(cmd, prefix, wsPath, evidenceDir) {
  try {
    const ws = fs.existsSync(wsPath) ? fs.realpathSync(wsPath) : wsPath;
    collectTrajectories({ cmd, workspace: ws, outDir: evidenceDir, prefix, log: (m) => log(`  [轨迹] ${m}`) });
  } catch (e) {
    log(`⚠ 轨迹收集失败（${prefix}）：${e.message}。继续，不影响报告。`);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(EVAL_TMP, { recursive: true });

  // 本地日期 YYYYMMDD（用于 run-eval 专用产物的后缀；同天重跑覆盖）
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  // 备份原 config（还原用 + 满足"改用户文件先备份"）
  const cfgBackup = path.join(EVAL_TMP, `config.backup.${Date.now()}.json`);
  fs.copyFileSync(CONFIG_PATH, cfgBackup);
  const originalCommand = readConfig().codeCli?.command || 'qodercli';
  _originalCommand = originalCommand;
  log(`原 codeCli.command=${originalCommand}，已备份 config → ${cfgBackup}`);

  const baselineOut = path.join(EVAL_TMP, `baseline.${opts.profile}.md`);
  const compareOut = path.join(EVAL_TMP, `compare.${opts.profile}.md`);
  // 两个模型各用独立项目目录（开跑就分开，不挪、不删；保留供事后回溯现场）。
  // 放 /tmp/t3-regress 下但用 --no-clean，互不清空；下次同 profile 评测开跑时才各自重建覆盖。
  const baselineWs = `/tmp/t3-regress/vote-app.${opts.profile}.baseline`;
  const compareWs = `/tmp/t3-regress/vote-app.${opts.profile}.compare`;
  // 证据目录：直接落到 vote-app 下的一层目录，里面各会话 zip 用 baseline./compare. 前缀区分（不合并成一个包）
  const evidenceDir = path.join(VOTE_DIR, `eval.${opts.profile}.evidence.${dateStr}`);
  // 每次评测重建证据/badcase 目录（避免混入上次残留）；项目目录留到 runOne 内各自重建
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.rmSync(BADCASE_DIR, { recursive: true, force: true });

  try {
    log('=== 第 1/2 轮：基线模型 ===');
    const rBase = await runOne(opts.profile, opts.baselineCmd, baselineOut, baselineWs);
    if (!rBase.passed) {
      log(`✗ 基线模型（${opts.baselineCmd}）回归未通过，终止对比。请查看 /tmp/t3-regress/regress-run.log 排查。`);
      return;
    }
    log('— 收集基线轨迹 —');
    safeCollect(opts.baselineCmd, 'baseline', baselineWs, evidenceDir);
    cleanupOrphans(); // 停掉基线遗留的 daemon/dev，释放端口，避免污染被测那轮

    log('=== 第 2/2 轮：被测模型 ===');
    const rCmp = await runOne(opts.profile, opts.compareCmd, compareOut, compareWs);
    if (!rCmp.passed) {
      log(`✗ 被测模型（${opts.compareCmd}）回归未通过，终止对比。基线报告在 ${baselineOut}，日志见 /tmp/t3-regress/regress-run.log。`);
      return;
    }
    log('— 收集被测轨迹 —');
    safeCollect(opts.compareCmd, 'compare', compareWs, evidenceDir);
    cleanupOrphans(); // 停掉被测遗留进程

    if (!fs.existsSync(baselineOut) || !fs.existsSync(compareOut)) {
      log(`✗ 缺少回归报告 md（baseline 存在=${fs.existsSync(baselineOut)}，compare 存在=${fs.existsSync(compareOut)}），无法生成对比 HTML。`);
      return;
    }

    // 组装到 vote-app 目录：eval 前缀 + 日期后缀，run-eval 专用文件名，绝不与手工产物撞名
    const finalBaseMd = path.join(VOTE_DIR, `eval.${opts.profile}.baseline.${dateStr}.md`);
    const finalCmpMd = path.join(VOTE_DIR, `eval.${opts.profile}.compare.${dateStr}.md`);
    fs.copyFileSync(baselineOut, finalBaseMd);
    fs.copyFileSync(compareOut, finalCmpMd);
    log(`已落地：${finalBaseMd} / ${finalCmpMd}`);

    // === badcase：前后对比抽退化项 → 模型基于真实轨迹+保留的项目目录分析（best-effort） ===
    let badcasePath = null;
    try {
      log('— 抽取 badcase 输入并交模型分析 —');
      const res = genBadcase({
        baseline: finalBaseMd, compare: finalCmpMd,
        evidenceDir, // 同一目录，内部按 baseline./compare. 前缀分
        workspaceBaseline: fs.existsSync(baselineWs) ? baselineWs : null,
        workspaceCompare: fs.existsSync(compareWs) ? compareWs : null,
        outDir: BADCASE_DIR,
        analyzeCmd: opts.baselineCmd, // 用基线(国际版 qodercli)做分析
        baselineLabel: opts.baselineLabel, compareLabel: opts.compareLabel,
        timeoutMin: 30,
        log: (m) => log(`  [badcase] ${m}`),
      });
      if (res.badcasePath && fs.existsSync(res.badcasePath)) {
        badcasePath = path.join(VOTE_DIR, `eval.${opts.profile}.badcase.${dateStr}.md`);
        fs.copyFileSync(res.badcasePath, badcasePath);
        log(`badcase 分析已落地：${badcasePath}`);
      } else {
        log(`badcase 未自动产出，可稍后手动执行：${res.manualCmd}`);
      }
    } catch (e) {
      log(`⚠ badcase 阶段失败：${e.message}。继续生成报告（不含 badcase 节）。`);
    }

    const htmlOut = path.join(VOTE_DIR, `eval.${opts.profile}.${dateStr}.html`);
    const genArgs = [
      GEN_REPORT,
      '--baseline', finalBaseMd,
      '--compare', finalCmpMd,
      '--out', htmlOut,
      '--baseline-cmd', opts.baselineCmd,
      '--compare-cmd', opts.compareCmd,
    ];
    if (badcasePath) genArgs.push('--badcase', badcasePath);
    const code = await spawnP('node', genArgs);

    if (fs.existsSync(evidenceDir)) log(`证据轨迹目录：${evidenceDir}（内含 baseline.* / compare.* 各会话 zip）`);
    log(`项目现场已保留（不删，供回溯）：\n    基线 ${baselineWs}\n    被测 ${compareWs}`);
    if (code === 0) log(`✓ 全流程完成：${htmlOut}`);
    else log(`⚠️ gen-report 退出码 ${code}`);
  } finally {
    // 无论成功失败，还原 config.command 并清理可能遗留的回归进程（daemon / dev server）。
    // 注意：不删两个项目目录——留作回溯现场，下次同 profile 评测开跑时才各自重建覆盖。
    if (!_cleaning) {
      setCommand(originalCommand);
      log(`已还原 codeCli.command = ${originalCommand}`);
      cleanupOrphans();
    }
  }
}

main().catch((e) => { log(`失败: ${e.stack || e.message}`); cleanupAndExit('异常', 1); });
