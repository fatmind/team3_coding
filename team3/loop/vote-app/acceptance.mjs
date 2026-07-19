// acceptance.mjs — vote-app 产品验收（puppeteer，从用户视角 · 完整版 full profile）
//
// 与 harness 内部 Arch/UAT 验证解耦：这里只连"已经在跑的 dev server"，
// 从真实浏览器操作页面，验证最终产品行为。全绿 → 退出码 0，任一失败 → 退出码 1。
//
// 前提：vote-app dev server 已在 BASE_URL 运行（正常项目里 Dev 用 init.sh 起）。
//
// 供 run-regression 复用：导出 runAcceptance({ baseUrl, workspace, log }) → { passed, total, failed }。
// 直接执行时走 CLI：
//   node acceptance.mjs [--base-url http://localhost:3001] [--app-dir /abs/vote-app] [--headful]
//
// puppeteer-core 从 --app-dir/node_modules 解析（默认 ~/dev/workspace/vote-app）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    baseUrl: process.env.ACCEPTANCE_BASE_URL || 'http://localhost:3001',
    appDir: process.env.VOTE_APP_DIR || path.join(os.homedir(), 'dev', 'workspace', 'vote-app'),
    headful: false,
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === '--base-url' && args[i + 1]) out.baseUrl = args[++i];
    else if (k === '--app-dir' && args[i + 1]) out.appDir = args[++i];
    else if (k === '--headful') out.headful = true;
  }
  return out;
}

function findChrome() {
  for (const p of CHROME_PATHS) if (fs.existsSync(p)) return p;
  throw new Error(`Chrome 未找到，搜索路径: ${CHROME_PATHS.join(', ')}`);
}

function loadPuppeteer(appDir) {
  const candidates = [
    path.join(appDir, 'node_modules'),
    path.join(process.cwd(), 'node_modules'),
  ];
  const resolved = require.resolve('puppeteer-core', { paths: candidates });
  return import(pathToFileURL(resolved).href).then((m) => m.default || m);
}

const T = (id) => `[data-testid="${id}"]`;

/**
 * 从用户视角跑完整产品验收（6 项浏览器动线）。
 * @param {object} o
 * @param {string} o.baseUrl   产品 dev server 地址（默认 http://localhost:3001）
 * @param {string} o.workspace 产品目录（用于从 workspace/node_modules 解析 puppeteer-core）
 * @param {(m:string)=>void} [o.log] 过程输出
 * @param {boolean} [o.headful] 有头模式（调试）
 * @returns {Promise<{passed:number,total:number,failed:{name:string,detail:string}[]}>}
 */
