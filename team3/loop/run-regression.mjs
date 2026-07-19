// run-regression.mjs — 串起 Step 0/1，跑一次完整回归（Step 2）
//
// 不改任何 harness，把一次 team3 项目从「只有 app_design.md 的干净起点」一路跑到
// acceptance 验收，并采集指标、产出 regress.md。
//
// 流程：
//   1. 清理 workspace（干净起点）
//   2. initProject：建骨架 + 注册 + 启 daemon + kick arch（复用 web 原始实现）
//   3. 启动 human-sim（常驻，替人类做产品决策）
//   4. 轮询 spec/actions.jsonl 等待 harness 完成（UAT「产品验收通过 N/M」）
//   5. 确保产品 dev server 就绪（init.sh，端口 3001）→ 跑 acceptance
//   6. 采集指标（轮次 / 耗时 / token 估算）→ 写 regress.md
//
// 用法：
//   node run-regression.mjs [--profile min|full] [--workspace <abs>] [--design <app_design.md>]
//                           [--base-url http://localhost:3001]
//                           [--timeout-min 60] [--no-superman] [--no-clean] [--update-baseline] [--out <regress.md>]
//
// superman（--dangerously-skip-permissions）默认开启：回归 spawn 的 daemon agent 必须能无阻
//   写文件，否则 arch/dev 一开工就被权限拒绝卡死。仅调试权限时用 --no-superman 关闭。
//
// 效率基线：首次 PASS 建立 baseline.<profile>.md；之后每次回归对比它——
//   一次性完成由「是」变「否」→ 强报警（判未通过）；token/耗时 ≥ 2× → 弱提示。
//   --update-baseline 强制用本次 PASS 结果覆盖基线。
//
// --profile（默认 min）：
//   min  → 精简版 app_design.min.md + acceptance.min.mjs（纯 HTTP，快，日常回归）
//   full → 完整版 app_design.md     + acceptance.mjs（puppeteer 三页动线，慢，依赖 Chrome）
// --design 显式传入时优先于 profile 对应的 design。
//
// 默认 workspace = /tmp/t3-regress/vote-app（可被 --workspace 覆盖）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { initProject } from './init-project.mjs';
import { createHumanSim } from './human-sim.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOOP_DIR = __dirname;

// profile → 设计文件 / acceptance 模块。默认 min（快速回归）。
const DESIGN_BY_PROFILE = {
  min: path.join(LOOP_DIR, 'vote-app', 'app_design.min.md'),
  full: path.join(LOOP_DIR, 'vote-app', 'app_design.md'),
};
const ACCEPTANCE_BY_PROFILE = {
  min: './vote-app/acceptance.min.mjs',
  full: './vote-app/acceptance.mjs',
};
// profile → 效率基线文件（首次 PASS 建立，之后回归对比它做退化报警）
const BASELINE_BY_PROFILE = {
  min: path.join(LOOP_DIR, 'vote-app', 'baseline.min.md'),
  full: path.join(LOOP_DIR, 'vote-app', 'baseline.full.md'),
};
const DEFAULT_TIMEOUT_BY_PROFILE = {
  min: 60,
  full: 360, // full 范围大（8+ Feature + UAT 三页动线），60min 跑不完
};
const DEFAULT_REGRESS_DIR = '/tmp/t3-regress';
const DEFAULT_WORKSPACE = path.join(DEFAULT_REGRESS_DIR, 'vote-app');

const POLL_INTERVAL_MS = 5000;
const PASS_RE = /产品验收通过\s*\d+\s*\/\s*\d+/;
const FAIL_RE = /3\s*轮仍失败|exhausted|无法继续|放弃/;

/* ------------------------------------------------------------------ */
/*  完成检测                                                            */
/* ------------------------------------------------------------------ */

