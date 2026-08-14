// run-regression.mjs — 串起 Step 0/1，跑一次完整回归（Step 2）
//
// 不改任何 harness，把一次 team3 项目从「只有 app_design.md 的干净起点」一路跑到
// UAT 验收完成，并采集指标、产出 regress.<profile>.md。
//
// 流程：
//   1. 清理 workspace（干净起点）
//   2. initProject：建骨架 + 注册 + 启 daemon + kick arch（复用 web 原始实现）
//   3. 启动 human-sim（常驻，替人类做产品决策）
//   4. 轮询 spec/actions.jsonl 等待 harness 完成（UAT「产品验收通过 N/M」）
//   5. 采集指标（轮次 / 执行耗时 / llm 请求数 / token 估算）→ 写 regress.<profile>.md
//
// 判据只有 harness 自身的 UAT 结果：uat_report.md 全 pass + 交叉验证一致。
// 曾有一份外部 acceptance 脚本，但 vote-app 每次都是独立生成的，脚本必须猜 API 路径和
// data-testid 这些 app_design 没钉住的约定，误报多且与 UAT story 重叠，已移除。
//
// 用法：
//   node run-regression.mjs [--profile min|full] [--workspace <abs>] [--design <app_design.md>]
//                           [--timeout-min 60] [--no-superman] [--no-clean] [--update-baseline]
//                           [--out <path>] [--pkg [dir]]
//
// --pkg：跑**全局安装的打包产物**而非源码树（设 TEAM3_PKG_DIR）——daemon 入口走
//   $TEAM3_PKG_DIR/daemon.min.js、`{ref}` 指向 assets/ref、cli 从 assets/cli 下发，
//   用于验证终端用户安装后的真实链路。需先 `bash build/build.sh && npm install -g ./pkg/team3-*.tgz`。
//   不带路径时自动探测 `npm root -g`/team3；带路径则用指定目录。
//
// superman（--dangerously-skip-permissions）默认开启：回归 spawn 的 daemon agent 必须能无阻
//   写文件，否则 arch/dev 一开工就被权限拒绝卡死。仅调试权限时用 --no-superman 关闭。
//
// 效率基线：首次 PASS 建立 baseline.<profile>.md；之后每次回归对比它——
//   返工次数（dev_fix + uat_fix）比基线多 → 强报警（判未通过）；token/耗时 ≥ 2× → 弱提示。
//   --update-baseline 强制用本次 PASS 结果覆盖基线。
//
// --profile（默认 min）：
//   min  → 精简版 app_design.min.md（只一个创建接口，快，日常回归）
//   full → 完整版 app_design.md（前后端三页面完整产品，慢）
// --design 显式传入时优先于 profile 对应的 design。
//
// 默认 workspace = /tmp/t3-regress/vote-app（可被 --workspace 覆盖）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { initProject } from './init-project.mjs';
import { createHumanSim } from './human-sim.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOOP_DIR = __dirname;

