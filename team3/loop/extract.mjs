// extract.mjs — 决策/经验 → issues.md + habits.md（Step 4）
//
// 从各项目提取系统问题和人类偏好，用 qodercli LLM 做提取。
//
// 每个项目两个源文件，自动识别、可并存：
//   - spec/experience.md（Agent 经验 → issues 源）
//   - spec/decisions.md（人类决策 → habits 源）
//
// 增量逻辑：按「条目内容 hash」判新旧，不按行号——decisions.md / experience.md
// 都允许修订/删除旧条目（rebase 局部清理、经验修订），行号会错位。
// 每条 `## 日期 | ...` 条目归一化后取 hash，state 存每个源的已见 hash 集合；
// 新增 = hash 没见过。修订旧条目 → 内容变 → 新 hash → 重新提取（正是想要的行为）。
//
// 用法：
//   node extract.mjs [--source <path>] [--reset] [--dry-run]
//
// --source   指定单个源文件（文件名为 decisions.md 时按人类决策处理，其余按经验处理）
// --reset    忽略增量状态，从头处理
// --dry-run  只展示待处理内容，不调 qodercli

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOOP_DIR = __dirname;
const TEAM3_HOME = path.join(process.env.HOME, '.team3');
const STATE_FILE = path.join(LOOP_DIR, '.extract-state.json');
const CALL_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 2;

/* ------------------------------------------------------------------ */
/*  工具函数                                                            */
/* ------------------------------------------------------------------ */

function loadCodeCliCommand() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(TEAM3_HOME, 'config.json'), 'utf-8'));
    return cfg?.codeCli?.command || 'qodercli';
  } catch {
    return 'qodercli';
  }
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { source: null, reset: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === '--source' && args[i + 1]) out.source = args[++i];
    else if (k === '--reset') out.reset = true;
    else if (k === '--dry-run') out.dryRun = true;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  增量状态                                                            */
/* ------------------------------------------------------------------ */

