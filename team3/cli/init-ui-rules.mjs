#!/usr/bin/env node
// init-ui-rules.mjs — Inject StyleSeed UI rules into a managed project
//
// Usage:
//   node cli/init-ui-rules.mjs <目标项目路径> --brand <品牌名>
//
// Example:
//   node cli/init-ui-rules.mjs ./my-app --brand mintlify

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultStyleSeedDir,
  ensureStyleSeedCache,
  parseCliArgs,
  runInitUiRules,
} from './init-ui-rules-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  process.stderr.write(
    '用法: node init-ui-rules.mjs <目标项目路径> --brand <品牌名> [--styleseed-dir <path>] [--force]\n' +
    '示例: node init-ui-rules.mjs ./my-app --brand mintlify\n',
  );
}

async function main() {
  const parsed = parseCliArgs(process.argv);
  if (!parsed?.targetDir || !parsed.brand) {
    usage();
    process.exit(1);
  }

  const styleseedDir = parsed.styleseedDir || defaultStyleSeedDir();

  try {
    ensureStyleSeedCache(styleseedDir);
    await runInitUiRules({
      targetDir: parsed.targetDir,
      brand: parsed.brand,
      styleseedDir,
      skipExisting: !parsed.force,
      log: (msg) => process.stdout.write(`${msg}\n`),
    });
  } catch (err) {
    process.stderr.write(`init-ui-rules 失败: ${err.message}\n`);
    process.exit(1);
  }
}

main();
