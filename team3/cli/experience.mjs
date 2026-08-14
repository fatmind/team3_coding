// experience.mjs — Agent 经验库（spec/experience.md）的只读查询工具
//
// collaboration.md 改进项 0「经验怎么记」：
// - 存储 spec/experience.md，普通 markdown，三角色直接按 team3.md 格式追加（写入不走 cli）
// - 条目两层：一句话头部 + 固定字段正文（问题/原因/应该咋做/ref）
// - 本工具只管"省上下文地读"：list 查头部索引、show 看单条，避免开工全量灌入
//
// 条目格式（team3.md 定义）：
//   ## 日期 | 角色 | 一句话概述
//   - 问题: ...
//   - 原因: ...
//   - 应该咋做: ...
//   - ref: ...
//
// 用法（cwd = 项目工作区根目录）：
//   node cli/experience.mjs list        # 头部索引：#序号 | 日期 | 角色 | 一句话概述
//   node cli/experience.mjs show <序号>  # 单条全文
//   可选 --file <路径> 覆盖默认的 spec/experience.md

import fs from 'node:fs';
import path from 'node:path';

// 条目头：## 2026-07-28 | dev | 一句话概述
const ENTRY_HEADER_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|\s*(.+)$/;

function usage() {
  process.stderr.write([
    '用法:',
    '  node cli/experience.mjs list',
    '  node cli/experience.mjs show <序号>',
    '  可选: --file <experience.md 路径>（默认 spec/experience.md）',
    '',
    '写入不走本工具：按 team3.md 的条目格式直接追加 spec/experience.md',
    '',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { command: null, id: null, file: null };

  if (args.length === 0) return result;
  result.command = args[0];

  let i = 1;
  if (result.command === 'show' && args[1] && !args[1].startsWith('--')) {
    result.id = args[1];
    i = 2;
  }
  for (; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1] != null) { result.file = args[++i]; }
  }
  return result;
}

function resolveFilePath(fileArg) {
  return fileArg || path.join(process.cwd(), 'spec', 'experience.md');
}

// 解析 experience.md → 条目数组。序号 = 出现顺序（1 起），
// 头部行解析不出的内容归入上一条正文，不让格式瑕疵卡死整个库。
function loadEntries(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const entries = [];
  let current = null;
  for (const line of raw.split('\n')) {
    const match = line.match(ENTRY_HEADER_RE);
    if (match) {
      current = {
        id: entries.length + 1,
        date: match[1],
        role: match[2].trim(),
        title: match[3].trim(),
        body: [],
      };
      entries.push(current);
    } else if (current && line.trim()) {
      current.body.push(line);
    }
  }
  return entries;
}

function formatHeader(entry) {
  return `#${entry.id} | ${entry.date} | ${entry.role} | ${entry.title}`;
}

function cmdList(filePath) {
  const entries = loadEntries(filePath);
  if (entries.length === 0) {
    process.stdout.write('（经验库为空）\n');
    return;
  }
  for (const entry of entries) {
    process.stdout.write(formatHeader(entry) + '\n');
  }
}

function cmdShow(filePath, id) {
  if (!id) {
    process.stderr.write('show 需要指定序号，如: node cli/experience.mjs show 3\n');
    process.exit(1);
  }
  const entries = loadEntries(filePath);
  const numericId = parseInt(String(id).replace(/^#/, ''), 10);
  const entry = entries.find((e) => e.id === numericId);
  if (!entry) {
    process.stderr.write(`没有找到 #${numericId}，用 list 查看现有条目\n`);
    process.exit(1);
  }
  process.stdout.write([formatHeader(entry), ...entry.body].join('\n') + '\n');
}

function main() {
  const parsed = parseArgs(process.argv);
  const filePath = resolveFilePath(parsed.file);

  switch (parsed.command) {
    case 'list':
      cmdList(filePath);
      break;
    case 'show':
      cmdShow(filePath, parsed.id);
      break;
    default:
      usage();
      process.exit(1);
  }
}

main();
