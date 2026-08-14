// gen-badcase.mjs — 前后对比 → 抽出被测「退化的指标」→ 交给模型基于真实轨迹做根因分析
//
// 两步走（数字与推理分离，数字永远真实、不编造）：
//   1) 确定性抽取：对比基线/被测两份回归 md，按指标的相关方向判断被测哪些项退化了，
//      连同"重灾区角色"、返工差异、可用的轨迹证据清单，落成粗粒度 badcase-input.json
//      （只指方向，不追求精准）+ 一份分析 prompt（badcase-prompt.md）。
//   2) 模型分析：起一个一次性 qodercli 会话（qodercli -p），让模型读 badcase-input.json
//      和 evidence/ 里的真实轨迹，产出 badcase.md（结论+逐项归因+建议）。
//      若无法自动执行（缺 qodercli / 超时 / 报错），打印一条可手动运行的等价命令兜底。
//
// 用法：
//   node gen-badcase.mjs --baseline <baseline.md> --compare <compare.md> \
//        --evidence <evidenceRoot> --out-dir <workdir> [--analyze-cmd qodercli] [--no-run] [--timeout-min 30]
//
// 产物（均落在 --out-dir）：badcase-input.json、badcase-prompt.md、badcase.md（模型产出）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseReport, secToDur, fmtInt, ratio, METRICS } from './gen-report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------- 指标取值 ---------------------------- */

// 把一份 parseReport 结果映射成 METRICS 各项的可比数值 + 展示串
function metricValue(R, key) {
  switch (key) {
    case 'pass': return { num: R.pass ? 1 : 0, disp: R.pass ? '通过' : '未通过' };
    case 'story': return { num: R.storyTotal ? R.storyPass / R.storyTotal : 0, disp: `${R.storyPass}/${R.storyTotal}` };
    case 'token': return { num: R.token.total, disp: fmtInt(R.token.total) };
    case 'exec': return { num: R.exec.total, disp: secToDur(R.exec.total) };
    case 'requests': return { num: R.requests.total, disp: String(R.requests.total) };
    case 'actions': return { num: R.actions.total, disp: String(R.actions.total) };
    case 'rework': {
      const n = R.rework.devFix + R.rework.uatFix + R.repair.rounds;
      return { num: n, disp: `${n}（dev_fix ${R.rework.devFix} / uat_fix ${R.rework.uatFix} / UAT自修 ${R.repair.rounds}）` };
    }
    default: return { num: 0, disp: '—' };
  }
}

// 退化判定：正相关看是否变小、负相关看是否变大（留 3% 容差，避免噪声误报）
function isRegressed(corr, base, cmp) {
  if (base === cmp) return false;
  const tol = 0.03;
  if (corr === 'pos') return cmp < base * (1 - tol);
  return cmp > base * (1 + tol);
}

// 找某维度（exec/token/requests）被测相对基线增量最大的角色（重灾区线索）
function hotspotRole(B, C, dim) {
  const roles = ['arch', 'dev', 'uat', 'judge'];
  const get = (R, r) => dim === 'token'
    ? ((R.token.byRole[r] || {}).total || 0)
    : dim === 'exec' ? (R.exec.byRole[r] || 0) : (R.requests.byRole[r] || 0);
  let best = null;
  for (const r of roles) {
    const base = get(B, r), cmp = get(C, r), delta = cmp - base;
    if (best === null || delta > best.delta) best = { role: r, base, cmp, delta };
  }
  return best;
}

/* ---------------------------- 抽取 badcase-input ---------------------------- */

function buildInput(opts, B, C) {
  const metrics = METRICS.map((m) => {
    const b = metricValue(B, m.key), c = metricValue(C, m.key);
    return {
      key: m.key, name: m.name, corr: m.corr,
      baseline: b.disp, compare: c.disp,
      ratio: ratio(c.num, b.num),
      regressed: isRegressed(m.corr, b.num, c.num),
    };
  });
  const regressed = metrics.filter((m) => m.regressed);

  // 单一 evidence 目录，按文件名前缀 baseline./compare. 归类两模型的会话 zip
  const dir = opts.evidenceDir;
  const allZips = (dir && fs.existsSync(dir)) ? fs.readdirSync(dir).filter((f) => f.endsWith('.zip')) : [];

  return {
    generatedAt: new Date().toISOString(),
    note: '本文件由 gen-badcase.mjs 确定性抽取，仅提供粗粒度方向线索；根因分析由模型基于真实轨迹完成。',
    models: { baseline: opts.baselineLabel, compare: opts.compareLabel },
    metrics,
    regressedMetrics: regressed.map((m) => m.name),
    hotspots: {
      byToken: hotspotRole(B, C, 'token'),
      byExec: hotspotRole(B, C, 'exec'),
      byRequests: hotspotRole(B, C, 'requests'),
    },
    rework: {
      devFix: { baseline: B.rework.devFix, compare: C.rework.devFix },
      uatFix: { baseline: B.rework.uatFix, compare: C.rework.uatFix },
      uatRepairRounds: { baseline: B.repair.rounds, compare: C.repair.rounds },
      uatProductIssue: { baseline: B.repair.product, compare: C.repair.product },
    },
    evidence: {
      dir: dir || null,
      baseline: { zips: allZips.filter((f) => f.startsWith('baseline.')), workspace: opts.workspaceBaseline || null },
      compare: { zips: allZips.filter((f) => f.startsWith('compare.')), workspace: opts.workspaceCompare || null },
    },
  };
}

