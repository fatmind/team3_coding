// acceptance.mjs — vote-app 产品验收（精简版：只验 POST /create）
//
// 与 harness 内部 Arch/UAT 验证解耦：这里只连"已经在跑的 dev server"，
// 通过 HTTP 调用创建接口，验证最终产品行为。全绿 → 退出码 0，任一失败 → 退出码 1。
//
// 前提：vote-app dev server 已在 BASE_URL 运行（正常项目里 Dev 用 init.sh 起）。
//
// 用法：
//   node acceptance.mjs [--base-url http://localhost:3001] [--workspace /abs/vote-app]
//
// 精简范围：只实现了 module_1 的 POST /create，故这里只验：
//   1) 合法创建 → 200 + { id: "s_xxxxxxxxxxxx" }
//   2) 落盘文件 data/surveys/{id}.json 存在且内容一致
//   3) 缺 title → 400
//   4) type 非法 → 400
//   5) options 少于 2 项 → 400

import fs from 'node:fs';
import path from 'node:path';

export function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    baseUrl: process.env.ACCEPTANCE_BASE_URL || 'http://localhost:3001',
    workspace: process.env.VOTE_APP_DIR || null,
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === '--base-url' && args[i + 1]) out.baseUrl = args[++i];
    else if ((k === '--workspace' || k === '--app-dir') && args[i + 1]) out.workspace = args[++i];
  }
  return out;
}

async function postCreate(baseUrl, body) {
  const res = await fetch(`${baseUrl}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const validSurvey = () => ({
  title: '午餐去哪吃',
  description: '团队午餐投票',
  questions: [
    { text: '主食选哪个？', type: 'single', options: ['米饭', '面条'] },
    { text: '想加什么小菜？', type: 'multiple', options: ['凉拌黄瓜', '花生米'] },
  ],
});

// 运行所有验收断言，返回 { passed, total, failed:[{name,detail}] }
export async function runAcceptance({ baseUrl, workspace, log = (m) => process.stdout.write(m + '\n') }) {
  const results = [];
  const record = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  };
  const check = async (name, fn) => {
    try { record(name, true, (await fn()) || ''); }
    catch (e) { record(name, false, e.message); }
  };

  log(`acceptance: base=${baseUrl} workspace=${workspace || '(未提供，跳过落盘校验)'}`);

  let surveyId = null;

  // 1. 合法创建 → 200 + id
  await check('合法创建问卷 → 200 + id', async () => {
    const { status, json } = await postCreate(baseUrl, validSurvey());
    if (status !== 200) throw new Error(`期望 200，实际 ${status}`);
    if (!json || typeof json.id !== 'string') throw new Error(`响应缺少 id 字段: ${JSON.stringify(json)}`);
    if (!/^s_[a-f0-9]{12}$/.test(json.id)) throw new Error(`id 格式异常: ${json.id}`);
    surveyId = json.id;
    return `id=${surveyId}`;
  });

  // 2. 落盘文件存在且内容一致
  await check('落盘 data/surveys/{id}.json 存在且一致', async () => {
    if (!surveyId) throw new Error('无 surveyId，依赖第 1 步');
    if (!workspace) throw new Error('未提供 workspace，无法校验落盘（可用 --workspace 指定）');
    const file = path.join(path.resolve(workspace), 'data', 'surveys', `${surveyId}.json`);
    if (!fs.existsSync(file)) throw new Error(`文件不存在: ${file}`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (saved.id !== surveyId) throw new Error(`文件内 id 不一致: ${saved.id}`);
    if (!Array.isArray(saved.questions) || saved.questions.length !== 2) throw new Error(`题目数异常: ${saved.questions?.length}`);
    return path.basename(file);
  });

  // 3. 缺 title → 400
  await check('缺 title → 400', async () => {
    const body = validSurvey(); delete body.title;
    const { status } = await postCreate(baseUrl, body);
    if (status !== 400) throw new Error(`期望 400，实际 ${status}`);
    return 'ok';
  });

  // 4. type 非法 → 400
  await check('题目 type 非法 → 400', async () => {
    const body = validSurvey(); body.questions[0].type = 'ranking';
    const { status } = await postCreate(baseUrl, body);
    if (status !== 400) throw new Error(`期望 400，实际 ${status}`);
    return 'ok';
  });

  // 5. options 少于 2 项 → 400
  await check('选项少于 2 项 → 400', async () => {
    const body = validSurvey(); body.questions[0].options = ['只有一个'];
    const { status } = await postCreate(baseUrl, body);
    if (status !== 400) throw new Error(`期望 400，实际 ${status}`);
    return 'ok';
  });

  const failed = results.filter((r) => !r.ok);
  log(`\n=== acceptance: ${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length) log(`失败: ${failed.map((f) => f.name).join('; ')}`);
  return { passed: results.length - failed.length, total: results.length, failed };
}

async function main() {
  const { baseUrl, workspace } = parseArgs(process.argv);
  const { failed } = await runAcceptance({ baseUrl, workspace });
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((err) => { process.stderr.write(`acceptance 运行异常: ${err.stack || err.message}\n`); process.exit(1); });
}