// profile → 设计文件。默认 min（快速回归）。
const DESIGN_BY_PROFILE = {
  min: path.join(LOOP_DIR, 'vote-app', 'app_design.min.md'),
  full: path.join(LOOP_DIR, 'vote-app', 'app_design.md'),
};
// profile → 回归报告（与基线一一对应，两个 profile 的结果互不覆盖）
const REPORT_BY_PROFILE = {
  min: path.join(LOOP_DIR, 'vote-app', 'regress.min.md'),
  full: path.join(LOOP_DIR, 'vote-app', 'regress.full.md'),
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

// 以 uat/state.json 为准的完成检测（**兜底**，不是首选信号）。
// 注意：state.json 的 stories 是每次 uat_check 增量写入的（不是一次性全建），
// 只看「已有条目全 pass」会在第 1 个 story 刚过时误报完成。所以必须用
// spec/uat_stories.md 的 story 总数兜底：条目数 < spec 总数不算完成。
//
// 另一个坑（曾导致 uat_report.md 缺失）：story 全 pass 只说明验证跑完了，
// 但按协议 UAT 之后还要写 spec/uat_report.md、跑 validate-uat-evidence、
// 再发 to_human「产品验收通过 N/M」。立刻判完成会让 harness 收摊、把正在
// 写报告的 UAT 杀掉。所以这里加收尾宽限期：先让正常路径
// （detectCompletion / detectFileCompletion）有机会命中，超过宽限期才兜底。
const STATE_COMPLETION_GRACE_MS = 180_000;
let stateCompletionFirstSeenMs = null;

function detectStateCompletion(workspace) {
  const state = readJSON(path.join(workspace, 'uat', 'state.json'));
  if (!state || !state.stories) return null;
  const entries = Object.values(state.stories);
  if (!entries.length) return null;
  if (!entries.every((s) => s && s.status === 'pass')) return null;
  const specTotal = totalStoriesInSpec(workspace);
  if (specTotal > 0 && entries.length < specTotal) return null;

  // 给 UAT 留收尾时间（写 report + 发 to_human）
  if (stateCompletionFirstSeenMs === null) stateCompletionFirstSeenMs = Date.now();
  const waited = Date.now() - stateCompletionFirstSeenMs;
  if (waited < STATE_COMPLETION_GRACE_MS) return null;

  return {
    status: 'pass',
    message: `uat/state.json 全部 ${entries.length}/${specTotal || entries.length} 个 story pass`
      + `（兜底：等待 ${Math.round(waited / 1000)}s 后 UAT 仍未写出 uat_report.md / 发出验收消息）`,
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
export function crossCheckReport(workspace) {
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

// 按角色汇总 agent 统计：日志文件名形如 arch_*.log / dev_*.log / uat_*.log，前缀即角色。
// 数据源是每个 session 收尾的 "type":"result" 行，一行 = 一个 session：
//   usage       → token（daemon 已按 chars/4 估算回填）
//   num_turns   → 该 session 与 LLM 的交互次数（耗时与 token 的源头）
//   duration_ms → 该 session 真实执行耗时（不含 agent 空转等待对方回消息的时间）
function collectAgentStats(workspace) {
  const logDir = path.join(workspace, 'logs');
  const totals = { input: 0, output: 0, requests: 0, execMs: 0 };
  const byRole = {};
  if (!fs.existsSync(logDir)) return { total: totals, byRole };
  for (const f of fs.readdirSync(logDir)) {
    if (!f.endsWith('.log')) continue;
    const role = f.split(/[_.]/)[0] || 'other';
    let content;
    try { content = fs.readFileSync(path.join(logDir, f), 'utf-8'); } catch { continue; }
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || !t.includes('"result"') || !t.includes('usage')) continue;
      let obj;
      try { obj = JSON.parse(t); } catch { continue; }
      if (obj.type === 'result' && obj.usage) {
        const inTok = obj.usage.input_tokens || 0;
        const outTok = obj.usage.output_tokens || 0;
        const requests = obj.num_turns || 0;
        const execMs = obj.duration_ms || 0;
        totals.input += inTok;
        totals.output += outTok;
        totals.requests += requests;
        totals.execMs += execMs;
        if (!byRole[role]) byRole[role] = { input: 0, output: 0, total: 0, sessions: 0, requests: 0, execMs: 0 };
        byRole[role].input += inTok;
        byRole[role].output += outTok;
        byRole[role].total += inTok + outTok;
        byRole[role].sessions += 1;
        byRole[role].requests += requests;
        byRole[role].execMs += execMs;
      }
    }
  }
  return { total: totals, byRole };
}

// 等待指定角色的 agent session 自然收尾，确保其 token 能被 collectAgentStats 统计到。
// 完成信号（uat/state.json 全 pass）常在 UAT session 仍在跑时就触发，此刻 UAT 日志
// 还没写出 "type":"result" 行 → token 统计不到（回归报告里 tokensByRole 缺 uat 即此因）。
// 判据（任一命中即停等该角色）：
//   - 出现新的 result 行（session 正常收尾，token 已落盘）；
//   - 日志 idleMs 内无字节增长（session 卡死/空转，best-effort 放行）；
//   - 总等待超 timeoutMs（安全兜底）。
// 只读日志、不碰 daemon。
async function waitForRoleSessionsEnd(workspace, roles, { timeoutMs = 180_000, idleMs = 45_000, log = () => {} }) {
  const logDir = path.join(workspace, 'logs');
  if (!fs.existsSync(logDir)) return;
  const scan = (role) => {
    let n = 0, size = 0;
    for (const f of fs.readdirSync(logDir)) {
      if (!f.endsWith('.log') || f.split(/[_.]/)[0] !== role) continue;
      let c;
      try { c = fs.readFileSync(path.join(logDir, f), 'utf-8'); } catch { continue; }
      size += c.length;
      for (const line of c.split('\n')) {
        if (line.includes('"result"') && line.includes('usage')) n++;
      }
    }
    return { n, size };
  };
  const pending = new Map();
  for (const r of roles) {
    const { n, size } = scan(r);
    pending.set(r, { baseN: n, lastSize: size, lastGrow: Date.now() });
  }
  const deadline = Date.now() + timeoutMs;
  while (pending.size && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    for (const r of [...pending.keys()]) {
      const st = pending.get(r);
      const { n, size } = scan(r);
      if (n > st.baseN) {
        log(`  [wait] ${r} session 已收尾（result +${n - st.baseN}），token 已可统计`);
        pending.delete(r);
      } else if (size > st.lastSize) {
        st.lastSize = size;
        st.lastGrow = Date.now();
      } else if (Date.now() - st.lastGrow > idleMs) {
        log(`  [wait] ${r} 日志 ${Math.round(idleMs / 1000)}s 无增长，视为已停（未见 result，token 可能仍缺）`);
        pending.delete(r);
      }
    }
  }
  for (const r of pending.keys()) {
    log(`  [wait] ${r} 等待超时（${Math.round(timeoutMs / 1000)}s 未收尾），继续收指标`);
  }
}

// 指标口径：不比原始次数（意义不大），而是分析「能否一次性做完」= 没有返工。
// 返工只算 **Arch 派发的** dev_fix / uat_fix（human 回答 UAT 提问也用 uat_fix，不算返工）。
// oneShot = 两者皆为 0。UAT 自修轮次（repair_round，含 script_issue）不参与 oneShot，
// 单独作为 UAT 自身效率指标，另按 script / product 拆分。
export function collectMetrics(workspace, startMs, endMs) {
  const actions = readActions(path.join(workspace, 'spec', 'actions.jsonl'));
  const byAction = {};
  const bySender = {};
  for (const a of actions) {
    byAction[a.action] = (byAction[a.action] || 0) + 1;
    if (a.from) bySender[a.from] = (bySender[a.from] || 0) + 1;
  }

  // 返工 = Arch 把 agent 退回去改。必须判 from：human-sim 回答 UAT 提问也用
  // uat_fix（见 human-sim 的 routeTo），那是正常交互，不是返工。
  const devRework = actions.filter((a) => a.action === 'dev_fix' && a.from === 'arch').length;
  const uatRework = actions.filter((a) => a.action === 'uat_fix' && a.from === 'arch').length;

  // UAT 自修轮次：单独作为 UAT 自身效率指标，不参与 oneShot 判定 ——
  // 其中 script_issue 是 UAT 自己脚本的问题（与产品无关），拿它否决"一次性完成"
  // 等于把 UAT 脚本 bug 记成产品返工。按 last_failure 前缀拆成两类看清是谁的问题。
  const repair = { total: 0, script: 0, product: 0 };
  const state = readJSON(path.join(workspace, 'uat', 'state.json'));
  if (state && state.stories) {
    for (const s of Object.values(state.stories)) {
      if (!s || typeof s.repair_round !== 'number' || s.repair_round <= 0) continue;
      repair.total += s.repair_round;
      if (/^script_issue/.test(s.last_failure || '')) repair.script += s.repair_round;
      else repair.product += s.repair_round;
    }
  }

  const oneShot = devRework === 0 && uatRework === 0;

  // story 口径：state.json 是 UAT 自己的执行台账，spec/uat_stories.md 是应做总数，
  // 取两者较大值做分母，避免 UAT 漏跑 story 时分母缩水看着像全通过。
  const stories = { pass: 0, total: 0 };
  if (state && state.stories) {
    const entries = Object.values(state.stories);
    stories.pass = entries.filter((s) => s && s.status === 'pass').length;
    stories.total = Math.max(entries.length, totalStoriesInSpec(workspace));
  } else {
    stories.total = totalStoriesInSpec(workspace);
  }
  const reportGenerated = fs.existsSync(path.join(workspace, 'spec', 'uat_report.md'));

  const { total: agentTotals, byRole } = collectAgentStats(workspace);
  return {
    oneShot,
    devRework,
    uatRework,
    repairRounds: repair.total, // 兼容基线 json 里的既有字段
    repair,
    stories,
    reportGenerated,
    totalActions: actions.length, // 全部 action 行数，仅作参考
    byAction,
    bySender,
    durationMs: endMs - startMs, // 从开始到完成的经过时间：含 agent 互等
    execMs: agentTotals.execMs, // 真实执行耗时合计（不含等待）
    requests: agentTotals.requests,
    tokens: { input: agentTotals.input, output: agentTotals.output, total: agentTotals.input + agentTotals.output, byRole },
    byRole,
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

// "32m 24s" → ms
function parseDuration(s) {
  const m = /(\d+)m\s*(\d+)s/.exec(s || '');
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : 0;
}

// 从 baseline.md 提取指标：基线与回归报告是同一套 md 格式，直接按行解析，不另存 json
export function readBaseline(baselinePath) {
  let text;
  try { text = fs.readFileSync(baselinePath, 'utf-8'); } catch { return null; }
  const pick = (re) => { const m = re.exec(text); return m ? m[1] : null; };

  const tokensTotal = Number(pick(/^- token 估算: total (\d+)/m) || 0);
  const llmRequests = Number(pick(/^- 总 llm 请求数[：:]\s*(\d+)/m) || 0);
  const durationLine = pick(/^- 总耗时: (.+)$/m);
  if (!tokensTotal && !llmRequests && !durationLine) return null;

  return {
    devRework: Number(pick(/^\s*- dev_fix (\d+) 次/m) || 0),
    uatRework: Number(pick(/^\s*- uat_fix (\d+) 次/m) || 0),
    tokensTotal,
    llmRequests,
    execMs: parseDuration(durationLine),
    durationMs: parseDuration((durationLine || '').split('从开始到完成经过时间')[1]),
    totalActions: Number(pick(/^- 总 action 数: (\d+)/m) || 0),
  };
}

// 基线 = 某次通过的回归报告原样另存：去掉「基线对比」小节，换个标题
function writeBaseline(baselinePath, reportPath) {
  const report = fs.readFileSync(reportPath, 'utf-8');
  const body = report
    .split('\n## 基线对比')[0]
    .replace(/^# 回归报告 — vote-app$/m, '# 效率基线 — vote-app（由一次通过的回归结果另存）');
  const note = '> 后续回归按同样的 md 指标对比：Arch 派发的返工次数（dev_fix + uat_fix）比基线多 → 强报警；'
    + `token / llm 请求数 / 总耗时 ≥ ${DEGRADE_FACTOR}× → 弱提示。`;
  fs.writeFileSync(baselinePath, `${body.trimEnd()}\n\n${note}\n`, 'utf-8');
}

// 对比本次指标与基线：强报警（返工次数变多）走 alarms，弱提示（token/耗时翻倍）走 warnings
export function compareToBaseline(baseline, metrics) {
  const alarms = [];
  const warnings = [];
  // 返工比次数、不比有无：基线本身可能已带返工，只看「有/无」会让退化漏报
  const baseRework = (baseline.devRework || 0) + (baseline.uatRework || 0);
  const nowRework = (metrics.devRework || 0) + (metrics.uatRework || 0);
  if (nowRework > baseRework) {
    alarms.push(
      `Arch 派发的返工变多：${nowRework} 次 vs 基线 ${baseRework} 次`
      + `（dev_fix ${metrics.devRework} vs ${baseline.devRework || 0}，uat_fix ${metrics.uatRework} vs ${baseline.uatRework || 0}）`
    );
  }
  if (baseline.tokensTotal && metrics.tokens.total >= baseline.tokensTotal * DEGRADE_FACTOR) {
    warnings.push(`token 明显上升：${metrics.tokens.total} vs 基线 ${baseline.tokensTotal}（≥${DEGRADE_FACTOR}×）`);
  }
  if (baseline.llmRequests && metrics.requests >= baseline.llmRequests * DEGRADE_FACTOR) {
    warnings.push(`llm 请求数明显上升：${metrics.requests} vs 基线 ${baseline.llmRequests}（≥${DEGRADE_FACTOR}×）`);
  }
  // 耗时优先比执行耗时；老基线没这字段时退回从开始到完成经过时间
  if (baseline.execMs && metrics.execMs >= baseline.execMs * DEGRADE_FACTOR) {
    warnings.push(`执行耗时明显上升：${fmtDuration(metrics.execMs)} vs 基线 ${fmtDuration(baseline.execMs)}（≥${DEGRADE_FACTOR}×）`);
  } else if (!baseline.execMs && baseline.durationMs && metrics.durationMs >= baseline.durationMs * DEGRADE_FACTOR) {
    warnings.push(`耗时明显上升（从开始到完成经过时间口径，基线无执行耗时）：${fmtDuration(metrics.durationMs)} vs 基线 ${fmtDuration(baseline.durationMs)}（≥${DEGRADE_FACTOR}×）`);
  }
  return { alarms, warnings };
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
    // 清空要抗 ENOTEMPTY/EBUSY：遗留的 Next/turbopack dev server 可能仍在写 .next，
    // 边删边生成会让 rmdir 报 ENOTEMPTY（force 只忽略 ENOENT，不管这个）。
    // 先带重试删（Node 对 ENOTEMPTY/EBUSY 做线性退避重试），仍失败则把整目录
    // 原子改名挪走，让本轮用干净目录起，残留副本留在 /tmp 稍后可手动清理。
    try {
      fs.rmSync(abs, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (e) {
      const aside = `${abs}.stale-${Date.now()}`;
      try {
        fs.renameSync(abs, aside);
        process.stderr.write(`[prepareRegressDir] 清空遇 ${e.code || e.message}，已把残留目录挪到 ${aside}（可稍后手动删除）\n`);
      } catch (e2) {
        throw new Error(`清空回归目录失败（${e.code || e.message}），且改名挪走也失败（${e2.code || e2.message}）：${abs}`);
      }
    }
  }
  fs.mkdirSync(abs, { recursive: true });
}

/* ------------------------------------------------------------------ */
/*  主流程                                                             */
/* ------------------------------------------------------------------ */

// 定位全局安装的 team3 包目录（--pkg 用）。校验 daemon.min.js 存在，
// 它是打包产物的标志；缺失说明没装或装的是别的东西。
function resolveGlobalPkgDir() {
  let root;
  try {
    root = execSync('npm root -g', { encoding: 'utf-8' }).trim();
  } catch (e) {
    throw new Error(`无法执行 npm root -g: ${e.message}`);
  }
  const dir = path.join(root, 'team3');
  if (!fs.existsSync(path.join(dir, 'daemon.min.js'))) {
    throw new Error(
      `未找到全局安装的 team3 打包产物: ${dir}/daemon.min.js\n` +
      `请先 bash build/build.sh && npm install -g ./pkg/team3-*.tgz`
    );
  }
  return dir;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    profile: 'min',
    workspace: DEFAULT_WORKSPACE,
    design: null, // 未显式指定则按 profile 解析
    timeoutMin: null, // 未显式指定则按 profile 默认
    superman: true,
    clean: true,
    kick: true,
    brief: null,
    updateBaseline: false,
    noBaseline: false, // --no-baseline：不读/不写固定效率基线（评测编排器用，避免污染手工基线）
    pkg: null, // --pkg[=path]：跑全局安装的打包产物（设 TEAM3_PKG_DIR），验证终端用户链路
    out: null, // 未显式指定则按 profile 解析
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === '--profile' && args[i + 1]) out.profile = args[++i];
    else if ((k === '--workspace' || k === '-w') && args[i + 1]) out.workspace = args[++i];
    else if (k === '--design' && args[i + 1]) out.design = args[++i];
    else if (k === '--timeout-min' && args[i + 1]) out.timeoutMin = Number(args[++i]);
    else if (k === '--brief' && args[i + 1]) out.brief = args[++i];
    else if (k === '--out' && args[i + 1]) out.out = args[++i];
    else if (k === '--pkg' && args[i + 1] && !args[i + 1].startsWith('--')) out.pkg = args[++i];
    else if (k === '--pkg') out.pkg = resolveGlobalPkgDir();
    else if (k === '--superman') out.superman = true;
    else if (k === '--no-superman') out.superman = false;
    else if (k === '--no-clean') out.clean = false;
    else if (k === '--no-kick') out.kick = false;
    else if (k === '--update-baseline') out.updateBaseline = true;
    else if (k === '--no-baseline') out.noBaseline = true;
  }
  if (!DESIGN_BY_PROFILE[out.profile]) {
    throw new Error(`未知 --profile: ${out.profile}（可选 min | full）`);
  }
  if (!out.design) out.design = DESIGN_BY_PROFILE[out.profile];
  if (!out.out) out.out = REPORT_BY_PROFILE[out.profile];
  if (out.timeoutMin == null) out.timeoutMin = DEFAULT_TIMEOUT_BY_PROFILE[out.profile];
  out.workspace = path.resolve(out.workspace);
  return out;
}

// 本地时间 yyyy-MM-dd HH-mm-ss
function fmtTs(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// 角色排序：固定 arch/dev/uat 在前（关键路径），judge 等辅助角色随后
const ROLE_ORDER = ['arch', 'dev', 'uat'];
function sortedRoles(byRole) {
  return Object.keys(byRole).sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a), ib = ROLE_ORDER.indexOf(b);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.localeCompare(b);
  });
}

export function writeReport(outPath, ctx) {
  const { workspace, harness, report, metrics, startMs, endMs, profile, baselineCompare, passing, degraded, noBaseline } = ctx;
  const byRole = metrics.byRole || {};
  const roles = sortedRoles(byRole);
  const lines = [];

  lines.push('# 回归报告 — vote-app', '');
  lines.push(`- benchmark: ${profile}`);
  lines.push(`- workspace: ${workspace}`);
  lines.push(`- 开始时间: ${fmtTs(startMs)}`);
  lines.push(`- 结束时间: ${fmtTs(endMs)}`);
  lines.push('');
  lines.push('## 指标');
  lines.push('');

  lines.push(`- 回归是否通过：${passing && !degraded ? '是' : '否'}${degraded ? '（基线退化）' : ''}${harness.status !== 'pass' ? `（harness ${harness.status}）` : ''}`);
  lines.push(`  - story 通过数 ${metrics.stories.pass}/${metrics.stories.total || '?'}`);
  lines.push(`  - uat_report.md 是否生成: ${metrics.reportGenerated ? '是' : '否'}${report && !report.ok ? `（交叉验证不一致：${report.detail}）` : ''}`);
  lines.push('');

  lines.push(`- 总耗时: ${fmtDuration(metrics.execMs)}（仅 agent 执行，不含互等空转；从开始到完成经过时间 ${fmtDuration(metrics.durationMs)}）`);
  for (const r of roles) lines.push(`  - ${r}：${fmtDuration(byRole[r].execMs)}`);
  lines.push('');

  lines.push(`- token 估算: total ${metrics.tokens.total}（in ${metrics.tokens.input} / out ${metrics.tokens.output}）`);
  if (roles.length) {
    for (const r of roles) {
      const v = byRole[r];
      lines.push(`  - ${r}: ${v.total}（in ${v.input} / out ${v.output}）· ${v.sessions} 个 session`);
    }
  } else {
    lines.push('  - (无角色日志可统计)');
  }
  lines.push('');

  lines.push(`- 总 llm 请求数：${metrics.requests}`);
  for (const r of roles) lines.push(`  - ${r}：${byRole[r].requests}`);
  lines.push('');

  lines.push(`- Arch 派发的返工：${metrics.oneShot ? '无' : '有'}`);
  lines.push(`  - dev_fix ${metrics.devRework} 次`);
  lines.push(`  - uat_fix ${metrics.uatRework} 次`);
  lines.push('');

  const rp = metrics.repair || { total: 0, script: 0, product: 0 };
  lines.push(`- UAT 自修轮次: ${rp.total} 轮`);
  lines.push(`  - script_issue ${rp.script}`);
  lines.push(`  - product_issue ${rp.product}`);
  lines.push('');

  lines.push(`- 总 action 数: ${metrics.totalActions}`);
  lines.push(`  - 按任务类型: ${Object.entries(metrics.byAction).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ') || '(空)'}`);
  lines.push(`  - 按谁发送的: ${Object.entries(metrics.bySender || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ') || '(空)'}`);
  lines.push('');

  lines.push('## 基线对比');
  if (noBaseline) {
    lines.push('- （评测模式：本次未对比效率基线）');
  } else if (!baselineCompare) {
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
  // 必须在 initProject 之前设：daemon 入口解析、{ref} 目录、cli 下发源都读它
  if (opts.pkg) process.env.TEAM3_PKG_DIR = opts.pkg;

  // 回归目录 = workspace 父目录（默认 /tmp/t3-regress）。启动前新建或清空，
  // 再把 regress-run.log 开在其下；log() 同时输出到 stdout 与该文件。
  const regressDir = path.dirname(opts.workspace);
  prepareRegressDir(regressDir, opts);
  const logPath = path.join(regressDir, 'regress-run.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  const log = (m) => { process.stdout.write(m + '\n'); logStream.write(m + '\n'); };

  log(`=== 回归开始 ${startedAt} ===`);
  log(`profile=${opts.profile}`);
  log(`mode=${opts.pkg ? `打包产物（TEAM3_PKG_DIR=${opts.pkg}）` : '源码树'}`);
  log(`regressDir=${regressDir}（${opts.clean ? '已清空重建' : '保留'}）`);
  log(`workspace=${opts.workspace}`);
  log(`design=${opts.design}`);
  log(`log=${logPath}`);
  log(`timeout=${opts.timeoutMin}min\n`);

  // 1. 干净起点（regressDir 已在上面新建/清空，workspace 由 initWorkspace 重建）
  log(`[1/5] 回归目录就绪: ${regressDir}`);

  // 2. 初始化 + 启 daemon + kick arch
  log('[2/5] 初始化项目并启动 daemon');
  const proj = await initProject(opts.workspace, { designPath: opts.design, kick: opts.kick, brief: opts.brief });
  log(`  daemon PID ${proj.pid}, port ${proj.port}${proj.kicked ? '，已 kick arch' : '（未 kick）'}`);

  // 3. 启动 human-sim（常驻，后台）
  log('[3/5] 启动 human-sim');
  const sim = createHumanSim({ workspace: opts.workspace, superman: opts.superman, logger: (m) => log('  [human-sim] ' + m) });
  const simPromise = sim.start({ designPath: opts.design }).catch((e) => log('  [human-sim] 异常: ' + e.message));

  // 4. 轮询完成
  log('[4/5] 等待 harness 完成…');
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
  const completedMs = Date.now(); // agent 工作结束时刻，用作耗时口径的 endMs
  log(`  harness 状态: ${harness.status} — ${(harness.message || '').slice(0, 80)}`);

  sim.stop();
  await Promise.race([simPromise, new Promise((r) => setTimeout(r, 3000))]);

  // uat_report 交叉验证（harness 自评的报告与 story 是否一致）
  let report = null;
  if (harness.status === 'pass') {
    report = crossCheckReport(opts.workspace);
    log(`  uat_report 交叉验证: ${report.ok ? 'OK' : '不一致'}（${report.detail}）`);
  }

  // 5. 指标 + 报告
  // 收指标前先等 agent session 收尾：完成信号触发时 UAT 常仍在跑，其 token 尚未落盘，
  // 直接统计会漏掉 UAT（见 collectAgentStats 注释）。耗时口径用 completedMs，不含这段等待。
  if (harness.status === 'pass') {
    log('  等待 agent session 收尾以统计 token…');
    await waitForRoleSessionsEnd(opts.workspace, ['arch', 'dev', 'uat'], { log });
  }
  log('[5/5] 采集指标并写报告');
  const metrics = collectMetrics(opts.workspace, startMs, completedMs);
  const passing = harness.status === 'pass';

  // 效率基线：对比 + （首次 PASS 或 --update-baseline）建立/更新。
  // --no-baseline（评测编排器用）：完全不读/不写固定基线，避免污染手工基线。
  const baselinePath = BASELINE_BY_PROFILE[opts.profile];
  const baseline = opts.noBaseline ? null : readBaseline(baselinePath);
  let baselineCompare = null;
  if (opts.noBaseline) {
    log('  基线对比: 跳过（--no-baseline 评测模式，不读写固定基线）');
  } else if (baseline) {
    baselineCompare = compareToBaseline(baseline, metrics);
    for (const a of baselineCompare.alarms) log(`  [基线·强报警] ${a}`);
    for (const w of baselineCompare.warnings) log(`  [基线·提示] ${w}`);
    if (!baselineCompare.alarms.length && !baselineCompare.warnings.length) log('  基线对比: 无退化');
  } else {
    log('  基线对比: 尚无基线');
  }
  const degraded = !!(baselineCompare && baselineCompare.alarms.length);
  writeReport(opts.out, {
    workspace: opts.workspace, harness, report, metrics,
    startMs, endMs: completedMs, profile: opts.profile, baselineCompare, passing, degraded,
    noBaseline: opts.noBaseline,
  });
  if (!opts.noBaseline && passing && (!baseline || opts.updateBaseline)) {
    writeBaseline(baselinePath, opts.out);
    log(`  基线已${baseline ? '更新' : '建立'}: ${baselinePath}`);
  }
  log(`\n报告已写入: ${opts.out}`);
  log(`一次性完成=${metrics.oneShot ? '是' : '否'} 执行耗时=${fmtDuration(metrics.execMs)}（从开始到完成经过时间 ${fmtDuration(metrics.durationMs)}） token≈${metrics.tokens.total} llm 请求=${metrics.requests}`);

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