function loadState() {
  return readJSON(STATE_FILE) || { project_list: [], loop_round: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/* ------------------------------------------------------------------ */
/*  源发现                                                              */
/* ------------------------------------------------------------------ */

// 每个项目两个源文件，kind 决定进哪条提取流水线：
//   experience → issues（Agent 经验）
//   decisions  → habits（人类决策）
function discoverSources() {
  const projectsPath = path.join(TEAM3_HOME, 'projects.json');
  const projects = readJSON(projectsPath);
  if (!projects) return [];
  const seen = new Set();
  const sources = [];
  const KINDS = [
    { kind: 'experience', file: 'experience.md' },
    { kind: 'decisions', file: 'decisions.md' },
  ];
  for (const p of projects) {
    for (const { kind, file } of KINDS) {
      const filePath = path.join(p.workspace, 'spec', file);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      if (fs.existsSync(filePath)) {
        sources.push({ project: p.name, kind, path: filePath });
      }
    }
  }
  return sources;
}

/* ------------------------------------------------------------------ */
/*  条目解析                                                            */
/* ------------------------------------------------------------------ */

function parseEntries(text, startLine = 0) {
  const lines = text.split('\n');
  const entries = [];
  let current = null;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+\d{4}-\d{2}-\d{2}/.test(line)) {
      if (current) entries.push(current);
      current = { header: line, body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) entries.push(current);
  return entries;
}

// 条目内容 hash：header+body 归一化（去每行首尾空白、丢空行）后 sha256 取前 16 位。
// 只对实质内容敏感——rebase 调空行/缩进不会误判为新条目。
function entryHash(e) {
  const norm = (e.header + '\n' + e.body)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/*  qodercli 调用                                                       */
/* ------------------------------------------------------------------ */

function callCli(command, prompt, { systemPrompt } = {}) {
  const args = ['-p', prompt, '--output-format', 'text'];
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }
  return execFileSync(command, args, {
    timeout: CALL_TIMEOUT_MS,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function callWithRetry(command, prompt, opts, log) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try { return callCli(command, prompt, opts); }
    catch (e) {
      log(`[retry ${attempt + 1}] qodercli 调用失败: ${e.message}`);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Prompt                                                              */
/* ------------------------------------------------------------------ */

const ISSUES_SYSTEM = `你是 team3 harness 系统的审计员。你的任务是从经验/决策条目中提取「系统级问题」——即 harness（team3 的 Arch/Dev/UAT 流程、prompt 设计、上下文管理、验证机制）本应拦截但没有拦截住的问题。

注意：不是所有条目都是 harness 问题。很多条目是项目特定的技术教训（如"Next.js 16 需要配 allowedDevOrigins"），这些不属于 harness 问题。只有那些暴露了 harness 流程缺陷的条目才是 issues。

对每个识别出的 issue，按以下 7 个方向分类（选最相关的一个，也可以标记"其他"）：
1. Prompt 具体化 — prompt 太模糊，agent 走了捷径
2. CLI 脚本化 — 确定性操作应该用代码而非 prompt
3. 上下文架构 — 阶段间信息传递不当（该丢的没丢、该带的没带）
4. 通用上下文技术 — offload/reduce/retrieve/isolate/cache 的缺失
5. 技术栈约束 — 版本/环境没有锁死，每个项目重踩坑
6. 验证环境 — 启停/端口/隔离不标准
7. 验证集有效 — e2e/UAT 覆盖不够或分布不对`;

function buildIssuesPrompt(entries) {
  const text = entries.map((e) => `${e.header}\n${e.body}`).join('\n---\n');
  return `请从以下 ${entries.length} 条条目中提取系统级问题（harness 流程缺陷）。

每个 issue 输出以下结构：
## Issue: {简短标题}
- **分类**: {方向编号和名称}
- **改进建议**: {具体可操作的改进方向，说清楚改哪里、怎么改}
- **证据**:
  - {项目名} | {日期} | {role}: {描述}

证据的追溯性要求：如果原始条目中提到了具体的文件路径、feature 编号、日志路径、代码片段、端口号等可定位的细节，**必须保留**。这些是追溯的关键。如果原始条目没有这些细节，就如实描述条目内容，不要编造。

如果没有找到任何 harness 问题，输出 "# Issues\n\n无"。

--- BEGIN ENTRIES ---
${text}
--- END ENTRIES ---`;
}

const HABITS_SYSTEM = `你是 team3 的用户研究员。你的任务是从人类决策条目中提取「人类偏好」——人类 owner 在做决策时反复表现出来的倾向。

硬性规则：
1. **条目全部来自 decisions.md**（header 为「日期 | 一句话决策」），都是人类拍板过的决策，全部纳入分析。
2. **合并相近的偏好**。如果两个偏好有包含关系或高度重叠，合并成一条，不要拆成多条。注意辩证地理解——比如人类说"好看重定义为成果可信"，意思是好看本身就是可信的一部分，不是对立面。不要把"好看"和"可信"写成取舍关系。
3. **证据最多 3 条**（few-shot）。选最有代表性的 3 条，不要全列。
4. **证据必须引用原始内容**。直接复制原始条目中的原文（关键句子），不要自己重新总结或改写。证据的价值在于它是原始记录，不是你的解读。
5. **说人话**。描述要具体、大白话，让人一眼看懂。`;

function buildHabitsPrompt(entries) {
  const text = entries.map((e) => `${e.header}\n${e.body}`).join('\n---\n');
  return `请从以下人类决策条目中提取人类偏好。

每条 habit 输出：
## Habit: {简短标题}
- **描述**: {大白话说清楚：什么人在什么时候会怎么做、为什么}
- **证据**（最多 3 条，直接引用原文）:
  - {日期}: "{从原始条目中复制的关键句子}"

如果没有找到任何来自人类的偏好，输出 "# Habits\n\n无"。

--- BEGIN ENTRIES ---
${text}
--- END ENTRIES ---`;
}

/* ------------------------------------------------------------------ */
/*  loop 目录编号                                                       */
/* ------------------------------------------------------------------ */

// 编号取「目录扫描最大号」和「状态文件 loop_round」的较大者 +1：
// loop_N 目录可能被人工清理，只扫目录会复用旧编号，和 .extract-state.json 对不上。
function nextLoopDir(stateLoopRound) {
  const existing = fs.readdirSync(LOOP_DIR)
    .filter((d) => /^loop_\d+$/.test(d))
    .map((d) => parseInt(d.split('_')[1], 10));
  const dirMax = existing.length ? Math.max(...existing) : 0;
  const stateMax = /^loop_\d+$/.test(stateLoopRound || '')
    ? parseInt(stateLoopRound.split('_')[1], 10)
    : 0;
  const next = Math.max(dirMax, stateMax) + 1;
  return `loop_${String(next).padStart(3, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs(process.argv);
  const log = (m) => process.stdout.write(m + '\n');
  const command = loadCodeCliCommand();

  // 1. 收集每个源文件：读全文 + 记行数（--source 按文件名判 kind）
  let sourceLabel;
  let sources; // [{ project, kind, path, text, totalLines }]

  if (opts.source) {
    const sourcePath = path.resolve(opts.source);
    if (!fs.existsSync(sourcePath)) {
      process.stderr.write(`源文件不存在: ${sourcePath}\n`);
      process.exit(1);
    }
    const text = fs.readFileSync(sourcePath, 'utf-8');
    const kind = path.basename(sourcePath) === 'decisions.md' ? 'decisions' : 'experience';
    sources = [{ project: '(single)', kind, path: sourcePath, text, totalLines: text.split('\n').length }];
    sourceLabel = sourcePath;
    log(`源文件: ${sourcePath}（${sources[0].totalLines} 行，按 ${kind} 处理）`);
  } else {
    const discovered = discoverSources();
    if (!discovered.length) {
      log('未发现任何项目源文件（experience.md / decisions.md）');
      process.exit(0);
    }
    sources = [];
    for (const s of discovered) {
      const text = readText(s.path);
      if (!text) continue;
      sources.push({ project: s.project, kind: s.kind, path: s.path, text, totalLines: text.split('\n').length });
    }
    sourceLabel = '(auto-discover)';
    log(`自动发现 ${sources.length} 个源文件，共 ${sources.reduce((n, s) => n + s.totalLines, 0)} 行`);
  }

  // 2. 增量过滤（条目 hash）：全文解析条目，hash 不在已见集合里的才是新增。
  //    旧 state 只有行号 offset 的，做一次性迁移：offset 之前的条目视为已见。
  const state = loadState();
  if (opts.reset) {
    state.project_list = [];
    state.loop_round = null;
  }
  const stateByPath = new Map(
    (state.project_list || []).map((p) => [p.path || p.decision_log_path, p])
  );

  const issuesEntries = [];   // experience 新增
  const habitsEntries = [];   // decisions 新增
  const nextStateByPath = new Map(); // 本次各源的最新 hash 全集

  for (const s of sources) {
    const entries = parseEntries(s.text, 0);
    const hashes = entries.map(entryHash); // 先算 hash，再改 header

    const prev = stateByPath.get(s.path);
    let seen;
    if (prev && Array.isArray(prev.seen)) {
      seen = new Set(prev.seen);
    } else if (prev && typeof prev.offset === 'number') {
      // 旧行号 state 迁移：offset 之前的条目按当前内容算 hash 记为已见
      const headLines = s.text.split('\n').slice(0, Math.min(prev.offset, s.totalLines));
      seen = new Set(parseEntries(headLines.join('\n'), 0).map(entryHash));
    } else {
      seen = new Set();
    }

    entries.forEach((e, i) => {
      if (seen.has(hashes[i])) return;
      e.header = e.header.replace(/^##\s*/, `## [${s.project}] `);
      if (s.kind === 'decisions') habitsEntries.push(e);
      else issuesEntries.push(e);
    });

    nextStateByPath.set(s.path, { project: s.project, kind: s.kind, path: s.path, seen: hashes });
  }

  if (!issuesEntries.length && !habitsEntries.length) {
    log('无新增条目，退出');
    process.exit(0);
  }
  log(`新增条目：issues 池 ${issuesEntries.length} 条，habits 池 ${habitsEntries.length} 条`);

  if (opts.dryRun) {
    log('\n--- issues 池新增条目 ---');
    for (const e of issuesEntries) log(e.header);
    log('\n--- habits 池新增条目 ---');
    for (const e of habitsEntries) log(e.header);
    process.exit(0);
  }

  // 3. 创建 loop 目录
  const loopName = nextLoopDir(state.loop_round);
  const loopPath = path.join(LOOP_DIR, loopName);
  fs.mkdirSync(loopPath, { recursive: true });
  log(`\n输出目录: ${loopPath}`);

  // 4. 提取 issues
  if (issuesEntries.length) {
    log('\n[1/2] 提取 issues…');
    const issuesPrompt = buildIssuesPrompt(issuesEntries);
    const issuesResult = callWithRetry(command, issuesPrompt, { systemPrompt: ISSUES_SYSTEM }, log);
    if (issuesResult) {
      const issuesPath = path.join(loopPath, 'issues.md');
      const header = `# Issues — ${loopName}\n\n> 提取时间: ${new Date().toISOString()}\n> 来源: ${sourceLabel}\n> 新增条目: ${issuesEntries.length}\n\n`;
      fs.writeFileSync(issuesPath, header + issuesResult + '\n', 'utf-8');
      log(`  写入: ${issuesPath}`);
    } else {
      log('  issues 提取失败（qodercli 多次重试后仍失败）');
    }
  } else {
    log('\n[1/2] issues 池无新增条目，跳过');
  }

  // 5. 提取 habits（decisions.md 新增条目）
  if (habitsEntries.length) {
    log('\n[2/2] 提取 habits…');
    const habitsPrompt = buildHabitsPrompt(habitsEntries);
    const habitsResult = callWithRetry(command, habitsPrompt, { systemPrompt: HABITS_SYSTEM }, log);
    if (habitsResult) {
      const habitsPath = path.join(loopPath, 'habits.md');
      const header = `# Habits — ${loopName}\n\n> 提取时间: ${new Date().toISOString()}\n> 来源: ${sourceLabel}\n\n`;
      fs.writeFileSync(habitsPath, header + habitsResult + '\n', 'utf-8');
      log(`  写入: ${habitsPath}`);
    } else {
      log('  habits 提取失败（qodercli 多次重试后仍失败）');
    }
  } else {
    log('\n[2/2] habits 池无新增条目，跳过');
  }

  // 6. 更新状态：按 path 合并——本次处理过的源写入最新 hash 全集（删掉的条目
  //    自然从集合消失），没处理到的源（如 --source 单文件模式）保留原状态不动
  for (const [p, entry] of nextStateByPath) stateByPath.set(p, entry);
  state.project_list = [...stateByPath.values()];
  state.loop_round = loopName;
  saveState(state);
  log(`\n状态已更新: ${sources.length} 个源文件，loop_round=${loopName}`);
  log(`\n=== 提取完成: ${loopName} ===`);
}

main().catch((err) => {
  process.stderr.write(`extract 失败: ${err.stack || err.message}\n`);
  process.exit(1);
});