function readActions(actionsPath) {
  if (!fs.existsSync(actionsPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(actionsPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch {}
  }
  return out;
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

// 返回 {status:'pass'|'fail', message} 或 null
function detectCompletion(actions) {
  for (const a of actions) {
    if (a.action !== 'to_human') continue;
    const msg = a.message || '';
    if (a.from === 'uat' && PASS_RE.test(msg)) return { status: 'pass', message: msg };
    if ((a.from === 'uat' || a.from === 'arch') && FAIL_RE.test(msg)) return { status: 'fail', message: msg };
  }
  return null;
}

// 以 uat/state.json 为准的完成检测：所有 story status=pass 即视为完成。
// 这是最可靠的信号——state.json 是 UAT 的状态追踪器，不依赖 actions 措辞或 report 覆盖度。
function detectStateCompletion(workspace) {
  const state = readJSON(path.join(workspace, 'uat', 'state.json'));
  if (!state || !state.stories) return null;
  const entries = Object.values(state.stories);
  if (!entries.length) return null;
  if (!entries.every((s) => s && s.status === 'pass')) return null;
  return {
    status: 'pass',
    message: `uat/state.json 全部 ${entries.length} 个 story pass`,
    stateOk: true,
  };
}

// uat_stories.md 里定义的 Story 总数（用于确认”全部”而非”部分”通过）
function totalStoriesInSpec(workspace) {
  const p = path.join(workspace, 'spec', 'uat_stories.md');
  const text = readText(p);
  if (!text) return 0;
  return (text.match(/^##\s*Story\s+\d+/gm) || []).length;
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

// 以产物为准的完成检测（比 actions 里那句话可靠）：
// 硬门槛 = uat_report.md 存在且所有「### 结果」为 pass；
// state.json 若存在也须全 pass（交叉验证）。
// 不再要求 report 覆盖度 == spec story 数——UAT 可能合并/跳过部分 story，
// 只要已执行的都 pass 且 state.json 全 pass 即可。
function detectFileCompletion(workspace) {
  const rep = crossCheckReport(workspace);
  if (!rep.ok) return null; // 必须有 uat_report.md 且全 pass

  const state = readJSON(path.join(workspace, 'uat', 'state.json'));
  if (state && state.stories) {
    const entries = Object.values(state.stories);
    if (entries.length && !entries.every((s) => s && s.status === 'pass')) return null;
  }
  return {
    status: 'pass',
    message: `uat_report.md 全 pass（${rep.detail}）`,
    reportOk: true,
  };
}

// 交叉验证 uat_report.md：存在且所有「### 结果」段落判定为 pass
// 兼容多种写法：`### 结果: pass` / `### 结果\n\n**pass** — …` / `### 结果：partial`
function crossCheckReport(workspace) {
  const reportPath = path.join(workspace, 'spec', 'uat_report.md');
  if (!fs.existsSync(reportPath)) return { ok: false, total: 0, pass: 0, detail: 'uat_report.md 不存在' };
  const text = fs.readFileSync(reportPath, 'utf-8');
  const blocks = text.split(/^###\s*结果[:：]?/gm).slice(1);
  if (blocks.length === 0) return { ok: false, total: 0, pass: 0, detail: 'uat_report.md 无「### 结果」条目' };
  const verdicts = blocks.map((b) => {
    const m = b.slice(0, 80).match(/(pass|fail|partial)/i);
    return m ? m[1].toLowerCase() : 'unknown';
  });
  const passN = verdicts.filter((v) => v === 'pass').length;
  const allPass = verdicts.every((v) => v === 'pass');
  return { ok: allPass, total: verdicts.length, pass: passN, detail: `${passN}/${verdicts.length} story pass` };
}

/* ------------------------------------------------------------------ */
/*  指标采集                                                            */
/* ------------------------------------------------------------------ */

function collectTokens(workspace) {
  const logDir = path.join(workspace, 'logs');
  const totals = { input: 0, output: 0 };
  if (!fs.existsSync(logDir)) return totals;
  for (const f of fs.readdirSync(logDir)) {
    if (!f.endsWith('.log')) continue;
    let content;
    try { content = fs.readFileSync(path.join(logDir, f), 'utf-8'); } catch { continue; }
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || !t.includes('"result"') || !t.includes('usage')) continue;
      let obj;
      try { obj = JSON.parse(t); } catch { continue; }
      if (obj.type === 'result' && obj.usage) {
        totals.input += obj.usage.input_tokens || 0;
        totals.output += obj.usage.output_tokens || 0;
      }
    }
  }
  return totals;
}

// 指标口径：不比原始次数（意义不大），而是分析「能否一次性做完」= 没有返工。
// dev 返工 = dev_fix；uat 返工 = uat_fix；repair_round = uat/state.json 各 story 的修复轮次之和。
// oneShot = 三者皆为 0，即从设计到验收一次通过、无返修。
function collectMetrics(workspace, startMs, endMs) {
  const actions = readActions(path.join(workspace, 'spec', 'actions.jsonl'));
  const byAction = {};
  for (const a of actions) byAction[a.action] = (byAction[a.action] || 0) + 1;

  const devRework = byAction['dev_fix'] || 0;
  const uatRework = byAction['uat_fix'] || 0;

  let repairRounds = 0;
  const state = readJSON(path.join(workspace, 'uat', 'state.json'));
  if (state && state.stories) {
    for (const s of Object.values(state.stories)) {
      if (s && typeof s.repair_round === 'number') repairRounds += s.repair_round;
    }
  }

  const oneShot = devRework === 0 && uatRework === 0 && repairRounds === 0;
  const tokens = collectTokens(workspace);
  return {
    oneShot,
    devRework,
    uatRework,
    repairRounds,
    totalActions: actions.length, // 全部 action 行数，仅作参考
    byAction,
    durationMs: endMs - startMs,
    tokens: { ...tokens, total: tokens.input + tokens.output },
  };
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/* ------------------------------------------------------------------ */
/*  效率基线：首次 PASS 建立 baseline.<profile>.md，之后回归对比退化      */
/* ------------------------------------------------------------------ */

const DEGRADE_FACTOR = 2; // token / 耗时 达到基线的 N 倍才弱提示

// 读取 baseline.md 中内嵌的 ```json 块 → 对象；缺失/不可解析返回 null
function readBaseline(baselinePath) {
  let text;
  try { text = fs.readFileSync(baselinePath, 'utf-8'); } catch { return null; }
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// 写 baseline.<profile>.md：人类可读头 + 可机器解析的 json 块
function writeBaseline(baselinePath, { profile, metrics, acceptance, createdAt }) {
  const data = {
    profile,
    oneShot: metrics.oneShot,
    tokensTotal: metrics.tokens.total,
    durationMs: metrics.durationMs,
    totalActions: metrics.totalActions,
    acceptance: acceptance ? `${acceptance.passed}/${acceptance.total}` : null,
    createdAt,
  };
  const lines = [
    `# 效率基线 — vote-app（profile: ${profile}）`,
    '',
    `- 建立时间: ${createdAt}`,
    `- 一次性完成: ${metrics.oneShot ? '是' : '否'}`,
    `- token 估算: ${metrics.tokens.total}`,
    `- 耗时: ${fmtDuration(metrics.durationMs)}`,
    `- 总 action 数: ${metrics.totalActions}`,
    `- acceptance: ${data.acceptance || '(无)'}`,
    '',
    '> 后续回归对比下方 json；一次性完成由「是」变「否」→ 强报警；token/耗时 ≥ 2× → 弱提示。',
    '',
    '```json',
    JSON.stringify(data, null, 2),
    '```',
    '',
  ];
  fs.writeFileSync(baselinePath, lines.join('\n'), 'utf-8');
}

// 对比本次指标与基线：强报警（返工回归）走 alarms，弱提示（token/耗时翻倍）走 warnings
function compareToBaseline(baseline, metrics) {
  const alarms = [];
  const warnings = [];
  if (baseline.oneShot === true && metrics.oneShot === false) {
    alarms.push(`一次性完成退化：基线一次通过，本次出现返工（dev ${metrics.devRework} / uat ${metrics.uatRework} / repair ${metrics.repairRounds}）`);
  }
  if (baseline.tokensTotal && metrics.tokens.total >= baseline.tokensTotal * DEGRADE_FACTOR) {
    warnings.push(`token 明显上升：${metrics.tokens.total} vs 基线 ${baseline.tokensTotal}（≥${DEGRADE_FACTOR}×）`);
  }
  if (baseline.durationMs && metrics.durationMs >= baseline.durationMs * DEGRADE_FACTOR) {
    warnings.push(`耗时明显上升：${fmtDuration(metrics.durationMs)} vs 基线 ${fmtDuration(baseline.durationMs)}（≥${DEGRADE_FACTOR}×）`);
  }
  return { alarms, warnings };
}

/* ------------------------------------------------------------------ */
/*  产品 dev server                                                    */
/* ------------------------------------------------------------------ */

async function probe(baseUrl, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(baseUrl, { signal: ctrl.signal });
    return true; // 任意 HTTP 响应（含 404）都说明 server 起来了
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureProductUp(workspace, baseUrl, log) {
  if (await probe(baseUrl)) return 'already-running';
  const initSh = path.join(workspace, 'init.sh');
  if (!fs.existsSync(initSh)) throw new Error(`产品未就绪且缺 init.sh: ${initSh}`);
  log(`  产品未响应，执行 init.sh 启动…`);
  execSync('chmod +x init.sh && ./init.sh', { cwd: workspace, timeout: 180_000, stdio: 'inherit' });
  for (let i = 0; i < 30; i++) {
    if (await probe(baseUrl)) return 'started';
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`init.sh 执行后 60s 内 ${baseUrl} 仍无响应`);
}

function stopProduct(workspace, log) {
  const initSh = path.join(workspace, 'init.sh');
  if (!fs.existsSync(initSh)) return;
  try {
    execSync('./init.sh stop', { cwd: workspace, timeout: 30_000, stdio: 'ignore' });
    log('  已执行 init.sh stop');
  } catch { /* best-effort */ }
}

// full profile 的 acceptance.mjs 用 puppeteer-core 驱动本机 Chrome，但它是「回归工具」
// 的依赖、不属于产品——Dev 建出来的 vote-app 不会装它。acceptance 从 workspace/node_modules
// 解析 puppeteer-core，所以每次重建 workspace 后在这里把它装进去（幂等：已在则跳过）。
const PUPPETEER_VERSION = '25.3.0';
function ensurePuppeteer(workspace, log) {
  const require = createRequire(path.join(workspace, 'x.js'));
  try {
    require.resolve('puppeteer-core', { paths: [path.join(workspace, 'node_modules')] });
    log('  puppeteer-core 已就绪，跳过安装');
    return;
  } catch { /* 未安装，继续 */ }
  log(`  安装 puppeteer-core@${PUPPETEER_VERSION} 到 workspace…`);
  execSync(`npm install puppeteer-core@${PUPPETEER_VERSION} --no-save --no-audit --no-fund`, {
    cwd: workspace,
    timeout: 180_000,
    stdio: 'inherit',
  });
}

/* ------------------------------------------------------------------ */
/*  回归目录准备（新建或清空干净起点）                                  */
/* ------------------------------------------------------------------ */

// regressDir = workspace 的父目录（默认 /tmp/t3-regress）。
// 删除风险大：**只有当 regressDir 恰好是 /tmp/t3-regress 时**才允许清空其内容；
// 其它任何目录都拒绝删除（可新建/确保存在，但不删）。clean=false 时只确保存在。
function prepareRegressDir(regressDir, { clean }) {
  const abs = path.resolve(regressDir);
  if (clean) {
    if (abs !== DEFAULT_REGRESS_DIR) {
      throw new Error(
        `安全护栏：清空删除只允许作用于 ${DEFAULT_REGRESS_DIR}，当前 regressDir=${abs}。\n` +
        `请手动清理该目录，或使用默认回归目录（不传 --workspace）。`
      );
    }
    fs.rmSync(abs, { recursive: true, force: true });
  }
  fs.mkdirSync(abs, { recursive: true });
}

/* ------------------------------------------------------------------ */
/*  主流程                                                             */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    profile: 'min',
    workspace: DEFAULT_WORKSPACE,
    design: null, // 未显式指定则按 profile 解析
    baseUrl: 'http://localhost:3001',
    timeoutMin: null, // 未显式指定则按 profile 默认
    superman: true,
    clean: true,
    kick: true,
    brief: null,
    updateBaseline: false,
    out: path.join(LOOP_DIR, 'vote-app', 'regress.md'),
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === '--profile' && args[i + 1]) out.profile = args[++i];
    else if ((k === '--workspace' || k === '-w') && args[i + 1]) out.workspace = args[++i];
    else if (k === '--design' && args[i + 1]) out.design = args[++i];
    else if (k === '--base-url' && args[i + 1]) out.baseUrl = args[++i];
    else if (k === '--timeout-min' && args[i + 1]) out.timeoutMin = Number(args[++i]);
    else if (k === '--brief' && args[i + 1]) out.brief = args[++i];
    else if (k === '--out' && args[i + 1]) out.out = args[++i];
    else if (k === '--superman') out.superman = true;
    else if (k === '--no-superman') out.superman = false;
    else if (k === '--no-clean') out.clean = false;
    else if (k === '--no-kick') out.kick = false;
    else if (k === '--update-baseline') out.updateBaseline = true;
  }
  if (!DESIGN_BY_PROFILE[out.profile]) {
    throw new Error(`未知 --profile: ${out.profile}（可选 min | full）`);
  }
  if (!out.design) out.design = DESIGN_BY_PROFILE[out.profile];
  if (out.timeoutMin == null) out.timeoutMin = DEFAULT_TIMEOUT_BY_PROFILE[out.profile];
  out.workspace = path.resolve(out.workspace);
  return out;
}

function writeReport(outPath, ctx) {
  const { workspace, port, harness, report, acceptance, metrics, startedAt, profile, baselineCompare } = ctx;
  const lines = [];
  lines.push('# 回归报告 — vote-app', '');
  lines.push(`- profile: ${profile}${profile === 'min' ? '（精简版 仅 POST /create）' : '（完整版 三页动线）'}`);
  lines.push(`- 开始时间: ${startedAt}`);
  lines.push(`- workspace: ${workspace}`);
  lines.push(`- daemon 端口: ${port}`);
  lines.push(`- harness 结果: **${harness.status.toUpperCase()}**`);
  if (report) lines.push(`- uat_report 交叉验证: ${report.ok ? 'OK' : '不一致'}（${report.detail}）`);
  if (acceptance) lines.push(`- acceptance: ${acceptance.passed}/${acceptance.total} 通过`);
  lines.push('');
  lines.push('## 指标');
  lines.push(`- 一次性完成: ${metrics.oneShot ? '是' : '否'}（dev 返工 ${metrics.devRework} 次；uat 返工 ${metrics.uatRework} 次；repair_round 累计 ${metrics.repairRounds} 轮）`);
  lines.push(`- 总 action 数（仅作参考）: ${metrics.totalActions}`);
  lines.push(`- 耗时: ${fmtDuration(metrics.durationMs)}`);
  lines.push(`- token 估算: total ${metrics.tokens.total}（in ${metrics.tokens.input} / out ${metrics.tokens.output}）`);
  lines.push(`- action 分布: ${Object.entries(metrics.byAction).map(([k, v]) => `${k}=${v}`).join(', ') || '(空)'}`);
  lines.push('');
  lines.push('## harness 完成信号');
  lines.push('```');
  lines.push((harness.message || '(无)').slice(0, 500));
  lines.push('```');
  if (acceptance && acceptance.failed.length) {
    lines.push('', '## acceptance 失败项');
    for (const f of acceptance.failed) lines.push(`- ${f.name}: ${f.detail}`);
  }
  lines.push('', '## 基线对比');
  if (!baselineCompare) {
    lines.push('- 尚无基线（本次将建立）');
  } else if (!baselineCompare.alarms.length && !baselineCompare.warnings.length) {
    lines.push('- 无退化');
  } else {
    for (const a of baselineCompare.alarms) lines.push(`- 强报警: ${a}`);
    for (const w of baselineCompare.warnings) lines.push(`- 提示: ${w}`);
  }
  lines.push('');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}

async function main() {
  const opts = parseArgs(process.argv);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  if (opts.superman) process.env.TEAM3_SUPERMAN = '1';

  // 回归目录 = workspace 父目录（默认 /tmp/t3-regress）。启动前新建或清空，
  // 再把 regress-run.log 开在其下；log() 同时输出到 stdout 与该文件。
  const regressDir = path.dirname(opts.workspace);
  prepareRegressDir(regressDir, opts);
  const logPath = path.join(regressDir, 'regress-run.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  const log = (m) => { process.stdout.write(m + '\n'); logStream.write(m + '\n'); };

  log(`=== 回归开始 ${startedAt} ===`);
  log(`profile=${opts.profile}`);
  log(`regressDir=${regressDir}（${opts.clean ? '已清空重建' : '保留'}）`);
  log(`workspace=${opts.workspace}`);
  log(`design=${opts.design}`);
  log(`log=${logPath}`);
  log(`timeout=${opts.timeoutMin}min\n`);

  // 1. 干净起点（regressDir 已在上面新建/清空，workspace 由 initWorkspace 重建）
  log(`[1/6] 回归目录就绪: ${regressDir}`);

  // 2. 初始化 + 启 daemon + kick arch
  log('[2/6] 初始化项目并启动 daemon');
  const proj = await initProject(opts.workspace, { designPath: opts.design, kick: opts.kick, brief: opts.brief });
  log(`  daemon PID ${proj.pid}, port ${proj.port}${proj.kicked ? '，已 kick arch' : '（未 kick）'}`);

  // 3. 启动 human-sim（常驻，后台）
  log('[3/6] 启动 human-sim');
  const sim = createHumanSim({ workspace: opts.workspace, superman: opts.superman, logger: (m) => log('  [human-sim] ' + m) });
  const simPromise = sim.start({ designPath: opts.design }).catch((e) => log('  [human-sim] 异常: ' + e.message));

  // 4. 轮询完成
  log('[4/6] 等待 harness 完成…');
  const actionsPath = path.join(opts.workspace, 'spec', 'actions.jsonl');
  const deadline = startMs + opts.timeoutMin * 60_000;
  let harness = null;
  while (Date.now() < deadline) {
    harness = detectCompletion(readActions(actionsPath))
      || detectStateCompletion(opts.workspace)
      || detectFileCompletion(opts.workspace);
    if (harness) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (!harness) harness = { status: 'timeout', message: `${opts.timeoutMin}min 超时未见完成信号` };
  log(`  harness 状态: ${harness.status} — ${(harness.message || '').slice(0, 80)}`);

  sim.stop();
  await Promise.race([simPromise, new Promise((r) => setTimeout(r, 3000))]);

  // 5. acceptance（仅在 harness pass 时）
  let acceptance = null;
  let report = null;
  if (harness.status === 'pass') {
    report = crossCheckReport(opts.workspace);
    log(`  uat_report 交叉验证: ${report.ok ? 'OK' : '不一致'}（${report.detail}）`);
    log('[5/6] 运行 acceptance');
    try {
      if (opts.profile === 'full') ensurePuppeteer(opts.workspace, log);
      await ensureProductUp(opts.workspace, opts.baseUrl, log);
      const { runAcceptance } = await import(ACCEPTANCE_BY_PROFILE[opts.profile]);
      acceptance = await runAcceptance({ baseUrl: opts.baseUrl, workspace: opts.workspace, log: (m) => log('  ' + m) });
    } catch (e) {
      log(`  acceptance 无法运行: ${e.message}`);
      acceptance = { passed: 0, total: 0, failed: [{ name: '运行 acceptance', detail: e.message }] };
    } finally {
      stopProduct(opts.workspace, log);
    }
  } else {
    log('[5/6] harness 未通过，跳过 acceptance');
  }

  // 6. 指标 + 报告
  log('[6/6] 采集指标并写报告');
  const metrics = collectMetrics(opts.workspace, startMs, Date.now());
  const passing = harness.status === 'pass' && (!acceptance || acceptance.failed.length === 0);

  // 效率基线：对比 + （首次 PASS 或 --update-baseline）建立/更新
  const baselinePath = BASELINE_BY_PROFILE[opts.profile];
  const baseline = readBaseline(baselinePath);
  let baselineCompare = null;
  if (baseline) {
    baselineCompare = compareToBaseline(baseline, metrics);
    for (const a of baselineCompare.alarms) log(`  [基线·强报警] ${a}`);
    for (const w of baselineCompare.warnings) log(`  [基线·提示] ${w}`);
    if (!baselineCompare.alarms.length && !baselineCompare.warnings.length) log('  基线对比: 无退化');
  } else {
    log('  基线对比: 尚无基线');
  }
  if (passing && (!baseline || opts.updateBaseline)) {
    writeBaseline(baselinePath, { profile: opts.profile, metrics, acceptance, createdAt: startedAt });
    log(`  基线已${baseline ? '更新' : '建立'}: ${baselinePath}`);
  }

  writeReport(opts.out, { workspace: opts.workspace, port: proj.port, harness, report, acceptance, metrics, startedAt, profile: opts.profile, baselineCompare });
  log(`\n报告已写入: ${opts.out}`);
  log(`一次性完成=${metrics.oneShot ? '是' : '否'} 耗时=${fmtDuration(metrics.durationMs)} token≈${metrics.tokens.total}`);

  const degraded = !!(baselineCompare && baselineCompare.alarms.length);
  const ok = passing && !degraded;
  log(`\n=== 回归${ok ? '通过' : '未通过'}${degraded ? '（基线退化）' : ''} ===`);
  await new Promise((r) => logStream.end(r)); // flush 日志文件
  process.exit(ok ? 0 : 1); // 触发 web startDaemon 的 exit 钩子，daemon 随之退出
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    process.stderr.write(`run-regression 失败: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