export async function runAcceptance({ baseUrl = 'http://localhost:3001', workspace, log = (m) => process.stdout.write(m + '\n'), headful = false } = {}) {
  const appDir = workspace || process.env.VOTE_APP_DIR || path.join(os.homedir(), 'dev', 'workspace', 'vote-app');
  log(`acceptance(full): base=${baseUrl} appDir=${appDir}`);

  const results = [];
  const record = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  };
  const check = async (name, fn) => {
    try { record(name, true, (await fn()) || ''); }
    catch (e) { record(name, false, e.message); }
  };

  const puppeteer = await loadPuppeteer(appDir);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-chrome-'));
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: headful ? false : 'new',
    userDataDir,
    timeout: 60000,
    protocolTimeout: 60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  let surveyId = null;
  let voteUrl = null;

  try {
    // 1. 创建问卷（单选题 + 多选题）→ 拿到投票链接
    await check('创建问卷并拿到投票链接', async () => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.goto(`${baseUrl}/create`, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector(T('survey-title'), { timeout: 15000 });

      await page.type(T('survey-title'), '午餐去哪吃');
      // 题 0：单选
      await page.type(T('question-text-0'), '主食选哪个？');
      await page.select(T('question-type-0'), 'single');
      await page.type(T('option-input-0-0'), '米饭');
      await page.type(T('option-input-0-1'), '面条');
      // 题 1：多选
      await page.click(T('add-question'));
      await page.waitForSelector(T('question-text-1'), { timeout: 5000 });
      await page.select(T('question-type-1'), 'multiple');
      await page.type(T('question-text-1'), '想加什么小菜？（可多选）');
      await page.type(T('option-input-1-0'), '凉拌黄瓜');
      await page.type(T('option-input-1-1'), '花生米');

      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/surveys') && r.request().method() === 'POST', { timeout: 15000 }),
        page.click(T('submit-survey')),
      ]);
      await page.waitForSelector(T('success-panel'), { timeout: 15000 });
      surveyId = await page.$eval(T('survey-id'), (el) => el.textContent.trim());
      voteUrl = await page.$eval(T('vote-link-url'), (el) => el.value);
      await ctx.close();
      if (!/^s_[a-f0-9]{12}$/.test(surveyId)) throw new Error(`surveyId 格式异常: ${surveyId}`);
      if (!voteUrl || !voteUrl.includes(`/vote/${surveyId}`)) throw new Error(`vote 链接异常: ${voteUrl}`);
      return `id=${surveyId}`;
    });

    if (!surveyId) throw new Error('创建失败，后续步骤依赖 surveyId，中止');

    // 2. 投票者 A 投票 → 结果页显示 1 人参与
    await check('投票者 A 投票后结果页显示 1 人参与', async () => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.goto(voteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector(T('vote-title'), { timeout: 15000 });
      await page.click(T('control-0-0')); // 单选：米饭
      await page.click(T('control-1-0')); // 多选：凉拌黄瓜
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }),
        page.click(T('submit-vote')),
      ]);
      await page.waitForSelector(T('total-voters'), { timeout: 15000 });
      const txt = await page.$eval(T('total-voters'), (el) => el.textContent.trim());
      await ctx.close();
      if (!txt.includes('1')) throw new Error(`期望 1 人参与，实际 "${txt}"`);
      return txt;
    });

    // 3. 投票者 B 投不同选项 → 2 人参与，单选题各 50%
    await check('投票者 B 投票后结果页显示 2 人参与且百分比正确', async () => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.goto(voteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector(T('vote-title'), { timeout: 15000 });
      await page.click(T('control-0-1')); // 单选：面条（与 A 不同）
      await page.click(T('control-1-1')); // 多选：花生米
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }),
        page.click(T('submit-vote')),
      ]);
      await page.waitForSelector(T('total-voters'), { timeout: 15000 });
      const total = await page.$eval(T('total-voters'), (el) => el.textContent.trim());
      const p00 = await page.$eval(T('bar-0-0-percent'), (el) => el.textContent.trim());
      const p01 = await page.$eval(T('bar-0-1-percent'), (el) => el.textContent.trim());
      await ctx.close();
      if (!total.includes('2')) throw new Error(`期望 2 人参与，实际 "${total}"`);
      if (p00 !== '50%' || p01 !== '50%') throw new Error(`期望单选题各 50%，实际 ${p00} / ${p01}`);
      return `${total}, ${p00}/${p01}`;
    });

    // 4. 投票者 A 再次提交 → 提示"你已经投过票了"
    await check('投票者 A 重复投票被拦（已投过）', async () => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      // 先投一票建立该 context 的 voterId
      await page.goto(voteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector(T('vote-title'), { timeout: 15000 });
      await page.click(T('control-0-0'));
      await page.click(T('control-1-0'));
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }),
        page.click(T('submit-vote')),
      ]);
      // 同 context 再次进入投票页并尝试提交 → 409 → duplicate 提示
      await page.goto(voteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector(T('vote-title'), { timeout: 15000 });
      await page.click(T('control-0-1'));
      await page.click(T('control-1-1'));
      await page.click(T('submit-vote'));
      await page.waitForSelector(T('vote-duplicate'), { timeout: 15000 });
      const txt = await page.$eval(T('vote-duplicate'), (el) => el.textContent);
      await ctx.close();
      if (!txt.includes('你已经投过票了')) throw new Error(`未见"已投过"提示，实际 "${txt.slice(0, 40)}"`);
      return '已拦截';
    });

    // 5. 关闭问卷后 → 投票页提示"投票已结束"
    await check('问卷关闭后投票页提示已结束', async () => {
      const res = await fetch(`${baseUrl}/api/surveys/${surveyId}/close`, { method: 'POST' });
      if (res.status !== 200) throw new Error(`关闭接口返回 ${res.status}`);
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.goto(voteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector(T('vote-closed'), { timeout: 15000 });
      const txt = await page.$eval(T('vote-closed'), (el) => el.textContent);
      await ctx.close();
      if (!txt.includes('投票已结束')) throw new Error(`未见"已结束"提示，实际 "${txt.slice(0, 40)}"`);
      return '已结束';
    });

    // 6. 不存在的问卷 → 提示"问卷不存在"
    await check('访问不存在的问卷提示不存在', async () => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.goto(`${baseUrl}/vote/s_ffffffffffff`, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector(T('vote-notfound'), { timeout: 15000 });
      const txt = await page.$eval(T('vote-notfound'), (el) => el.textContent);
      await ctx.close();
      if (!txt.includes('问卷不存在')) throw new Error(`未见"不存在"提示，实际 "${txt.slice(0, 40)}"`);
      return 'ok';
    });
  } finally {
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }

  const failed = results.filter((r) => !r.ok).map((r) => ({ name: r.name, detail: r.detail }));
  return { passed: results.length - failed.length, total: results.length, failed };
}

// --- CLI ---

async function main() {
  const { baseUrl, appDir, headful } = parseArgs(process.argv);
  const { passed, total, failed } = await runAcceptance({ baseUrl, workspace: appDir, headful });
  process.stdout.write(`\n=== acceptance: ${passed}/${total} 通过 ===\n`);
  if (failed.length) {
    process.stdout.write(`失败: ${failed.map((f) => f.name).join('; ')}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    process.stderr.write(`acceptance 运行异常: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
