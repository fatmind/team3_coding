// write-action.mjs — Agent 写 actions.jsonl 的唯一入口
//
// 用法：
//   node cli/write-action.mjs <actions.jsonl路径> \
//     --action dev_do --from arch --to dev --message "请实现 Feature #5..."
//
// 自动生成 ts（unix 秒级时间戳），JSON.stringify 保证单行，appendFileSync 原子追加。
//
// to_human 判卷（loop_hackathon5 改进项 1）：
//   Agent 发给人类的消息，在写入前用"干净上下文 LLM"按七条自查标准判卷。
//   不过 → exit 1 + stderr 输出未过项，Agent 同一轮看到失败原因、改写重发。
//   判卷不可用（无配置/超时/输出不可解析）→ fail-open 照写，宁可放过不制造消息黑洞。
//   判卷命令来自 ~/.team3/config.json 的 codeCli（与 daemon provider 映射一致）。
//   环境变量：TEAM3_JUDGE_SKIP=1 跳过判卷；TEAM3_JUDGE_CMD 覆盖判卷命令（测试用）；
//             TEAM3_JUDGE_TIMEOUT_MS 判卷超时（默认 90000）。
//   TODO：本工具无状态，没法记 attempt 计数做"最多回炉 N 次"兜底，后续解决。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const VALID_ACTIONS = ['to_arch', 'to_dev', 'to_uat', 'dev_do', 'dev_fix', 'to_human', 'uat_design', 'uat_check', 'uat_fix', 'note'];
const VALID_ROLES = ['arch', 'dev', 'uat', 'human', ''];

// to_dev / to_uat 是人类专属通道：纯消息、复用当前 session、不改变任务验收标准。
// Agent 之间派活/退回必须用 dev_do/dev_fix/uat_design/uat_check/uat_fix——语义和 session
// 生命周期都不同，这里硬校验防止 arch 拿 to_dev 绕过 dev_fix 的验收退回流程。
const HUMAN_ONLY_ACTIONS = ['to_dev', 'to_uat'];

const CODE_CLI_COMMANDS = {
  'claude-code': 'claude',
  'qoder-code': 'qodercli',
  'qodercli': 'qodercli',
};

