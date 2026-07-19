// human-sim.mjs — 模拟「产品负责人 + 项目协调者」的 human-sim agent
//
// 一个常驻进程：监听项目 spec/actions.jsonl，替代真人 owner 参与 team3 流程。
// 它做两件事：
//   1) 回答 Arch/Dev/UAT 通过 to_human 提出的**真实**产品/决策问题（果断、简洁）。
//   2) 监测流程是否卡死；若长时间无实质进展，作为协调者主动发指令推进到下一步。
//
// 关键反“卡死”设计：
//   - 不回复纯状态/寒暄（“待命中/无新任务/收到”之类）——回复会重新唤醒对方 agent，
//     造成 agent↔human 无限 ping-pong。只有真正需要人类决策时才回复。
//   - 每次判断都注入「项目现状」（modules_progress + 最近 actions + uat_stories），
//     让它充分理解项目当前在哪一步、该往哪走。
//   - 进展停滞超过阈值 → 生成一条推进指令（明确 to=arch/dev/uat + 该做什么）。
//
// 用法：
//   node human-sim.mjs --workspace /abs/path [--design <app_design.md>] [--once]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const TEAM3_HOME = path.join(os.homedir(), '.team3');
const POLL_INTERVAL_MS = 3000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

// 进展停滞判定 & 推进节流
const STALL_THRESHOLD_MS = 90_000;   // 无实质进展超过此值 → 考虑推进
const NUDGE_COOLDOWN_MS = 90_000;    // 两次推进之间最小间隔
const MAX_NUDGES = 6;                // 连续无进展时最多推进次数（安全上限）

// 纯 ack / “处理中”回执（agent 收到人类消息后的秒回，产品设计如此）。
// 这类消息没有任何需要人类决策的内容，回复它只会造成 ping-pong，故确定性静默。
// 只匹配这一类，不宽泛静默其它状态消息（例如“待命中”仍交给 LLM 判断）。
const ACK_RE = /^\s*(get|ok|收到|好的|明白)?[\s，,。:：、-]*((开始|正在|马上)?\s*处理中|稍等|处理中[，,。\s]*稍等)/i;

function loadCodeCliCommand() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(TEAM3_HOME, 'config.json'), 'utf-8'));
    return cfg?.codeCli?.command || 'qodercli';
  } catch {
    return 'qodercli';
  }
}

// action / to：把消息路由给某个 agent（对齐 web ChatPanel 的 actionMap）
function routeTo(role) {
  if (role === 'arch') return { action: 'to_arch', to: 'arch' };
  if (role === 'uat') return { action: 'uat_design', to: 'uat' };
  if (role === 'dev') return { action: 'dev_do', to: 'dev' };
  return null;
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}
function readText(p, maxLen) {
  try {
    const t = fs.readFileSync(p, 'utf-8');
    return maxLen && t.length > maxLen ? t.slice(0, maxLen) + '\n…(截断)' : t;
  } catch { return null; }
}

function buildSystemPrompt(designText) {
  return `你在 team3 多智能体编码流程里，同时扮演两个角色：
（A）产品负责人（相当于真人 owner）：Arch/Dev/UAT 会就产品决策向你提问，你要果断拍板。
（B）项目协调者：当流程卡住、没人推进时，你要发出明确指令把它推向下一步。

你需要理解 team3 的协作流程（据此判断“下一步该谁做什么”）：
- Arch（架构/PM）：拆 module 与 feature、派 dev_do/dev_fix 给 Dev；所有 module 都 done 后，读 spec/uat_stories.md 逐个发 uat_check [uat-story: N] 进入验收。
- Dev：实现被指派的 feature，完成后用 to_arch 向 Arch 交付。
- UAT：收到 arch 的 uat_check [uat-story: N] 才进入 MODE B 黑盒验收；全部 Story 通过后 to_human「产品验收通过 N/M」。
- 常见卡点：所有 module 已 done，但 Arch 没有发 uat_check，UAT 一直空等 —— 这时应指令 Arch 立即按 uat_stories.md 发 uat_check。

输出规则（严格遵守）：
- 若对方消息只是**状态汇报/待命/寒暄**、并没有真正需要你决策的问题：只输出一个词 [SKIP]，不要输出任何别的内容。（回复这类消息会造成无限空转）
- 若确实需要决策：只输出你的答复本身，果断具体、一两句话说清，用大白话，不要复述问题、不要寒暄、不要思考过程。
- 始终与产品设计意图一致，倾向“保持简单、只做设计里写的”，不引入设计外的功能。

=== 产品设计意图（spec/app_design.md）===
${designText}
=== 设计意图结束 ===`;
}

