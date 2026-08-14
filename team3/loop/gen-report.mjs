// gen-report.mjs — 读两份回归 md（基线 + 被测），生成对比评测报告 regress.full.html
//
// 用途：把 run-regression 产出的两份同格式 md（基线模型一份、被测模型一份）解析成
// 结构化指标，套模板渲染成可视化 HTML（条形对比 + 角色拆分 + 协作 + 返工 + 模型评价）。
// 不依赖 csv，不编造数据：所有数字都来自传入的两份 md。
//
// 用法：
//   node gen-report.mjs --baseline <baseline.full.md> --compare <regress.full.md> --out <regress.full.html>
//        [--baseline-label "qodercli Performance（猜测 GPT-5.5）"]
//        [--compare-label  "Qwen-latest-series-invite-beta-v118"]
//        [--baseline-short "基线"] [--compare-short "被测"]
//        [--benchmark "t3-vote-app（full · 类腾讯问卷产品自主开发）"]
//        [--badcase <badcase.md>]  // 有则嵌入「Badcase 深度分析」一节（模型产出）
//
// 默认读 loop/vote-app 下的 baseline.full.md / regress.full.md，写同目录 regress.full.html。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOTE_DIR = path.join(__dirname, 'vote-app');

const ROLES = ['arch', 'dev', 'uat', 'judge'];
const ROLE_LABEL = { arch: 'arch 架构', dev: 'dev 开发', uat: 'uat 验收', judge: 'judge 裁判' };

// CLI 二进制 → 它自己的 settings.json（模型名的真源）。
// qodercli(国际版) 读 ~/.qoder，qoderclicn(国内版) 读 ~/.qoder-cn。
const CLI_SETTINGS = {
  qodercli: path.join(os.homedir(), '.qoder', 'settings.json'),
  qoderclicn: path.join(os.homedir(), '.qoder-cn', 'settings.json'),
};
// 从某 CLI 的 settings.json 取 model.name（如 "bailian/pg/qwen-latest-series-invite-beta-v118"）
function resolveModelName(cmd) {
  try {
    const p = CLI_SETTINGS[cmd];
    if (!p || !fs.existsSync(p)) return null;
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return (d && d.model && d.model.name) || null;
  } catch { return null; }
}

// profile → 实际使用的设计文件路径（Benchmark 行展示用）
const DESIGN_BY_PROFILE = {
  min: 'loop/vote-app/app_design.min.md',
  full: 'loop/vote-app/app_design.md',
};

// 指标含义 + 相关方向（正相关=越大越好；负相关=越小越好）。
// 这是「评测方法与指标含义」一节的数据源，也是判断被测哪项退化的方向依据。
const METRICS = [
  { key: 'pass', name: '任务完成率', corr: 'pos', desc: '产品是否被自主开发并通过验收，衡量「能不能做成」。' },
  { key: 'story', name: 'Story 一次性通过', corr: 'pos', desc: '验收 story 全部通过、uat_report 正常生成，衡量交付完整度。' },
  { key: 'token', name: 'Token 消耗', corr: 'neg', desc: '完成任务累计消耗的 token，直接对应算力成本。' },
  { key: 'exec', name: '任务耗时', corr: 'neg', desc: '各 Agent 实际执行的总时长，衡量效率。' },
  { key: 'requests', name: 'LLM 请求数', corr: 'neg', desc: '完成任务发起的大模型请求总数，衡量过程绕不绕。' },
  { key: 'actions', name: 'Agent 交互次数', corr: 'neg', desc: '多 Agent 之间派发/汇报的动作总数，衡量协作是否冗长。' },
  { key: 'rework', name: '返工次数', corr: 'neg', desc: '被架构打回重做 + 验收阶段自修，衡量「一次做对」的能力。' },
];
const CORR_LABEL = { pos: '正相关（越高越好）', neg: '负相关（越低越好）' };

/* ---------------------------- 参数解析 ---------------------------- */

function parseArgs(argv) {
  const out = {
    baseline: path.join(VOTE_DIR, 'baseline.full.md'),
    compare: path.join(VOTE_DIR, 'regress.full.md'),
    out: path.join(VOTE_DIR, 'regress.full.html'),
    baselineCmd: 'qodercli',
    compareCmd: 'qoderclicn',
    baselineLabel: null, // 缺省 → 从对应 CLI 的 settings.json 自动取 model.name
    compareLabel: null,
    baselineShort: '基线',
    compareShort: '被测',
    benchmark: null, // 缺省 → 按被测 md 的 profile 显示设计文件路径
    badcase: null,   // badcase.md 路径（模型产出）；有则嵌入「Badcase 深度分析」一节
    title: 'Qwen 模型上线前评测 · team3 多 Agent 协作 Benchmark',
  };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const v = a[i + 1];
    if (k === '--baseline' && v) out.baseline = (i++, v);
    else if (k === '--compare' && v) out.compare = (i++, v);
    else if (k === '--out' && v) out.out = (i++, v);
    else if (k === '--baseline-cmd' && v) out.baselineCmd = (i++, v);
    else if (k === '--compare-cmd' && v) out.compareCmd = (i++, v);
    else if (k === '--baseline-label' && v) out.baselineLabel = (i++, v);
    else if (k === '--compare-label' && v) out.compareLabel = (i++, v);
    else if (k === '--baseline-short' && v) out.baselineShort = (i++, v);
    else if (k === '--compare-short' && v) out.compareShort = (i++, v);
    else if (k === '--benchmark' && v) out.benchmark = (i++, v);
    else if (k === '--badcase' && v) out.badcase = (i++, v);
    else if (k === '--title' && v) out.title = (i++, v);
  }
  // label 未显式给出时，从对应 CLI 的 settings.json 取真实 model.name，取不到再退回命令名
  out.baselineLabel = out.baselineLabel || resolveModelName(out.baselineCmd) || out.baselineCmd;
  out.compareLabel = out.compareLabel || resolveModelName(out.compareCmd) || out.compareCmd;
  return out;
}

