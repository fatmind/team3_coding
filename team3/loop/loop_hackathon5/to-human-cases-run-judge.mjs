// run-judge-cases.mjs — collaboration.md 改进项 1「怎么做（三）」的验收 runner
//
// 固定测试用例（to-human-cases.json）：
//   reject-283/289/295：lazada-hackathon5 archive/actions.jsonl 第 283/289/295 行（0-based）
//     的 arch to_human 原稿，即 collaboration.md 表格里 #284/#290/#296 复发点的上一条
//     arch 消息——判卷必须拒掉
//   pass-good：手写合格拍板消息——判卷必须通过
//
// 用真实 LLM 跑（走 write-action.mjs 的判卷路径），改判卷 prompt / 换模型后重跑回归：
//   node loop/loop_hackathon5/to-human-cases-run-judge.mjs           # 全量
//   node loop/loop_hackathon5/to-human-cases-run-judge.mjs <caseId>  # 单跑某条

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WRITE_ACTION = path.join(ROOT, 'cli', 'write-action.mjs');
const ALL_CASES = JSON.parse(fs.readFileSync(path.join(HERE, 'to-human-cases.json'), 'utf-8'));
const onlyId = process.argv[2];
const CASES = onlyId ? ALL_CASES.filter(c => c.id === onlyId) : ALL_CASES;
if (CASES.length === 0) {
  console.error(`没有 id 为 "${onlyId}" 的用例。可选：${ALL_CASES.map(c => c.id).join(', ')}`);
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cases-'));
let failed = 0;

for (const c of CASES) {
  const jsonlPath = path.join(tmpDir, c.id, 'actions.jsonl');
  const started = Date.now();
  const res = spawnSync('node', [
    WRITE_ACTION, jsonlPath,
    '--action', 'to_human', '--from', 'arch', '--to', 'human',
    '--message', c.message,
  ], {
    encoding: 'utf-8',
    // 放大长度门：本 runner 只回归判卷质量，283/289 等长用例不能被长度门提前拦掉
    env: { ...process.env, TEAM3_AGENT_MSG_MAX: '100000' },
  });

  const written = fs.existsSync(jsonlPath);
  const actual = res.status === 0 && written ? 'pass' : 'fail';
  // fail-open（判卷不可用）不算判卷结论，单独标记
  const unavailable = /判卷不可用/.test(res.stderr || '');
  const ok = !unavailable && actual === c.expect;

  const tag = unavailable ? 'UNAVAILABLE' : (ok ? 'OK' : 'FAIL');
  console.log(`[${tag}] ${c.id} expect=${c.expect} actual=${actual} (${((Date.now() - started) / 1000).toFixed(1)}s) — ${c.note}`);
  if (!ok) {
    failed++;
    if (res.stderr) console.log(res.stderr.trim().split('\n').map(l => '    ' + l).join('\n'));
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(failed === 0 ? `\n全部 ${CASES.length} 条用例符合预期` : `\n${failed}/${CASES.length} 条用例不符合预期`);
process.exit(failed === 0 ? 0 : 1);