export function createHumanSim({ workspace, superman = false, logger = (m) => process.stdout.write(m + '\n') }) {
  const absWorkspace = path.resolve(workspace);
  const specDir = path.join(absWorkspace, 'spec');
  const actionsPath = path.join(specDir, 'actions.jsonl');
  const designPathDefault = path.join(specDir, 'app_design.md');
  const stateFile = path.join(absWorkspace, '.human-sim-state.json');
  const command = loadCodeCliCommand();

  let designText = '';
  let sessionId = null;
  let offset = 0;
  let buffer = '';
  let stopped = false;

  // 进展跟踪
  let lastProgressSig = null;
  let lastProgressTs = Date.now();
  let lastNudgeTs = 0;
  let nudgeCount = 0;

  function loadState() {
    const s = readJSON(stateFile);
    if (s) { sessionId = s.sessionId || null; offset = s.offset || 0; }
  }
  function saveState() {
    fs.writeFileSync(stateFile, JSON.stringify({ sessionId, offset }), 'utf-8');
  }

  function loadDesign(designPath) {
    const p = designPath ? path.resolve(designPath) : designPathDefault;
    designText = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '(app_design.md 缺失)';
  }

  // 读取全部 actions（用于现状快照 & 进展签名）
  function allActions() {
    if (!fs.existsSync(actionsPath)) return [];
    const out = [];
    for (const line of fs.readFileSync(actionsPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch {}
    }
    return out;
  }

  // 项目现状快照：注入给 LLM，让它理解“现在在哪一步”
  function projectState() {
    const actions = allActions();
    const parts = [];

    const mp = readJSON(path.join(specDir, 'modules_progress.json'));
    if (mp && Array.isArray(mp.modules)) {
      const lines = mp.modules.map((m) => {
        const feats = (m.features || []).map((f) => `#${f.id}:${f.status}`).join(' ');
        return `  - ${m.id}(${m.name || ''}) = ${m.status}${feats ? ` [${feats}]` : ''}`;
      });
      parts.push(`模块进度(modules_progress.json):\n${lines.join('\n')}`);
    } else {
      parts.push('模块进度: (modules_progress.json 尚未生成)');
    }

    const stories = readText(path.join(specDir, 'uat_stories.md'), 600);
    parts.push(`uat_stories.md: ${stories ? '已存在\n' + stories : '(不存在)'}`);

    const reportExists = fs.existsSync(path.join(specDir, 'uat_report.md'));
    parts.push(`uat_report.md: ${reportExists ? '已存在' : '(不存在)'}`);

    const recent = actions.slice(-12).map((a) => `  [${a.from}→${a.to}] ${a.action}: ${(a.message || '').replace(/\n/g, ' ').slice(0, 90)}`);
    parts.push(`最近动作(尾部):\n${recent.join('\n') || '  (无)'}`);

    return parts.join('\n\n');
  }

  // 进展签名：只看 agent 产生的实质动作 + 关键产物，human 自己的发言不计入
  function progressSignature() {
    const actions = allActions();
    let devWork = 0, uatWork = 0, archDispatch = 0, delivery = 0;
    for (const a of actions) {
      if (a.from === 'human') continue;
      if (a.action === 'dev_do' || a.action === 'dev_fix') devWork++;
      else if (a.action === 'uat_check' || a.action === 'uat_fix') uatWork++;
      else if (a.action === 'to_arch' && a.from === 'dev') delivery++;
      if (a.from === 'arch' && (a.action === 'uat_check')) archDispatch++;
    }
    const mp = readText(path.join(specDir, 'modules_progress.json'));
    const report = fs.existsSync(path.join(specDir, 'uat_report.md'));
    return JSON.stringify({ devWork, uatWork, archDispatch, delivery, mp, report });
  }

  function updateProgress() {
    const sig = progressSignature();
    if (sig !== lastProgressSig) {
      lastProgressSig = sig;
      lastProgressTs = Date.now();
      nudgeCount = 0; // 有进展 → 重置推进计数
    }
  }

  // 调 qodercli。kind: 'answer' 回答问题 / 'nudge' 生成推进指令
  function callCli(userPrompt) {
    const args = ['-p', userPrompt, '--output-format', 'text'];
    if (!sessionId) {
      sessionId = randomUUID();
      args.push('--session-id', sessionId, '--system-prompt', buildSystemPrompt(designText));
    } else {
      args.push('--resume', sessionId);
    }
    if (superman || process.env.TEAM3_SUPERMAN) args.push('--dangerously-skip-permissions');

    const out = execFileSync(command, args, {
      cwd: absWorkspace,
      timeout: CALL_TIMEOUT_MS,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return out.trim();
  }

  function callWithRetry(userPrompt) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try { return callCli(userPrompt); }
      catch (e) {
        logger(`[retry ${attempt + 1}] qodercli 调用失败: ${e.message}`);
      }
    }
    return null;
  }

  function appendAction(routing, message) {
    const entry = { ...routing, from: 'human', ts: Math.floor(Date.now() / 1000), message };
    fs.appendFileSync(actionsPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  // 回答一个 to_human 问题（先做廉价过滤，再交给 LLM，LLM 可判 [SKIP]）
  async function answer(question) {
    const routing = routeTo(question.from);
    if (!routing) { logger(`[skip] 无法路由回复给 from=${question.from}`); return; }

    const msg = question.message || '';
    // 确定性静默：纯 ack / “处理中”回执（产品设计的秒回），回复只会造成 ping-pong
    if (ACK_RE.test(msg)) {
      logger(`[ignore←${question.from}] ack/处理中 回执，不回复（避免空转）`);
      return;
    }

    const prompt = `【${question.from} 通过 to_human 发来消息】\n${msg}\n\n【项目现状】\n${projectState()}\n\n请判断：这是否真的需要你（产品负责人）做决策？\n- 若只是状态/待命/寒暄，输出 [SKIP]。\n- 否则给出果断简洁的答复。`;
    const reply = callWithRetry(prompt);
    if (!reply) { logger('[error] 多次重试仍失败，跳过'); return; }
    if (/^\[SKIP\]/i.test(reply) || reply.replace(/\s/g, '') === '[SKIP]') {
      logger(`[skip←${question.from}] LLM 判定无需决策`);
      return;
    }

    appendAction(routing, reply);
    logger(`[reply→${routing.to}] ${reply.slice(0, 80).replace(/\n/g, ' ')}${reply.length > 80 ? '…' : ''}`);
  }

  // 流程停滞时主动推进：让 LLM 判断“该谁做什么”，输出 JSON {to, message}
  async function nudge() {
    const stalledSec = Math.round((Date.now() - lastProgressTs) / 1000);
    const prompt = `系统检测到项目已约 ${stalledSec}s 没有实质进展（没有新的开发/验收动作，只有空转或等待）。\n\n【项目现状】\n${projectState()}\n\n作为项目协调者，判断现在应由谁来推进、做什么，把项目推向下一步（例如：所有 module 已 done 但没进 UAT，就该让 arch 立即发 uat_check [uat-story: N]）。\n\n只输出一行 JSON，不要任何其它文字：\n{"to":"arch|dev|uat|null","message":"给该角色的明确、可执行指令"}\n若确实无需干预则输出 {"to":null}。`;
    const raw = callWithRetry(prompt);
    if (!raw) { logger('[nudge] 生成推进指令失败'); return; }

    let obj = null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch {} }
    if (!obj || !obj.to || obj.to === 'null') {
      // LLM 认为无需干预：也计入次数并延长冷却，避免“无需干预”无限刷屏
      lastNudgeTs = Date.now();
      nudgeCount++;
      logger(`[nudge] LLM 判定无需干预（第 ${nudgeCount}/${MAX_NUDGES} 次，不再频繁重试）`);
      return;
    }

    const routing = routeTo(obj.to);
    if (!routing) { logger(`[nudge] 非法目标: ${obj.to}`); return; }
    const message = (obj.message || '').trim();
    if (!message) { logger('[nudge] 空指令，跳过'); return; }

    appendAction(routing, message);
    lastNudgeTs = Date.now();
    nudgeCount++;
    logger(`[nudge→${routing.to} #${nudgeCount}] ${message.slice(0, 90).replace(/\n/g, ' ')}${message.length > 90 ? '…' : ''}`);
  }

  // 读取 offset 之后的新行，返回需要处理的 to_human 问题（from ∈ arch/dev/uat）
  function readNewQuestions() {
    if (!fs.existsSync(actionsPath)) return [];
    const size = fs.statSync(actionsPath).size;
    if (size < offset) { offset = 0; buffer = ''; }
    if (size === offset) return [];
    const fd = fs.openSync(actionsPath, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;

    buffer += buf.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop();

    const questions = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let obj;
      try { obj = JSON.parse(t); } catch { continue; }
      if (obj.action === 'to_human' && obj.to === 'human' && ['arch', 'dev', 'uat'].includes(obj.from)) {
        questions.push(obj);
      }
    }
    return questions;
  }

  return {
    getSessionId: () => sessionId,
    stop: () => { stopped = true; },
    async start({ designPath, once = false } = {}) {
      loadState();
      loadDesign(designPath);
      lastProgressSig = progressSignature();
      lastProgressTs = Date.now();
      logger(`human-sim 启动: workspace=${absWorkspace}, cli=${command}, once=${once}`);

      while (!stopped) {
        const questions = readNewQuestions();
        for (const q of questions) {
          logger(`[ask←${q.from}] ${(q.message || '').slice(0, 80).replace(/\n/g, ' ')}…`);
          await answer(q);
        }
        updateProgress();
        saveState();

        if (once) {
          if (questions.length > 0) return questions.length;
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          const retry = readNewQuestions();
          for (const q of retry) await answer(q);
          saveState();
          return retry.length;
        }

        // 停滞检测：无实质进展超过阈值 + 冷却已过 + 未超推进上限 → 主动推进
        const stalledMs = Date.now() - lastProgressTs;
        if (stalledMs > STALL_THRESHOLD_MS && Date.now() - lastNudgeTs > NUDGE_COOLDOWN_MS && nudgeCount < MAX_NUDGES) {
          logger(`[stall] 已 ${Math.round(stalledMs / 1000)}s 无实质进展，尝试推进（第 ${nudgeCount + 1}/${MAX_NUDGES} 次）`);
          await nudge();
          updateProgress();
          saveState();
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    },
  };
}

// --- CLI ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { workspace: null, design: null, once: false, superman: false };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if ((k === '--workspace' || k === '-w') && args[i + 1]) out.workspace = args[++i];
    else if (k === '--design' && args[i + 1]) out.design = args[++i];
    else if (k === '--once') out.once = true;
    else if (k === '--superman') out.superman = true;
    else if (!out.workspace) out.workspace = k;
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.workspace) {
    process.stderr.write('用法: node human-sim.mjs --workspace <abs> [--design <app_design.md>] [--once] [--superman]\n');
    process.exit(1);
  }
  const sim = createHumanSim({ workspace: opts.workspace, superman: opts.superman });
  const n = await sim.start({ designPath: opts.design, once: opts.once });
  if (opts.once) process.stdout.write(`\n处理了 ${n} 个 to_human 问题。\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((err) => { process.stderr.write(`human-sim 失败: ${err.message}\n`); process.exit(1); });
}
