// write-action.mjs — Agent 写 actions.jsonl 的唯一入口
//
// 用法：
//   node cli/write-action.mjs <actions.jsonl路径> \
//     --action dev_do --from arch --to dev --message "请实现 Feature #5..."
//
// 自动生成 ts（unix 秒级时间戳），JSON.stringify 保证单行，appendFileSync 原子追加。

import fs from 'node:fs';
import path from 'node:path';

const VALID_ACTIONS = ['to_arch', 'dev_do', 'dev_fix', 'to_human', 'uat_design', 'uat_check', 'uat_fix', 'note'];
const VALID_ROLES = ['arch', 'dev', 'uat', 'human', ''];

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

  if (errors.length > 0) {
    process.stderr.write(errors.join('\n') + '\n');
    process.exit(1);
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