/* ---------------------------- 分析 prompt ---------------------------- */

function buildPrompt(opts, input) {
  const inputPath = path.join(opts.outDir, 'badcase-input.json');
  const badcasePath = path.join(opts.outDir, 'badcase.md');
  const regressed = input.regressedMetrics.length
    ? input.regressedMetrics.join('、')
    : '（无明显退化项——请对比两边过程，指出被测相对更弱的环节即可）';
  return `你是模型评测的 badcase 分析助手。请基于**真实执行轨迹**做根因分析，严禁编造数据。

## 背景
- 被测模型：${input.models.compare}
- 对照基线：${input.models.baseline}
- 评测任务：team3 多 Agent 自主开发 vote-app（arch/dev/uat/judge 协作），两个模型各独立跑一次。

## 已知线索（粗粒度，仅指方向）
- 结构化对比：\`${inputPath}\`（每个指标的基线/被测值、倍数、是否退化，及各维度"重灾区角色"）。
- 被测相对基线**退化的指标**：${regressed}

## 真实轨迹证据（据此分析，不要臆测）
- 轨迹目录：\`${input.evidence.dir || '（未提供）'}\`
  目录里是各角色 session 的 zip，用文件名前缀区分模型：\`baseline.*\`=基线、\`compare.*\`=被测。
  每个 zip 内含主 jsonl、段日志 logs/segments/*、以及 request-ids.jsonl 里的百炼 requestId。
  需要时把 zip 解压到临时目录再读，例如：unzip -o <zip> -d /tmp/bc_tmp/<name>。
- 被测项目目录（完整保留）：\`${input.evidence.compare.workspace || '（未提供）'}\`
- 基线项目目录（完整保留）：\`${input.evidence.baseline.workspace || '（未提供）'}\`
  这是两个模型各自跑完后保留的完整工程目录（生成的代码、spec/actions.jsonl 交互流水、logs/ 等），可直接进去对比看实际产物与过程。

## 你的任务
1. 读 badcase-input.json，锁定被测**明显退化**的指标和对应重灾区角色。只分析明显退化项：轻微波动（如某指标只多 5% 左右）属正常抖动，不必单列分析、直接跳过。
2. 针对每个明显退化项，进入被测轨迹里对应角色的 session，找出**具体证据**（例如：某轮反复读同一文件、卡在探针/重启诊断、无效往返、超长思考、请求空转等），并与基线同角色轨迹对照，说明差异。
3. 归纳根因：是模型能力问题、还是行为习惯（啰嗦/绕路/不收敛）问题。
4. 用大白话写成分析报告，**覆盖写入** \`${badcasePath}\`，结构如下：

# Badcase 分析：${input.models.compare} vs 基线

## 结论速览
（2-3 句话讲清：被测主要差在哪个指标、哪个角色，根因一句话概括。只给结论，不铺细节，细节留到逐项分析。）

## 现象分析
（只列明显退化的指标，轻微波动指标不列。结构如下：

\`\`\`
### 现象1：<一句话标题，点出问题本质>

<补充描述：把这个现象讲清楚，引用具体数字（谁退化、退化多少、拆解到哪个角色/环节）>

**证据**

1、<轨迹里的具体片段/文件/轮次，含数字>
2、……
3、……

**根因**

<是能力问题还是行为习惯，一段话讲透>
\`\`\`

注意：一个明显退化指标通常就是**一个现象**，不要硬拆成多个现象。只有确实存在多个互不相关的问题时，才追加「### 现象2：…」并各自带补充描述/证据/根因。）

只输出对文件的写入操作与必要说明，不要复述本提示词。不要写"改进建议"章节。`;
}

/* ---------------------------- 模型分析（best-effort） ---------------------------- */

