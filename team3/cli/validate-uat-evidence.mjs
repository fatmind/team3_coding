#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  return '用法: node cli/validate-uat-evidence.mjs [spec/uat_report.md 或 uat-evidence.json]';
}

function readJsonBlocks(content) {
  const blocks = [];
  const regex = /```uat-evidence\s*([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function parseEvidenceFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (path.basename(filePath).endsWith('.json')) {
    return [{ source: filePath, evidence: JSON.parse(content) }];
  }

  const blocks = readJsonBlocks(content);
  if (blocks.length === 0) {
    throw new Error(`${filePath} 中没有 uat-evidence 代码块`);
  }

  return blocks.map((block, index) => ({
    source: `${filePath}#uat-evidence-${index + 1}`,
    evidence: JSON.parse(block),
  }));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isEnabled(value) {
  if (value === true) return true;
  if (value && typeof value === 'object') {
    return value.required === true || value.used === true;
  }
  return false;
}

function hasLogMarker(logContent, marker) {
  return logContent.includes(marker);
}

function resolveWorkspace(inputPath) {
  const abs = path.resolve(inputPath);
  const parts = abs.split(path.sep);
  const specIdx = parts.lastIndexOf('spec');
  const uatIdx = parts.lastIndexOf('uat');
  const idx = specIdx >= 0 ? specIdx : uatIdx;
  if (idx > 0) {
    return parts.slice(0, idx).join(path.sep) || path.sep;
  }
  return process.cwd();
}

function validateEvidence(evidence, options) {
  const { workspace, source } = options;
  const errors = [];

  if (!Number.isInteger(evidence.story_id) || evidence.story_id <= 0) {
    errors.push('story_id 必须是正整数');
  }

  if (!evidence.verify_script || typeof evidence.verify_script !== 'string') {
    errors.push('verify_script 必须存在');
  }

  const verifyPath = evidence.verify_script
    ? path.resolve(workspace, evidence.verify_script)
    : null;
  if (verifyPath && !fs.existsSync(verifyPath)) {
    errors.push(`verify_script 不存在: ${evidence.verify_script}`);
  }

  for (const screenshot of toArray(evidence.screenshots)) {
    const screenshotPath = path.resolve(workspace, screenshot);
    if (!fs.existsSync(screenshotPath)) {
      errors.push(`截图不存在: ${screenshot}`);
    }
  }

  const statePath = path.resolve(workspace, 'uat/state.json');
  if (!fs.existsSync(statePath)) {
    errors.push('缺少 uat/state.json');
  }

  let verifyContent = '';
  if (verifyPath && fs.existsSync(verifyPath)) {
    verifyContent = fs.readFileSync(verifyPath, 'utf-8');
    if (verifyContent.includes("fetch('/api") || verifyContent.includes('fetch("/api')) {
      errors.push('verify_script 禁止直接 fetch /api');
    }
    if (/import\s+[^;]*['"][^'"]*src\//.test(verifyContent) || /from\s+['"][^'"]*src\//.test(verifyContent)) {
      errors.push('verify_script 禁止 import src/ 业务代码');
    }
  }

  const logPath = path.resolve(workspace, 'logs/uat.log');
  const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';

  if (isEnabled(evidence.simulate_human)) {
    if (!logContent) {
      errors.push('simulate_human 标记为使用，但缺少 logs/uat.log');
    } else if (!hasLogMarker(logContent, 'simulate_human')) {
      errors.push('simulate_human 标记为使用，但 logs/uat.log 无 simulate_human 证据');
    }
  }

  if (isEnabled(evidence.puppeteer)) {
    if (!verifyContent.includes('puppeteer') && !verifyContent.includes('launchBrowser')) {
      errors.push('puppeteer 标记为使用，但 verify_script 无 puppeteer/launchBrowser 证据');
    }
  }

  return errors.map(message => `${source}: ${message}`);
}

function main() {
  const input = process.argv[2] || 'spec/uat_report.md';
  const inputPath = path.resolve(input);
  if (!fs.existsSync(inputPath)) {
    process.stderr.write(`${usage()}\n文件不存在: ${input}\n`);
    process.exit(1);
  }

  try {
    const workspace = resolveWorkspace(inputPath);
    const entries = parseEvidenceFile(inputPath);
    const errors = entries.flatMap(entry => validateEvidence(entry.evidence, {
      workspace,
      source: entry.source,
    }));

    if (errors.length > 0) {
      process.stderr.write(errors.join('\n') + '\n');
      process.exit(1);
    }

    process.stdout.write(`UAT evidence OK (${entries.length})\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

main();