const JUDGE_PROMPT_TEMPLATE = `team3 是"人类 × 三个 Agent（Arch/Dev/UAT）"协作开发的系统，Agent 发给人类的 to_human 消息是 "人类做决策、协作 Agent" 的唯一窗口。

## 判卷目的
你只放行"真正需要人类决策、且大白话说清了"的消息，保护人类的决策精力。
历史教训：Agent 一次平铺 5 个问题、方向和实现细节混杂、把没做完的分析递给人类挑、拿通用最佳实践硬凑方案——人类被迫当分析器和轮询器，协作失效。你在消息写入前把关。你看不到项目其它上下文，只依据消息本身判断；拿不准时，按检查项的字面标准从严判。

## 第一步：分类（三类取一，各有固定开头标记）
- decision（要人拍板）：请人类对方向、取舍、方案做决策。开头标记【老板你定】
- ask（要人给输入）：请人类提供 Agent 自己拿不到的东西——信息、资料、权限，或对产出的 review 确认。开头标记【求你补充】
- notify（通知报备）：交付、进展、验收结果的单向告知，人类不回复也不阻塞。开头标记【随带说下】

先按内容判断真实类型，再看开头标记：缺标记、或标记与真实类型不符（如拿【随带说下】的头夹带要人决策的事），都记 fails id "格式"。

## 第二步：按类检查（每条判 yes/no，任一 no 即不合格）

【decision 类】查 格式 + ①~⑧：
- 格式：完整符合下面的模板，缺任一块即不合格（开头用 **老板你定** 或【老板你定】均可；**自查约束** 是发送方声明自查过哪些检查项）：
  \`\`\`
  **老板你定**
  <大白话一句，带上"不这么做会怎样">
  **思考逻辑**
  1~3 条，每条一行
  **自查约束**
  ①~⑧ 过
  \`\`\`
- ①值得问（防无效提问）：假设不问、直接干了，人类事后发现会发火/要求返工吗？不会 → 不该来问，应直接干、之后在交付消息里报备
- ②敢质疑（防在错误基础上打补丁）：若消息显示同一问题已修复多轮、或建议的前提被人类否定过，要拍的板必须是"方向还继不继续"，而不是请批下一个补丁
- ③一次一个（防平铺多问）：只允许一个决策点；多个问题排成 1、2、3 平铺即不合格——应先问最上层的那一个，拍完再往下拆
- ④分析做完（防让人类替 Agent 思考）：出现"或者 / 都可以 / 看你 / 你觉得 / 方案A方案B"等把选择推回人类的表述即不合格，只能给一个最优建议
- ⑤不套模板（防通用做法填空、防旧方向惯性）：内容必须从"当前阶段要什么"推出；把上线级机制（训练/测试切分、冻结后不改、防作弊、审计/哈希链、逐条反查等）塞进早期跑通阶段、或为显得完整硬凑分类，即不合格
- ⑥新人能懂（防黑话/大话/排比）：一个不了解项目的新人读完，能复述出"要我决定什么、不这么做会怎样"；黑话、排比口号、空洞大词即不合格
- ⑦无细节稀释（防重要信号被淹没）：删掉某句人类也不会做错判断的，都是多余细节；文件名、函数名、字段名、代码、表格、commit log 默认全是细节，大段出现即不合格
- ⑧排版分行（防挤成一段没法读）：超过两句话的消息必须按要点/步骤分行；长消息无任何换行、挤成一整段即不合格

【ask 类】查 格式 + ①③④⑥⑦⑧（格式只要求【求你补充】开头、说清"要什么 + 为什么 Agent 自己拿不到"；①改判："这东西 Agent 自己真拿不到吗？能自己查文档、看代码、跑一下试出来的，不许问人"）
【notify 类】查 ⑤⑥⑦⑧（格式只要求【随带说下】开头）

## 输出
严格 JSON、单个对象、不输出任何其它内容。fails 为空数组表示通过；reason 一行大白话，内部禁止出现英文双引号（引用原文用「」）：
{"type":"decision","pass":false,"fails":[{"id":"④","reason":"一行原因"}]}

## 待判消息
<<<
__MESSAGE__
>>>`;

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 1) return null;

  const filePath = args[0];
  const result = { filePath, action: null, from: null, to: null, message: null };

  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    const val = args[i + 1];
    if (key === '--action' && val != null) { result.action = val; i++; }
    else if (key === '--from' && val != null) { result.from = val; i++; }
    else if (key === '--to' && val != null) { result.to = val; i++; }
    else if (key === '--message' && val != null) { result.message = val; i++; }
  }

  return result;
}

// 解析判卷命令：TEAM3_JUDGE_CMD 优先（测试注入），否则读全局 codeCli 配置
function resolveJudgeCommand() {
  if (process.env.TEAM3_JUDGE_CMD) return process.env.TEAM3_JUDGE_CMD;

  const configPath = path.join(os.homedir(), '.team3', 'config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw);
  const codeCli = config.codeCli || {};
  const command = codeCli.command || CODE_CLI_COMMANDS[codeCli.type];
  if (!command) throw new Error(`无法从 ${configPath} 解析 codeCli 命令（type: "${codeCli.type}"）`);
  return command;
}

// 从判卷 stdout 里提取 JSON 对象（容忍 LLM 输出前后夹杂文字）
function extractJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fallthrough */ }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) {
      try { return JSON.parse(trimmed); } catch { /* next line */ }
    }
  }
  return null;
}