function hasBinary(cmd) {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf-8' });
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}

function runAnalysis(opts, promptText, log) {
  const badcasePath = path.join(opts.outDir, 'badcase.md');
  const promptPath = path.join(opts.outDir, 'badcase-prompt.md');
  const manualCmd = `cd ${opts.outDir} && ${opts.analyzeCmd} --dangerously-skip-permissions -p "$(cat badcase-prompt.md)"`;

  if (opts.noRun) {
    log(`已生成分析输入与 prompt，未自动跑模型（--no-run）。手动分析请执行：\n    ${manualCmd}`);
    return { ran: false, badcasePath: null, manualCmd };
  }
  if (!hasBinary(opts.analyzeCmd)) {
    log(`未找到 ${opts.analyzeCmd}，跳过自动分析。可手动执行：\n    ${manualCmd}`);
    return { ran: false, badcasePath: null, manualCmd };
  }

  log(`起一次性 ${opts.analyzeCmd} 会话做 badcase 分析（超时 ${opts.timeoutMin} 分钟）…`);
  const r = spawnSync(opts.analyzeCmd, ['--dangerously-skip-permissions', '-p', promptText], {
    cwd: opts.outDir, encoding: 'utf-8', stdio: ['ignore', 'inherit', 'inherit'],
    timeout: opts.timeoutMin * 60 * 1000,
  });
  if (fs.existsSync(badcasePath) && fs.statSync(badcasePath).size > 0) {
    log(`✓ 模型已产出 badcase.md → ${badcasePath}`);
    return { ran: true, badcasePath, manualCmd };
  }
  log(`⚠ 模型未产出 badcase.md（exit=${r.status}${r.error ? `, ${r.error.message}` : ''}）。可手动执行：\n    ${manualCmd}`);
  return { ran: false, badcasePath: null, manualCmd };
}

/* ---------------------------- 入口 ---------------------------- */

export function genBadcase(opts) {
  const log = opts.log || (() => {});
  fs.mkdirSync(opts.outDir, { recursive: true });
  const B = parseReport(opts.baseline);
  const C = parseReport(opts.compare);

  const input = buildInput(opts, B, C);
  const inputPath = path.join(opts.outDir, 'badcase-input.json');
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2) + '\n', 'utf-8');
  log(`退化指标：${input.regressedMetrics.length ? input.regressedMetrics.join('、') : '无明显退化'}`);

  const promptText = buildPrompt(opts, input);
  fs.writeFileSync(path.join(opts.outDir, 'badcase-prompt.md'), promptText, 'utf-8');

  const res = runAnalysis(opts, promptText, log);
  return { inputPath, badcasePath: res.badcasePath, ran: res.ran, manualCmd: res.manualCmd, input };
}

function parseArgs(argv) {
  const out = {
    baseline: null, compare: null,
    evidenceDir: null,
    workspaceBaseline: null, workspaceCompare: null,
    outDir: '/tmp/t3-eval/badcase',
    analyzeCmd: 'qodercli',
    baselineLabel: '基线', compareLabel: '被测',
    noRun: false, timeoutMin: 30,
  };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i]; const v = a[i + 1];
    if (k === '--baseline' && v) out.baseline = (i++, v);
    else if (k === '--compare' && v) out.compare = (i++, v);
    else if (k === '--evidence-dir' && v) out.evidenceDir = (i++, v);
    else if (k === '--workspace-baseline' && v) out.workspaceBaseline = (i++, v);
    else if (k === '--workspace-compare' && v) out.workspaceCompare = (i++, v);
    else if (k === '--out-dir' && v) out.outDir = (i++, v);
    else if (k === '--analyze-cmd' && v) out.analyzeCmd = (i++, v);
    else if (k === '--baseline-label' && v) out.baselineLabel = (i++, v);
    else if (k === '--compare-label' && v) out.compareLabel = (i++, v);
    else if (k === '--timeout-min' && v) out.timeoutMin = (i++, Number(v) || 30);
    else if (k === '--no-run') out.noRun = true;
  }
  return out;
}

if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  const opts = parseArgs(process.argv);
  for (const f of [opts.baseline, opts.compare]) {
    if (!f || !fs.existsSync(f)) { console.error(`找不到 md 文件：${f}`); process.exit(1); }
  }
  opts.log = (m) => process.stdout.write(`[badcase] ${m}\n`);
  const res = genBadcase(opts);
  console.log(`[badcase] 输入：${res.inputPath}`);
  console.log(`[badcase] badcase.md：${res.badcasePath || '（未生成，见上方手动命令）'}`);
}