/* ---------------------------- md 解析 ---------------------------- */

// "349m 31s" → 秒
function durToSec(s) {
  const m = /(\d+)m\s*(\d+)s/.exec(s || '');
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const only = /(\d+)m/.exec(s || '');
  return only ? Number(only[1]) * 60 : 0;
}
function secToDur(sec) {
  const m = Math.floor(sec / 60);
  return `${m}m ${sec % 60}s`;
}
function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// 解析一份回归/基线 md → 结构化指标
function parseReport(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf-8');
  const pick = (re) => { const m = re.exec(text); return m ? m[1].trim() : null; };

  // 顶部元信息
  const start = pick(/^- 开始时间[：:]\s*(.+)$/m);
  const end = pick(/^- 结束时间[：:]\s*(.+)$/m);
  const benchmark = pick(/^- benchmark[：:]\s*(.+)$/m);

  // 通过情况
  const pass = /- 回归是否通过[：:]\s*是/.test(text);
  const storyLine = pick(/story 通过数\s*(\d+\s*\/\s*\d+)/m) || '0/0';
  const [storyPass, storyTotal] = storyLine.split('/').map((x) => Number(x.trim()));
  const reportGenerated = /uat_report\.md 是否生成[：:]\s*是/.test(text);

  // 分角色小节解析：从某个 section 标题行往下，读缩进的 "  - role..." 行
  function roleBlock(headRe, lineParser) {
    const lines = text.split('\n');
    const res = {};
    let inBlock = false;
    for (const raw of lines) {
      if (headRe.test(raw)) { inBlock = true; continue; }
      if (inBlock) {
        if (/^\s+-/.test(raw)) {
          const parsed = lineParser(raw);
          if (parsed) res[parsed.role] = parsed.val;
          continue;
        }
        if (raw.trim() === '') continue; // 允许块内空行
        break; // 遇到下一个顶格条目，块结束
      }
    }
    return res;
  }

  // 总耗时
  const execTotalSec = durToSec(pick(/^- 总耗时[：:]\s*([\dms\s]+)/m));
  const execByRole = roleBlock(/^- 总耗时[：:]/, (raw) => {
    const m = /^\s*-\s*(\w+)[：:]\s*(.+)$/.exec(raw);
    return m ? { role: m[1], val: durToSec(m[2]) } : null;
  });

  // token
  const tokenTotal = Number(pick(/^- token 估算[：:]\s*total\s*(\d+)/m) || 0);
  const tokIn = Number(pick(/^- token 估算[：:].*in\s*(\d+)\s*\//m) || 0);
  const tokOut = Number(pick(/^- token 估算[：:].*out\s*(\d+)/m) || 0);
  const tokenByRole = roleBlock(/^- token 估算[：:]/, (raw) => {
    const m = /^\s*-\s*(\w+)[：:]\s*(\d+)（in\s*(\d+)\s*\/\s*out\s*(\d+)）(?:\s*·\s*(\d+)\s*个?\s*session)?/.exec(raw);
    if (!m) return null;
    return { role: m[1], val: { total: Number(m[2]), in: Number(m[3]), out: Number(m[4]), sessions: Number(m[5] || 0) } };
  });

  // llm 请求
  const requestsTotal = Number(pick(/^- 总 llm 请求数[：:]\s*(\d+)/m) || 0);
  const requestsByRole = roleBlock(/^- 总 llm 请求数[：:]/, (raw) => {
    const m = /^\s*-\s*(\w+)[：:]\s*(\d+)/.exec(raw);
    return m ? { role: m[1], val: Number(m[2]) } : null;
  });

  // 返工
  const devFix = Number(pick(/^\s*-\s*dev_fix\s*(\d+)\s*次/m) || 0);
  const uatFix = Number(pick(/^\s*-\s*uat_fix\s*(\d+)\s*次/m) || 0);

  // UAT 自修
  const repairRounds = Number(pick(/^- UAT 自修轮次[：:]\s*(\d+)\s*轮/m) || 0);
  const repairScript = Number(pick(/^\s*-\s*script_issue\s*(\d+)/m) || 0);
  const repairProduct = Number(pick(/^\s*-\s*product_issue\s*(\d+)/m) || 0);

  // action
  const actionsTotal = Number(pick(/^- 总 action 数[：:]\s*(\d+)/m) || 0);
  const parseKvList = (line) => {
    const out = {};
    if (!line) return out;
    for (const part of line.split(/[,，]/)) {
      const m = /(\S+?)\s*=\s*(\d+)/.exec(part.trim());
      if (m) out[m[1]] = Number(m[2]);
    }
    return out;
  };
  const byType = parseKvList(pick(/^\s*-\s*按任务类型[：:]\s*(.+)$/m));
  const bySender = parseKvList(pick(/^\s*-\s*按谁发送的[：:]\s*(.+)$/m));

  return {
    start, end, benchmark, pass, storyPass, storyTotal, reportGenerated,
    exec: { total: execTotalSec, byRole: execByRole },
    token: { total: tokenTotal, in: tokIn, out: tokOut, byRole: tokenByRole },
    requests: { total: requestsTotal, byRole: requestsByRole },
    rework: { devFix, uatFix },
    repair: { rounds: repairRounds, script: repairScript, product: repairProduct },
    actions: { total: actionsTotal, byType, bySender },
  };
}

/* ---------------------------- 渲染辅助 ---------------------------- */

// 读对应 profile 的设计文档，抽出「验收要点」：API 端点(### 标题) + 编号行为/校验步骤。
// 设计文档常驻仓库、不依赖易失的运行工作区，是报告「验收规模」最可靠的数据源。
function parseBenchmarkSpec(profile) {
  const p = path.join(VOTE_DIR, `app_design.${profile}.md`);
  if (!fs.existsSync(p)) return { endpoints: [], checkpoints: [] };
  const text = fs.readFileSync(p, 'utf-8');
  const endpoints = [...text.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim());
  const checkpoints = [...text.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((m) => m[1].trim());
  return { endpoints, checkpoints };
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 行内 Markdown：`code` → <code>，**bold** → <b>。先转义再替换，安全。
const inlineMd = (t) => esc(t)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`([^`]+?)`/g, '<code>$1</code>');

// 极简 Markdown→HTML：仅覆盖模型产出 badcase.md 常见语法（标题/列表/加粗/代码/段落）。
// 不追求完备，够把一份分析性 md 渲染得清爽即可。
function mdLite(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
  const html = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { html.push('</ul>'); listOpen = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      closeList();
      const lvl = Math.min(m[1].length + 2, 6); // # → h3, ## → h4, ### → h5, #### → h6
      html.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      if (!listOpen) { html.push('<ul>'); listOpen = true; }
      html.push(`<li>${inline(m[1])}</li>`);
    } else if (/^\s*[-=]{3,}\s*$/.test(line)) {
      closeList(); html.push('<hr>');
    } else {
      closeList(); html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join('\n');
}
const pct = (val, max) => (max > 0 ? Math.max(2, Math.round((val / max) * 1000) / 10) : 0);
function ratio(cmp, base) {
  if (!base) return null;
  return Math.round((cmp / base) * 10) / 10;
}
// 规范化时间显示：把 "2026-08-03 20-05-41" 的时间部分连字符转冒号
function normTime(s) {
  if (!s) return '';
  return s.replace(/(\d{2})-(\d{2})-(\d{2})$/, '$1:$2:$3');
}

// 一行对比条：compare 在上（珊瑚），baseline 在下（灰）；lowerBetter 决定 compare 值配色
function cmpRow(metricLabel, sub, cmpVal, baseVal, cmpDisp, baseDisp, opt = {}) {
  const max = Math.max(cmpVal, baseVal) || 1;
  const tie = cmpVal === baseVal;
  const worse = opt.lowerBetter ? cmpVal > baseVal : cmpVal < baseVal;
  const cmpCls = tie ? 'tie' : (worse ? 'hi' : 'lo');
  return `
    <div class="cmp-row">
      <div class="cmp-metric">${esc(metricLabel)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <div class="cmp-bars">
        <div class="bar-line"><span class="bar-name">${esc(opt.cmpShort)}</span><div class="bar-track"><div class="bar-fill v118" style="width:${pct(cmpVal, max)}%"></div></div><span class="bar-val ${cmpCls}">${esc(cmpDisp)}</span></div>
        <div class="bar-line"><span class="bar-name">${esc(opt.baseShort)}</span><div class="bar-track"><div class="bar-fill base" style="width:${pct(baseVal, max)}%"></div></div><span class="bar-val">${esc(baseDisp)}</span></div>
      </div>
    </div>`;
}

/* ---------------------------- 模型评价（数据驱动） ---------------------------- */

function buildVerdict(C, B) {
  const rTok = ratio(C.token.total, B.token.total);
  const rExec = ratio(C.exec.total, B.exec.total);
  const rReq = ratio(C.requests.total, B.requests.total);
  const good = [];
  const bad = [];

  // 结果 / 交付
  if (C.pass && B.pass) good.push(['结果达标。', `任务完成率 100%，和基线打平，没有因为提速或省事而牺牲最终交付。`]);
  else if (C.pass) good.push(['结果达标。', `任务完成率 100%，成功交付。`]);
  else bad.push(['未通过。', `本次回归未通过，交付不完整。`]);

  if (C.storyTotal > 0 && C.storyPass >= C.storyTotal && C.reportGenerated) {
    good.push(['交付完整。', `${C.storyPass}/${C.storyTotal} story 全部通过，uat_report 正常生成，验收链路走完整、没漏环节。`]);
  }

  // 开发主路径（返工）
  if (C.rework.devFix < B.rework.devFix) {
    good.push(['开发主路径稳。', `dev 环节零返工，而基线被架构打回重做过 ${B.rework.devFix} 次 —— 说明它一次就把开发方向走对了。`]);
  } else if (C.rework.devFix > B.rework.devFix) {
    bad.push(['开发反复。', `dev 被架构打回 ${C.rework.devFix} 次（基线 ${B.rework.devFix} 次），开发方向不够稳。`]);
  }

  // 成本 / 耗时 / 往返
  const costLine = (r, betterWord, worseWord, unit) => (r >= 1.1 ? worseWord : (r <= 0.9 ? betterWord : null));
  if (rTok != null) {
    if (rTok >= 1.1) bad.push(['太费。', `Token 消耗是基线的约 ${rTok}×（${fmtInt(C.token.total)} vs ${fmtInt(B.token.total)}），同样的活烧了更多钱。`]);
    else if (rTok <= 0.9) good.push(['更省。', `Token 消耗仅基线的约 ${rTok}×（${fmtInt(C.token.total)} vs ${fmtInt(B.token.total)}），更省。`]);
  }
  if (rExec != null) {
    if (rExec >= 1.1) bad.push(['太慢。', `总耗时约 ${rExec}×（${secToDur(C.exec.total)} vs ${secToDur(B.exec.total)}），瓶颈集中在写代码的 dev 阶段。`]);
    else if (rExec <= 0.9) good.push(['更快。', `总耗时仅基线的约 ${rExec}×（${secToDur(C.exec.total)} vs ${secToDur(B.exec.total)}），更快完成。`]);
  }
  if (rReq != null && (rReq >= 1.1 || C.repair.product > 0)) {
    let s = `LLM 请求约 ${rReq}×、Agent 交互 ${C.actions.total} vs ${B.actions.total}`;
    if (C.repair.product > 0) s += `，且问题拖到验收才暴露、多返修 ${C.repair.product} 轮`;
    bad.push(['太绕。', `${s} —— 过程冗长、往返偏多。`]);
  }

  return { good: good.slice(0, 3), bad: bad.slice(0, 3), rTok, rExec, rReq };
}

/* ---------------------------- 主渲染 ---------------------------- */

function render(opts, B, C) {
  const v = buildVerdict(C, B);
  const window = C.start && C.end ? `${normTime(C.start)} → ${normTime(C.end)}` : '—';
  const benchmark = opts.benchmark || DESIGN_BY_PROFILE[C.benchmark] || C.benchmark || '—';

  // Badcase：模型基于真实轨迹产出的 md（可选，有则嵌入）
  let badcaseHtml = '';
  if (opts.badcase && fs.existsSync(opts.badcase)) {
    badcaseHtml = mdLite(fs.readFileSync(opts.badcase, 'utf-8'));
  }
  // 指标含义表（正/负相关）
  const metricRows = METRICS.map((m) =>
    `<tr><td class="metric">${esc(m.name)}</td><td><span class="corr ${m.corr}">${esc(CORR_LABEL[m.corr])}</span></td><td class="desc">${esc(m.desc)}</td></tr>`).join('');
  const storyScale = C.storyTotal || B.storyTotal || 0;
  // 验收要点：从设计文档抽端点 + 编号行为/校验，避免「1 条 story」显得过简
  const spec = parseBenchmarkSpec(C.benchmark || 'full');
  const cpItems = spec.checkpoints.map((c) => `<li>${inlineMd(c)}</li>`).join('');
  const epText = spec.endpoints.map((e) => inlineMd(e)).join('、');

  // 总览条形（成本类 lowerBetter）
  const overview = [
    cmpRow('结果准确率', '任务完成率', C.pass ? 100 : 0, B.pass ? 100 : 0, C.pass ? '100%' : '未通过', B.pass ? '100%' : '未通过', { lowerBetter: false, cmpShort: opts.compareShort, baseShort: opts.baselineShort }),
    cmpRow('Tokens 消耗', '', C.token.total, B.token.total, fmtInt(C.token.total), fmtInt(B.token.total), { lowerBetter: true, cmpShort: opts.compareShort, baseShort: opts.baselineShort }),
    cmpRow('任务耗时', '仅 agent 执行', C.exec.total, B.exec.total, secToDur(C.exec.total), secToDur(B.exec.total), { lowerBetter: true, cmpShort: opts.compareShort, baseShort: opts.baselineShort }),
    cmpRow('总 LLM 请求数', '', C.requests.total, B.requests.total, fmtInt(C.requests.total), fmtInt(B.requests.total), { lowerBetter: true, cmpShort: opts.compareShort, baseShort: opts.baselineShort }),
    cmpRow('Agent 交互次数', '总 action 数', C.actions.total, B.actions.total, String(C.actions.total), String(B.actions.total), { lowerBetter: true, cmpShort: opts.compareShort, baseShort: opts.baselineShort }),
  ].join('');

  const ratios = [
    v.rTok != null ? { n: `≈${v.rTok}×`, t: 'Token 消耗 vs 基线' } : null,
    v.rExec != null ? { n: `≈${v.rExec}×`, t: '任务耗时 vs 基线' } : null,
    v.rReq != null ? { n: `≈${v.rReq}×`, t: 'LLM 请求数 vs 基线' } : null,
  ].filter(Boolean).map((r) => `<div class="ratio"><div class="n">${r.n}</div><div class="t">${r.t}</div></div>`).join('');

  // 资源开销表（按角色，两模型并列）
  const resRows = ROLES.map((r) => {
    const cE = C.exec.byRole[r] || 0, bE = B.exec.byRole[r] || 0;
    const cT = (C.token.byRole[r] || {}).total || 0, bT = (B.token.byRole[r] || {}).total || 0;
    const cR = C.requests.byRole[r] || 0, bR = B.requests.byRole[r] || 0;
    const hl = r === 'dev' ? ' class="hl"' : '';
    return `<tr${hl}><td class="metric">${ROLE_LABEL[r]}</td><td class="num">${secToDur(cE)}</td><td class="num">${secToDur(bE)}</td><td class="num">${fmtInt(cT)}</td><td class="num">${fmtInt(bT)}</td><td class="num">${cR}</td><td class="num">${bR}</td></tr>`;
  }).join('');
  const totalRow = `<tr class="total"><td class="metric">合计</td><td class="num">${secToDur(C.exec.total)}</td><td class="num">${secToDur(B.exec.total)}</td><td class="num">${fmtInt(C.token.total)}</td><td class="num">${fmtInt(B.token.total)}</td><td class="num">${C.requests.total}</td><td class="num">${B.requests.total}</td></tr>`;

  // dev 占比（被测）
  const devShareExec = C.exec.total ? Math.round((C.exec.byRole.dev || 0) / C.exec.total * 100) : 0;
  const devShareTok = C.token.total ? Math.round(((C.token.byRole.dev || {}).total || 0) / C.token.total * 100) : 0;
  const devShareReq = C.requests.total ? Math.round((C.requests.byRole.dev || 0) / C.requests.total * 100) : 0;

  // action 表
  const actTypeKeys = [...new Set([...Object.keys(C.actions.byType), ...Object.keys(B.actions.byType)])];
  const actTypeRows = actTypeKeys.map((k) => {
    const cv = C.actions.byType[k] || 0, bv = B.actions.byType[k] || 0;
    const hl = (k === 'note' && cv !== bv) ? ' class="hl"' : '';
    return `<tr${hl}><td>${esc(k)}</td><td class="num">${cv}</td><td class="num">${bv}</td></tr>`;
  }).join('');
  const senderKeys = [...new Set([...Object.keys(C.actions.bySender), ...Object.keys(B.actions.bySender)])];
  const senderRows = senderKeys.map((k) => `<tr><td>${esc(k)}</td><td class="num">${C.actions.bySender[k] || 0}</td><td class="num">${B.actions.bySender[k] || 0}</td></tr>`).join('');

  const goodLis = v.good.map(([h, t]) => `<li><b>${esc(h)}</b>${esc(t)}</li>`).join('');
  const badLis = v.bad.map(([h, t]) => `<li><b>${esc(h)}</b>${esc(t)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>vote-app 评测报告</title>
<style>
  :root{
    --bg:#faf9f7; --card:#ffffff; --ink:#1b1d21; --ink2:#42454b;
    --muted:#8f9096; --line:#eae7e2; --line2:#f1efeb;
    --accent:#ff4e2e; --accent-soft:#fff2ee; --accent-ink:#e0653f;
    --bar-v:#ffb59e; --bar-b:#d3d7de; --track:#f3f1ed;
    --good:#2fa079; --good-soft:#eaf6f1; --good-ink:#1f8562;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:"Inter",-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    line-height:1.6;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1000px;margin:0 auto;padding:64px 24px 80px;}
  .hero{text-align:center;margin-bottom:30px;}
  .hero h1{font-size:56px;font-weight:800;letter-spacing:-1.5px;margin:0 0 18px;line-height:1.05;}
  .hero h1 .accent{color:var(--accent);}
  .hero .tagline{font-size:22px;font-weight:700;color:var(--ink);margin:0 auto 10px;max-width:720px;letter-spacing:-.3px;}
  .hero .sub{font-size:15px;color:var(--muted);margin:0;}
  .meta-quote{border-left:3px solid var(--line);padding:4px 0 4px 20px;margin:0 0 46px;color:var(--muted);font-size:13.5px;}
  .meta-quote div{padding:3px 0;} .meta-quote b{color:var(--ink2);font-weight:600;}
  section{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:30px 34px;margin-top:22px;}
  .sec-head{display:flex;align-items:baseline;gap:12px;margin-bottom:6px;flex-wrap:wrap;}
  h2{font-size:22px;font-weight:800;letter-spacing:-.4px;margin:0;}
  .sec-tag{font-size:12px;font-weight:600;color:var(--accent);background:var(--accent-soft);padding:3px 10px;border-radius:20px;}
  .hint{color:var(--muted);font-size:13.5px;margin:8px 0 22px;}
  .legend{display:flex;gap:18px;margin:0 0 6px;font-size:12px;color:var(--muted);}
  .legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px;}
  .legend .d1{background:var(--bar-v);} .legend .d2{background:var(--bar-b);}
  .cmp-row{display:grid;grid-template-columns:180px 1fr;gap:20px;align-items:center;padding:15px 4px;border-bottom:1px solid var(--line2);}
  .cmp-row:last-child{border-bottom:none;}
  .cmp-metric{font-size:14px;font-weight:700;color:var(--ink2);}
  .cmp-metric small{display:block;font-weight:500;color:var(--muted);font-size:12px;}
  .cmp-bars{display:flex;flex-direction:column;gap:8px;}
  .bar-line{display:grid;grid-template-columns:52px 1fr 130px;gap:12px;align-items:center;}
  .bar-name{font-size:11.5px;font-weight:600;color:var(--muted);text-align:right;}
  .bar-track{background:var(--track);border-radius:8px;height:18px;overflow:hidden;}
  .bar-fill{height:100%;border-radius:8px;}
  .bar-fill.v118{background:var(--bar-v);} .bar-fill.base{background:var(--bar-b);}
  .bar-val{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;}
  .bar-val.hi{color:var(--accent-ink);} .bar-val.lo{color:var(--good-ink);} .bar-val.tie{color:var(--muted);}
  .ratio-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px;}
  .ratio{flex:1;min-width:150px;background:var(--accent-soft);border-radius:12px;padding:14px 16px;}
  .ratio .n{font-size:24px;font-weight:800;color:var(--accent);letter-spacing:-.5px;}
  .ratio .t{font-size:12.5px;color:var(--ink2);margin-top:2px;}
  .frame-q{background:#f6f4f0;border-radius:14px;padding:16px 20px;font-size:15px;font-weight:700;color:var(--ink);text-align:center;}
  .frame-arrow{text-align:center;color:var(--muted);font-size:13px;margin:14px 0;font-weight:600;}
  .lenses{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
  @media(max-width:760px){.lenses{grid-template-columns:1fr;}}
  .lens{border:1px solid var(--line);border-radius:16px;padding:20px 18px;}
  .lens .idx{font-size:12px;font-weight:800;color:var(--accent);letter-spacing:1px;}
  .lens h4{margin:8px 0 6px;font-size:16px;font-weight:800;}
  .lens p{margin:0;font-size:13px;color:var(--ink2);}
  table{width:100%;border-collapse:collapse;font-size:13.5px;}
  th,td{padding:11px 14px;text-align:left;border-bottom:1px solid var(--line2);}
  thead th{background:#f6f4f0;color:var(--ink);font-weight:700;font-size:12px;}
  thead th:first-child{border-top-left-radius:12px;} thead th:last-child{border-top-right-radius:12px;}
  td.metric{font-weight:700;color:var(--ink2);}
  td.num,th.num{font-variant-numeric:tabular-nums;text-align:right;}
  tr.hl td{background:var(--accent-soft);}
  tr.total td{font-weight:700;border-top:2px solid var(--line);}
  .colgrp{color:var(--accent-ink);} .colgrp.b{color:var(--muted);}
  td.desc{color:var(--ink2);font-size:13px;}
  td.desc ul{margin:8px 0 2px;padding-left:20px;} td.desc li{margin:4px 0;}
  td.desc code,.badcase code{background:#f3f1ed;border-radius:5px;padding:1px 6px;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
  .corr{display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:20px;white-space:nowrap;}
  .corr.pos{color:var(--good-ink);background:var(--good-soft);}
  .corr.neg{color:var(--accent-ink);background:var(--accent-soft);}
  .badcase{font-size:14px;color:var(--ink2);}
  .badcase h3{font-size:17px;font-weight:800;color:var(--ink);margin:22px 0 8px;}
  .badcase h4{font-size:15px;font-weight:800;color:var(--ink);margin:18px 0 6px;}
  .badcase h5{font-size:13.5px;font-weight:700;color:var(--ink2);margin:14px 0 4px;}
  .badcase h6{font-size:13px;font-weight:700;color:var(--ink);margin:12px 0 4px;}
  .badcase p{margin:8px 0;} .badcase b{color:var(--ink);}
  .badcase ul{margin:8px 0 8px;padding-left:22px;} .badcase li{margin:4px 0;}
  .badcase hr{border:none;border-top:1px solid var(--line);margin:20px 0;}
  .badcase>h3:first-child,.badcase>h4:first-child{margin-top:0;}
  .cols-2{display:grid;grid-template-columns:1fr 1fr;gap:22px;}
  @media(max-width:760px){.cols-2{grid-template-columns:1fr;}}
  .note{background:#faf7f3;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:10px;padding:13px 16px;margin-top:18px;font-size:13.5px;color:var(--ink2);}
  .note b{color:var(--accent-ink);}
  .verdict-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:4px;}
  @media(max-width:760px){.verdict-grid{grid-template-columns:1fr;}}
  .vcard{border:1px solid var(--line);border-radius:16px;padding:22px 22px 8px;}
  .vcard.good{background:var(--good-soft);border-color:#d5ebe1;}
  .vcard.bad{background:var(--accent-soft);border-color:#f7ddd4;}
  .vcard h3{margin:0 0 14px;font-size:16px;font-weight:800;}
  .vcard.good h3{color:var(--good-ink);} .vcard.bad h3{color:var(--accent-ink);}
  .vlist{list-style:none;counter-reset:v;padding:0;margin:0;}
  .vlist li{counter-increment:v;position:relative;padding:0 0 16px 34px;font-size:14px;color:var(--ink2);}
  .vlist li::before{content:counter(v);position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;font-size:12px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;}
  .vcard.good .vlist li::before{background:var(--good);}
  .vcard.bad .vlist li::before{background:var(--accent);}
  .vlist li b{color:var(--ink);}
  .lead{font-size:16px;font-weight:800;color:var(--ink);margin:2px 0 20px;}
  footer{color:var(--muted);font-size:12px;text-align:center;margin-top:34px;}
</style>
</head>
<body>
<div class="wrap">

  <div class="hero">
    <h1>vote-app <span class="accent">评测报告</span></h1>
    <p class="tagline">${esc(opts.title)}</p>
    <p class="sub">被测模型与基线的一次自主开发全流程对比</p>
  </div>

  <blockquote class="meta-quote">
    <div><b>评测窗口</b>　${esc(window)}</div>
    <div><b>Benchmark</b>　${esc(benchmark)}</div>
    <div><b>被测模型</b>　${esc(opts.compareLabel)}</div>
    <div><b>对照基线</b>　${esc(opts.baselineLabel)}</div>
  </blockquote>

  <section>
    <div class="sec-head"><h2>评测基准介绍</h2><span class="sec-tag">Benchmark</span></div>
    <p class="hint">本评测不是"图片分类"式的大样本打分集，而是一个<b>任务型自主开发基准</b>：给定一份产品设计文档，让 team3 的多 Agent（arch 架构 / dev 开发 / uat 验收 / judge 裁判 + 模拟真人）从零协作，把产品实际写出来并跑通验收。衡量的是"模型驱动一个真实软件项目端到端落地"的综合能力。</p>
    <table>
      <thead><tr><th>项</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td class="metric">任务命题</td><td class="desc">vote-app —— 类问卷/投票产品的自主开发（Next.js 全栈）</td></tr>
        <tr><td class="metric">设计文档</td><td class="desc"><code>${esc(benchmark)}</code></td></tr>
        <tr><td class="metric">验收规模</td><td class="desc">${storyScale > 0 ? `${storyScale} 个 story${spec.checkpoints.length ? `、${spec.checkpoints.length} 个场景` : ''}，须全部通过并生成 uat_report` : '以设计文档拆解出的验收 story 全通过为准'}</td></tr>
        <tr><td class="metric">评测方式</td><td class="desc">同一 Benchmark，基线模型与被测模型各自独立自主跑一次，全程真实执行、不干预</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <div class="sec-head"><h2>评测方法与指标含义</h2><span class="sec-tag">指标定义</span></div>
    <p class="hint">两个模型都完成任务时，高下体现在"过程代价"。下表列出全部指标及其<b>相关方向</b>——正相关越高越好、负相关越低越好，这也是后面判断被测哪项退化的依据。</p>
    <table>
      <thead><tr><th>指标</th><th>相关方向</th><th>含义</th></tr></thead>
      <tbody>${metricRows}</tbody>
    </table>
  </section>

  <section>
    <div class="sec-head"><h2>评测结果总览</h2><span class="sec-tag">被测 vs 基线</span></div>
    <p class="hint">同一 Benchmark 各跑一次的核心指标。成本 / 耗时类越短越好。数据来源：${esc(path.basename(opts.compare))}（被测）、${esc(path.basename(opts.baseline))}（基线）。</p>
    <div class="legend"><span><i class="d1"></i>被测 · ${esc(opts.compareLabel)}</span><span><i class="d2"></i>基线 · ${esc(opts.baselineLabel)}</span></div>
    ${overview}
    <div class="ratio-row">${ratios}</div>
    <div class="note">完成率两边都是 <b>${C.pass && B.pass ? '100%' : '不一致'}</b>；差异不在「能不能做成」，而在「做成的代价」——被测在成本、耗时、请求上的相对倍数见上。</div>
  </section>

  <section>
    <div class="sec-head"><h2>怎么看这份评测</h2></div>
    <p class="hint">既然结果都满分，评价模型好坏就得钻进「过程」。下面从三个角度拆开看，每个角度对应一个要回答的问题。</p>
    <div class="frame-q">两个模型都完成了任务 —— 光看结果分不出高下，得拆开「过程」看差异</div>
    <div class="frame-arrow">↓ 从三个维度观察</div>
    <div class="lenses">
      <div class="lens"><div class="idx">01 / 资源开销</div><h4>贵不贵、慢不慢</h4><p>做成这件事烧了多少 Token、花了多少时间、发了多少次请求。衡量「效率成本」。</p></div>
      <div class="lens"><div class="idx">02 / 协作行为</div><h4>顺不顺、啰不啰嗦</h4><p>多 Agent 之间来回交互了多少次、谁在推进。衡量「过程是否冗长」。</p></div>
      <div class="lens"><div class="idx">03 / 二次返工</div><h4>稳不稳、走没走弯路</h4><p>有没有被架构打回、有没有自己返修。衡量「一次做对的能力」。</p></div>
    </div>
  </section>

  <section>
    <div class="sec-head"><h2>资源开销</h2><span class="sec-tag">01 · 贵不贵、慢不慢</span></div>
    <p class="hint">把耗时、Token、请求按四个角色（arch 架构 / dev 开发 / uat 验收 / judge 裁判）拆开，看开销压在哪里。</p>
    <table>
      <thead><tr><th>角色</th><th class="num colgrp">被测耗时</th><th class="num colgrp b">基线耗时</th><th class="num colgrp">被测 Token</th><th class="num colgrp b">基线 Token</th><th class="num colgrp">被测请求</th><th class="num colgrp b">基线请求</th></tr></thead>
      <tbody>${resRows}${totalRow}</tbody>
    </table>
    <div class="note">开销集中在 <b>dev 开发</b>：被测的 dev 占了总耗时 <b>${devShareExec}%</b>、Token <b>${devShareTok}%</b>、请求 <b>${devShareReq}%</b> —— 变慢变贵主要发生在写代码这一步。</div>
  </section>

  <section>
    <div class="sec-head"><h2>协作行为</h2><span class="sec-tag">02 · 顺不顺、啰不啰嗦</span></div>
    <p class="hint">多 Agent 之间的动作总数与分布，交互越多通常意味着推进越碎、往返越频繁。</p>
    <div class="cols-2">
      <table>
        <thead><tr><th>按任务类型</th><th class="num">被测</th><th class="num">基线</th></tr></thead>
        <tbody>${actTypeRows}<tr class="total"><td>合计</td><td class="num">${C.actions.total}</td><td class="num">${B.actions.total}</td></tr></tbody>
      </table>
      <table>
        <thead><tr><th>按发送方</th><th class="num">被测</th><th class="num">基线</th></tr></thead>
        <tbody>${senderRows}<tr class="total"><td>合计</td><td class="num">${C.actions.total}</td><td class="num">${B.actions.total}</td></tr></tbody>
      </table>
    </div>
    <div class="note">交互总量 ${C.actions.total} vs ${B.actions.total}。交互越多，通常意味着推进节奏更碎、往返更频繁。</div>
  </section>

  <section>
    <div class="sec-head"><h2>二次返工</h2><span class="sec-tag">03 · 稳不稳、走没走弯路</span></div>
    <p class="hint">返工分两种：被架构打回重做（dev_fix / uat_fix），或验收阶段自己发现问题返修（UAT 自修）。</p>
    <table>
      <thead><tr><th>返工维度</th><th class="num">被测</th><th class="num">基线</th></tr></thead>
      <tbody>
        <tr><td class="metric">Arch 派发 dev_fix</td><td class="num">${C.rework.devFix}</td><td class="num">${B.rework.devFix}</td></tr>
        <tr><td class="metric">Arch 派发 uat_fix</td><td class="num">${C.rework.uatFix}</td><td class="num">${B.rework.uatFix}</td></tr>
        <tr><td class="metric">UAT 自修轮次</td><td class="num">${C.repair.rounds}${C.repair.product ? `（product ${C.repair.product}）` : ''}</td><td class="num">${B.repair.rounds}${B.repair.product ? `（product ${B.repair.product}）` : ''}</td></tr>
      </tbody>
    </table>
    <div class="note">被测 dev 返工 ${C.rework.devFix} 次、UAT 自修 ${C.repair.rounds} 轮；基线 dev 返工 ${B.rework.devFix} 次、UAT 自修 ${B.repair.rounds} 轮。返工位置不同，反映"一次做对"的能力差异。</div>
  </section>

  <section>
    <div class="sec-head"><h2>Badcase 深度分析</h2><span class="sec-tag">前后对比 · 归因</span></div>
    <p class="hint">以基线为参照，聚焦被测<b>退化的指标</b>（更慢 / 更费 / 更绕 / 返工），由模型基于两边的<b>真实执行轨迹</b>（各角色 session 轨迹 + 段日志 + 百炼 requestId）分析根因。以下内容为模型产出。</p>
    ${badcaseHtml
      ? `<div class="badcase">${badcaseHtml}</div>`
      : `<div class="note" style="border-left-color:var(--muted);">尚未生成 badcase 分析。运行 <code>gen-badcase.mjs</code> 产出 <code>badcase.md</code> 后，用 <code>--badcase</code> 传入即可在此嵌入。</div>`}
  </section>

  <section>
    <div class="sec-head"><h2>测试模型评价</h2><span class="sec-tag">被测</span></div>
    <p class="lead">一句话：${v.bad.length ? '活能干成、质量达标，但明显更慢、更费、更绕。' : '结果与效率均达标。'}</p>
    <div class="verdict-grid">
      <div class="vcard good"><h3>表现好的地方</h3><ul class="vlist">${goodLis || '<li><b>—</b>暂无显著优势项。</li>'}</ul></div>
      <div class="vcard bad"><h3>表现差的地方</h3><ul class="vlist">${badLis || '<li><b>—</b>暂无显著劣势项。</li>'}</ul></div>
    </div>
    <div class="note" style="border-left-color:var(--muted);">注：以上评价由本报告真实指标自动推导；单次运行样本有限，正式回流建议同一 Benchmark 多次取均值后再定论。</div>
  </section>

  <footer>数据来源：${esc(path.basename(opts.compare))}（被测）/ ${esc(path.basename(opts.baseline))}（基线）· team3/loop/vote-app · 真实指标呈现，未做数据编造。</footer>

</div>
</body>
</html>`;
}

/* ---------------------------- 入口 ---------------------------- */

function main() {
  const opts = parseArgs(process.argv);
  for (const f of [opts.baseline, opts.compare]) {
    if (!fs.existsSync(f)) { console.error(`找不到 md 文件：${f}`); process.exit(1); }
  }
  const B = parseReport(opts.baseline);
  const C = parseReport(opts.compare);
  const html = render(opts, B, C);
  fs.writeFileSync(opts.out, html, 'utf-8');
  console.log(`✓ 已生成报告：${opts.out}`);
  console.log(`  被测 token ${fmtInt(C.token.total)} / 耗时 ${secToDur(C.exec.total)} / 请求 ${C.requests.total} / action ${C.actions.total}`);
  console.log(`  基线 token ${fmtInt(B.token.total)} / 耗时 ${secToDur(B.exec.total)} / 请求 ${B.requests.total} / action ${B.actions.total}`);
}

// 供 gen-badcase.mjs 等复用解析与换算，避免重复实现
export { parseReport, durToSec, secToDur, fmtInt, ratio, resolveModelName, METRICS };

// 仅在作为脚本直接运行时执行（被 import 时不触发，防止误跑 main）
if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
