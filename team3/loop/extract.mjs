// extract.mjs — decision_log → issues.md + habits.md（Step 4）
//
// 从各项目的 decision_log 提取系统问题和人类偏好，用 qodercli LLM 做提取。
// 增量：按行号追踪上次处理位置，只处理新增条目。
//
// 用法：
//   node extract.mjs [--source <path>] [--reset] [--dry-run]
//
// --source   指定源文件（如 decision_log_all.md）；不指定则从 ~/.team3/projects.json 自动发现
// --reset    忽略增量状态，从头处理
// --dry-run  只展示待处理内容，不调 qodercli

import fs from 'node:fs';
import path from 'node:path';
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

function discoverSources() {
  const projectsPath = path.join(TEAM3_HOME, 'projects.json');
  const projects = readJSON(projectsPath);
  if (!projects) return [];
  const seen = new Set();
  const sources = [];
  for (const p of projects) {
    const logPath = path.join(p.workspace, 'spec', 'decision_log.md');
    if (seen.has(logPath)) continue;
    seen.add(logPath);
    if (fs.existsSync(logPath)) {
      sources.push({ project: p.name, path: logPath });
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

const ISSUES_SYSTEM = `你是 team3 harness 系统的审计员。你的任务是从 decision_log 条目中提取「系统级问题」——即 harness（team3 的 Arch/Dev/UAT 流程、prompt 设计、上下文管理、验证机制）本应拦截但没有拦截住的问题。

注意：不是所有 decision_log 条目都是 harness 问题。很多条目是项目特定的技术教训（如"Next.js 16 需要配 allowedDevOrigins"），这些不属于 harness 问题。只有那些暴露了 harness 流程缺陷的条目才是 issues。

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
  return `请从以下 ${entries.length} 条 decision_log 条目中提取系统级问题（harness 流程缺陷）。

每个 issue 输出以下结构：
## Issue: {简短标题}
- **分类**: {方向编号和名称}
- **改进建议**: {具体可操作的改进方向，说清楚改哪里、怎么改}
- **证据**:
  - {项目名} | {日期} | {role}: {描述}

证据的追溯性要求：如果原始条目中提到了具体的文件路径、feature 编号、日志路径、代码片段、端口号等可定位的细节，**必须保留**。这些是追溯的关键。如果原始条目没有这些细节，就如实描述条目内容，不要编造。

如果没有找到任何 harness 问题，输出 "# Issues\n\n无"。

--- BEGIN DECISION_LOG ENTRIES ---
${text}
--- END DECISION_LOG ENTRIES ---`;
}

const HABITS_SYSTEM = `你是 team3 的用户研究员。你的任务是从 decision_log 条目中提取「人类偏好」——人类 owner 在做决策时反复表现出来的倾向。

硬性规则：
1. **只提取来自人类（role = human）的条目**。dev 和 arch 自己总结的经验教训不是 habits，不要提取。只关注 header 中 role 为 human 的条目。
2. **合并相近的偏好**。如果两个偏好有包含关系或高度重叠，合并成一条，不要拆成多条。注意辩证地理解——比如人类说"好看重定义为成果可信"，意思是好看本身就是可信的一部分，不是对立面。不要把"好看"和"可信"写成取舍关系。
3. **证据最多 3 条**（few-shot）。选最有代表性的 3 条，不要全列。
4. **证据必须引用原始内容**。直接复制原始 decision_log 条目中的原文（背景/结论段落的关键句子），不要自己重新总结或改写。证据的价值在于它是原始记录，不是你的解读。
5. **说人话**。描述要具体、大白话，让人一眼看懂。`;

function buildHabitsPrompt(entries) {
  const text = entries.map((e) => `${e.header}\n${e.body}`).join('\n---\n');
  return `请从以下 ${entries.length} 条 decision_log 条目中提取人类偏好。

**再次强调：只提取 role = human 的条目中的偏好。dev/arch 的条目忽略。**

每条 habit 输出：
## Habit: {简短标题}
- **描述**: {大白话说清楚：什么人在什么时候会怎么做、为什么}
- **证据**（最多 3 条，直接引用原文）:
  - {日期}: "{从原始条目中复制的关键句子}"

如果没有找到任何来自人类的偏好，输出 "# Habits\n\n无"。

--- BEGIN DECISION_LOG ENTRIES ---
${text}
--- END DECISION_LOG ENTRIES ---`;
}

/* ------------------------------------------------------------------ */
/*  loop 目录编号                                                       */
/* ------------------------------------------------------------------ */

function nextLoopDir() {
  const existing = fs.readdirSync(LOOP_DIR)
    .filter((d) => /^loop_\d+$/.test(d))
    .map((d) => parseInt(d.split('_')[1], 10))
    .sort((a, b) => a - b);
  const next = existing.length ? existing[existing.length - 1] + 1 : 1;
  return `loop_${String(next).padStart(3, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs(process.argv);
  const log = (m) => process.stdout.write(m + '\n');
  const command = loadCodeCliCommand();

  // 1. 收集每个源文件：读全文 + 记行数
  let sourceLabel;
  let sources; // [{ project, path, text, totalLines }]

  if (opts.source) {
    const sourcePath = path.resolve(opts.source);
    if (!fs.existsSync(sourcePath)) {
      process.stderr.write(`源文件不存在: ${sourcePath}\n`);
      process.exit(1);
    }
    const text = fs.readFileSync(sourcePath, 'utf-8');
    sources = [{ project: '(single)', path: sourcePath, text, totalLines: text.split('\n').length }];
    sourceLabel = sourcePath;
    log(`源文件: ${sourcePath}（${sources[0].totalLines} 行）`);
  } else {
    const discovered = discoverSources();
    if (!discovered.length) {
      log('未发现任何项目 decision_log');
      process.exit(0);
    }
    sources = [];
    for (const s of discovered) {
      const text = readText(s.path);
      if (!text) continue;
      sources.push({ project: s.project, path: s.path, text, totalLines: text.split('\n').length });
    }
    sourceLabel = '(auto-discover)';
    log(`自动发现 ${sources.length} 个项目，共 ${sources.reduce((n, s) => n + s.totalLines, 0)} 行`);
  }

  // 2. 增量过滤：从 state.project_list 里查每个项目的 offset（行号），从该行起解析条目
  const state = loadState();
  if (opts.reset) {
    state.project_list = [];
    state.loop_round = null;
  }
  const offsetByPath = new Map(state.project_list.map((p) => [p.decision_log_path, p.offset || 0]));

  const newEntries = [];
  for (const s of sources) {
    const offset = offsetByPath.get(s.path) || 0;
    const entries = parseEntries(s.text, offset);
    for (const e of entries) {
      e.header = e.header.replace(/^##\s*/, `## [${s.project}] `);
    }
    for (const e of entries) newEntries.push(e);
  }

  if (!newEntries.length) {
    log('无新增条目，退出');
    process.exit(0);
  }
  log(`新增条目: ${newEntries.length} 条`);

  if (opts.dryRun) {
    log('\n--- 待处理条目 ---');
    for (const e of newEntries) log(e.header);
    process.exit(0);
  }

  // 3. 创建 loop 目录
  const loopName = nextLoopDir();
  const loopPath = path.join(LOOP_DIR, loopName);
  fs.mkdirSync(loopPath, { recursive: true });
  log(`\n输出目录: ${loopPath}`);

  // 4. 提取 issues
  log('\n[1/2] 提取 issues…');
  const issuesPrompt = buildIssuesPrompt(newEntries);
  const issuesResult = callWithRetry(command, issuesPrompt, { systemPrompt: ISSUES_SYSTEM }, log);
  if (issuesResult) {
    const issuesPath = path.join(loopPath, 'issues.md');
    const header = `# Issues — ${loopName}\n\n> 提取时间: ${new Date().toISOString()}\n> 来源: ${sourceLabel}\n> 新增条目: ${newEntries.length}\n\n`;
    fs.writeFileSync(issuesPath, header + issuesResult + '\n', 'utf-8');
    log(`  写入: ${issuesPath}`);
  } else {
    log('  issues 提取失败（qodercli 多次重试后仍失败）');
  }

  // 5. 提取 habits
  log('\n[2/2] 提取 habits…');
  const habitsPrompt = buildHabitsPrompt(newEntries);
  const habitsResult = callWithRetry(command, habitsPrompt, { systemPrompt: HABITS_SYSTEM }, log);
  if (habitsResult) {
    const habitsPath = path.join(loopPath, 'habits.md');
    const header = `# Habits — ${loopName}\n\n> 提取时间: ${new Date().toISOString()}\n> 来源: ${sourceLabel}\n> 新增条目: ${newEntries.length}\n\n`;
    fs.writeFileSync(habitsPath, header + habitsResult + '\n', 'utf-8');
    log(`  写入: ${habitsPath}`);
  } else {
    log('  habits 提取失败（qodercli 多次重试后仍失败）');
  }

  // 6. 更新状态：以当前发现的列表为准，每个项目记录 offset = 该文件已读到的行号
  state.project_list = sources.map((s) => ({
    project: s.project,
    decision_log_path: s.path,
    offset: s.totalLines,
  }));
  state.loop_round = loopName;
  saveState(state);
  log(`\n状态已更新: ${sources.length} 个项目，loop_round=${loopName}`);
  log(`\n=== 提取完成: ${loopName} ===`);
}

main().catch((err) => {
  process.stderr.write(`extract 失败: ${err.stack || err.message}\n`);
  process.exit(1);
});
