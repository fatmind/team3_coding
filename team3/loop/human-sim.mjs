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
// 「有进展」= action 级实质动作变化 或 agent 日志在增长（见 updateProgress）。
// 后者是关键：agent 写代码/跑测试/起服务时不产生 action，但 stream-json 日志一直在写；
// 只看 action 会把"正在干活的长 session"误判为停滞、nudge 一下就把它 SIGINT 打断重来。
// 阈值 5min 衡量的是「日志真正静默」多久——正常干活每几秒写一行、计时器持续被刷新，
// 只有 session 卡死/崩溃（长时间无任何日志输出）才会触发 nudge。
const STALL_THRESHOLD_MS = 300_000;  // 日志/动作静默超过此值 → 考虑推进
const NUDGE_COOLDOWN_MS = 300_000;   // 两次推进之间最小间隔
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

// action / to：把消息路由给某个 agent（对齐 web ChatPanel 的人类纯消息通道）
// to_arch / to_dev / to_uat 都是"人类说一句话"：daemon 复用对方当前 session，
// 不新建、不归档——回答提问和提醒继续都适用。派活（dev_do/uat_design/uat_check）
// 是 arch 的职责，human-sim 作为人类不直接派活。
function routeTo(role) {
  if (role === 'arch') return { action: 'to_arch', to: 'arch' };
  if (role === 'uat') return { action: 'to_uat', to: 'uat' };
  if (role === 'dev') return { action: 'to_dev', to: 'dev' };
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
- Arch（架构/PM）：拆 module 与 feature、派 dev_do/dev_fix 给 Dev；所有 module 都 done 且回归通过后，发 uat_design 让 UAT 设计用户故事；人类确认 stories 后，发 uat_check 开考令进入验收。
- Dev：实现被指派的 feature，完成后用 to_arch 向 Arch 交付。
- UAT：收到 arch 的 uat_design 写 spec/uat_stories.md 并请人类 review（你收到后要果断确认或给修改意见）；收到 uat_check 后按 stories 全量逐个黑盒验收，完成后 to_arch 汇报。
- 你确认 stories 的方式：回消息给 Arch（如「stories 我确认了，开始验收」），Arch 会发 uat_check。
- 常见卡点：所有 module 已 done，但 Arch 没发 uat_design；或 stories 已确认，Arch 没发 uat_check —— 这时应指令 Arch 推进对应下一步。

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
  const logsDir = path.join(absWorkspace, 'logs');
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
  let lastLogSig = null;
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

  // agent 日志活跃度签名：logs/{arch,dev,uat}*.log 的总字节数 + 最新 mtime。
  // agent 每次工具调用返回都会往 stream-json 日志追加内容，所以只要它在干活（写代码、
  // 跑测试、等 server 起来后拿到结果），这个签名就会变——据此判断"还活着"，而不是看 action。
  function agentLogActivity() {
    let bytes = 0, latest = 0;
    let files = [];
    try { files = fs.readdirSync(logsDir); } catch { return '0:0'; }
    for (const f of files) {
      if (!f.endsWith('.log')) continue;
      const role = f.split(/[_.]/)[0];
      if (role !== 'arch' && role !== 'dev' && role !== 'uat') continue;
      try {
        const st = fs.statSync(path.join(logsDir, f));
        bytes += st.size;
        if (st.mtimeMs > latest) latest = st.mtimeMs;
      } catch {}
    }
    return `${bytes}:${Math.round(latest)}`;
  }

  function updateProgress() {
    const sig = progressSignature();
    const logSig = agentLogActivity();
    // 有进展 = action 级实质动作变化 或 agent 日志在增长/刷新。任一变化即重置停滞计时，
    // 保证"正在干活的长 session"不被误判停滞；只有两者都静默满 5min 才会 nudge。
    if (sig !== lastProgressSig || logSig !== lastLogSig) {
      lastProgressSig = sig;
      lastLogSig = logSig;
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

  // 停滞时该提醒谁：actions.jsonl 最后一条 to 是 arch/dev/uat 的消息，那个角色就欠下一个动作。
  // 跳过 note（纯回执噪音）。不需要 LLM 推断——实测 LLM 生成的指令经常是错的
  // （如判定"dev 卡死了 arch 你接管代写"，被 arch 正确顶回），笨而正确好过像样却错误。
  function pendingRole() {
    const actions = allActions();
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.action === 'note') continue;
      if (a.to === 'arch' || a.to === 'dev' || a.to === 'uat') return a.to;
    }
    return null;
  }

  // 通用提醒语：只提醒"继续推进"，不臆测卡住原因、不指派动作 —— agent 自己清楚该干什么。
  const NUDGE_MESSAGE = '你这边的动作停了 5 分钟以上。请检查你自己的进度，若无需人类决策的，请继续努力完成你的工作。';

  // 冷启动：项目刚建好，还没有任何发给 agent 的消息 —— 这不是"卡住"，
  // 而是"用户还没说第一句话"。用正常的需求陈述开场，不要用催办语气。
  function needsKickoff() {
    return pendingRole() === null;
  }

  function kickoff() {
    const routing = routeTo('arch');
    const message = [
      '你好，我们开始做这个项目。产品设计我已经写进 spec/app_design.md 了。请先认真读一遍，看完按你的流程执行。',
      '过程中需要我拍板的地方直接问我。',
    ].join('\n');
    appendAction(routing, message);
    lastNudgeTs = Date.now(); // 与 nudge 共用冷却，避免刚开场就紧接着催
    logger('[kickoff→arch] 项目开场：已把需求交给 Arch');
  }

  async function nudge() {
    const stalledSec = Math.round((Date.now() - lastProgressTs) / 1000);
    const role = pendingRole();
    if (!role) {
      lastNudgeTs = Date.now();
      nudgeCount++;
      logger(`[nudge] actions.jsonl 里没有待动作的角色，跳过（第 ${nudgeCount}/${MAX_NUDGES} 次）`);
      return;
    }

    const routing = routeTo(role);
    const message = `${NUDGE_MESSAGE}（已静默约 ${stalledSec}s）`;

    appendAction(routing, message);
    lastNudgeTs = Date.now();
    nudgeCount++;
    logger(`[nudge→${routing.to} #${nudgeCount}] 已静默 ${stalledSec}s`);
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
      lastLogSig = agentLogActivity();
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

        // 停滞检测：日志+动作静默超过阈值 + 冷却已过 + 未超推进上限 → 主动推进
        const stalledMs = Date.now() - lastProgressTs;
        if (stalledMs > STALL_THRESHOLD_MS && Date.now() - lastNudgeTs > NUDGE_COOLDOWN_MS) {
          if (needsKickoff()) {
            // 项目还没开场（没有任何发给 agent 的消息）：正常提需求，不占催办配额
            kickoff();
            updateProgress();
            saveState();
          } else if (nudgeCount < MAX_NUDGES) {
            logger(`[stall] 已 ${Math.round(stalledMs / 1000)}s 日志/动作静默，尝试推进（第 ${nudgeCount + 1}/${MAX_NUDGES} 次）`);
            await nudge();
            updateProgress();
            saveState();
          }
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