// 从 stream-json 输出里取最终回复文本（type=result 行的 result 字段）。
// 判卷用 stream-json 是为了让 stdout 能原样落盘成和 agent 日志同构的日志；
// 但结论要从 result 文本里读，不能直接扫 stdout —— 否则会抓到 stream-json 的信封。
function extractResultText(stdout) {
  let text = null;
  for (const line of (stdout || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    if (o.type === 'result' && typeof o.result === 'string') text = o.result;
  }
  return text;
}

// 判卷原始输出落盘：logs/judge_<date>.log，与 arch_/dev_/uat_ 日志同构。
// token 口径对齐 daemon：code CLI 的 usage / modelUsage 都报 0，agent 日志里的
// token 是 daemon 的 stdout 解析器按 chars/4 估算后覆写进 usage 的
// （见 daemon/src/agent-scheduler.js 的 result 分支）。判卷绕过 daemon，
// 所以这里对 result 行做同样的估算注入，否则统计出来永远是 0。
function appendJudgeLog(actionsFilePath, stdout, promptChars) {
  try {
    const workspace = path.resolve(path.dirname(actionsFilePath), '..');
    const logDir = path.join(workspace, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);

    const out = [];
    for (const line of (stdout || '').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let o = null;
      if (t.startsWith('{')) {
        try { o = JSON.parse(t); } catch { /* 非 JSON 行原样保留 */ }
      }
      if (o && o.type === 'result') {
        const outChars = typeof o.result === 'string' ? o.result.length : 0;
        if (!o.usage) o.usage = {};
        o.usage.input_tokens = Math.round(promptChars / 4);
        o.usage.output_tokens = Math.round(outChars / 4);
        o._token_estimate = { input_chars: promptChars, output_chars: outChars };
        out.push(JSON.stringify(o));
      } else {
        out.push(t);
      }
    }
    if (out.length) fs.appendFileSync(path.join(logDir, `judge_${date}.log`), out.join('\n') + '\n');
  } catch { /* 落盘失败不阻塞判卷结论 */ }
}

// 判卷：返回 { verdict: 'pass' | 'fail' | 'unavailable', fails, detail, stdout }
function judgeMessage(message) {
  let promptChars = 0;
  let command;
  try {
    command = resolveJudgeCommand();
  } catch (err) {
    return { verdict: 'unavailable', detail: err.message, promptChars };
  }

  const prompt = JUDGE_PROMPT_TEMPLATE.replace('__MESSAGE__', message);
  promptChars = prompt.length;
  const timeoutMs = Number(process.env.TEAM3_JUDGE_TIMEOUT_MS) || 90000;

  const res = spawnSync(command, ['-p', prompt, '--output-format', 'stream-json'], {
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = res.stdout || '';

  if (res.error) return { verdict: 'unavailable', detail: res.error.message, stdout, promptChars };
  if (res.status !== 0) return { verdict: 'unavailable', detail: `判卷进程 exit ${res.status}: ${(res.stderr || '').substring(0, 200)}`, stdout, promptChars };

  // stream-json 解析不出 result 行时退回原始 stdout，保持兜底行为
  const verdictText = extractResultText(stdout) ?? stdout;
  const parsed = extractJsonObject(verdictText);
  if (!parsed || typeof parsed.pass !== 'boolean') {
    // JSON 坏了（如 reason 里带未转义引号）也不放行：结论字段还在文本里，正则兜底
    if (/"pass"\s*:\s*false/.test(verdictText)) {
      return { verdict: 'fail', fails: [{ id: '?', reason: `判卷 JSON 损坏，原文摘录: ${verdictText.substring(0, 300)}` }], stdout, promptChars };
    }
    if (/"pass"\s*:\s*true/.test(verdictText)) return { verdict: 'pass', stdout, promptChars };
    return { verdict: 'unavailable', detail: `判卷输出不可解析: ${verdictText.substring(0, 200)}`, stdout, promptChars };
  }

  if (parsed.pass) return { verdict: 'pass', stdout, promptChars };
  return { verdict: 'fail', fails: Array.isArray(parsed.fails) ? parsed.fails : [], type: parsed.type, stdout, promptChars };
}

function main() {
  const parsed = parseArgs(process.argv);

  if (!parsed || !parsed.filePath) {
    process.stderr.write('用法: node write-action.mjs <actions.jsonl路径> --action <type> --from <role> --to <target> --message "..."\n');
    process.exit(1);
  }

  const errors = [];

  if (!parsed.action || !VALID_ACTIONS.includes(parsed.action)) {
    errors.push(`--action 必须是 ${VALID_ACTIONS.join(' / ')}，收到: "${parsed.action}"`);
  }
  if (parsed.from == null || !VALID_ROLES.includes(parsed.from)) {
    errors.push(`--from 必须是 ${VALID_ROLES.filter(r => r).join(' / ')}，收到: "${parsed.from}"`);
  }
  if (parsed.to == null || !VALID_ROLES.includes(parsed.to)) {
    errors.push(`--to 必须是 ${VALID_ROLES.join(' / ')}（可为空串），收到: "${parsed.to}"`);
  }
  if (!parsed.message) {
    errors.push('--message 不能为空');
  }
  if (parsed.action && HUMAN_ONLY_ACTIONS.includes(parsed.action) && parsed.from !== 'human') {
    errors.push(`${parsed.action} 仅人类可发（人类专属消息通道）。Agent 请改用：汇报/提问用 to_arch，派活用 dev_do / uat_design，退回修复用 dev_fix / uat_fix。`);
  }

  if (errors.length > 0) {
    process.stderr.write(errors.join('\n') + '\n');
    process.exit(1);
  }

  // Agent 消息长度门：协议要求 350 字内，校验阈值 500 字留 buffer 避免频繁重写；
  // 超限拒绝（截断会切掉尾部 [reread:...]，宁拒不切）。
  // human 发的不管；note 仅落盘不转发，不占对方上下文。to_human 同样受限。
  const needLengthCheck = parsed.from !== 'human' && parsed.action !== 'note';
  const maxLen = Number(process.env.TEAM3_AGENT_MSG_MAX) || 500;
  if (needLengthCheck && parsed.message.length > maxLen) {
    process.stderr.write(
      `[length] 消息硬限 ${maxLen} 字（协议要求 350 字内），当前 ${parsed.message.length} 字，本条未写入。\n` +
      `细节写进 spec 文件（progress/report 等），消息只留结论 + 文件指针，末尾带 [reread: <文件>]，改短后重新调用本工具。\n`
    );
    process.exit(1);
  }

  // to_human 判卷：仅 Agent → 人类的消息，人类自己发的不判
  const needJudge = parsed.action === 'to_human'
    && parsed.from !== 'human'
    && process.env.TEAM3_JUDGE_SKIP !== '1';

  if (needJudge) {
    const result = judgeMessage(parsed.message);
    appendJudgeLog(parsed.filePath, result.stdout || '', result.promptChars || 0);
    process.stderr.write(`[judge] ${result.verdict}\n`);
    if (result.verdict === 'fail') {
      const lines = ['[judge] to_human 消息判卷未通过，本条未写入。未过项：'];
      for (const f of (result.fails.length > 0 ? result.fails : [{ id: '?', reason: '判卷未给出明细' }])) {
        lines.push(`  ${f.id}: ${f.reason}`);
      }
      lines.push('请按未过项修改 --message 后重新调用本工具。三类消息各有固定开头：要人决策【老板你定】（+ 一句大白话建议带"不这么做会怎样" + **思考逻辑** 1~3 条 + **自查约束**）；要人给输入【求你补充】；纯通知【随带说下】。');
      process.stderr.write(lines.join('\n') + '\n');
      process.exit(1);
    }
    if (result.verdict === 'unavailable') {
      process.stderr.write(`[judge] 判卷不可用（${result.detail}），本条放行\n`);
    }
  }

  const entry = {
    action: parsed.action,
    from: parsed.from,
    to: parsed.to,
    ts: Math.floor(Date.now() / 1000),
    message: parsed.message,
  };

  const line = JSON.stringify(entry) + '\n';

  try {
    const dir = path.dirname(parsed.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(parsed.filePath, line, 'utf-8');
  } catch (err) {
    process.stderr.write(`写入失败: ${err.message}\n`);
    process.exit(1);
  }
}

main();
