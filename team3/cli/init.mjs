#!/usr/bin/env node
// init.mjs — Interactive `team3 init`: pick a Code CLI and write ~/.team3/config.json
//
// Usage:
//   node cli/init.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const TEAM3_HOME = path.join(os.homedir(), '.team3');
const CONFIG_PATH = path.join(TEAM3_HOME, 'config.json');

const CHOICES = [
  { type: 'qoder-code', command: 'qodercli', label: 'qodercli (qoder-code)' },
  { type: 'claude-code', command: 'claude', label: 'claude (claude-code)' },
];

function render(selected) {
  const lines = ['? 选择 Code CLI: (↑/↓ 选择，回车确认)'];
  CHOICES.forEach((c, i) => {
    lines.push(i === selected ? `\x1b[36m❯ ${c.label}\x1b[0m` : `  ${c.label}`);
  });
  return lines.join('\n');
}

function clearMenu(lineCount) {
  readline.moveCursor(process.stdout, 0, -lineCount);
  readline.clearScreenDown(process.stdout);
}

function selectInteractive() {
  return new Promise((resolve, reject) => {
    let selected = 0;
    const menuLines = CHOICES.length + 1;

    process.stdout.write(render(selected) + '\n');

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    const onKeypress = (_str, key) => {
      if (!key) return;
      if (key.name === 'up' || (key.name === 'k')) {
        selected = (selected - 1 + CHOICES.length) % CHOICES.length;
        clearMenu(menuLines);
        process.stdout.write(render(selected) + '\n');
      } else if (key.name === 'down' || key.name === 'j') {
        selected = (selected + 1) % CHOICES.length;
        clearMenu(menuLines);
        process.stdout.write(render(selected) + '\n');
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(CHOICES[selected]);
      } else if (key.name === 'c' && key.ctrl) {
        cleanup();
        reject(new Error('已取消'));
      }
    };

    function cleanup() {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    process.stdin.on('keypress', onKeypress);
  });
}

function writeConfig(choice) {
  fs.mkdirSync(TEAM3_HOME, { recursive: true });

  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      // corrupt config — start fresh, but keep a backup
      fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`);
      config = {};
    }
  }

  config.codeCli = { type: choice.type, command: choice.command };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

async function main() {
  let choice;
  if (process.stdin.isTTY) {
    choice = await selectInteractive();
  } else {
    // Non-interactive fallback: default to qoder-code
    choice = CHOICES[0];
    process.stdout.write(`非交互环境，默认选择 ${choice.label}\n`);
  }

  writeConfig(choice);
  process.stdout.write(`\n✓ 已写入 ${CONFIG_PATH}\n`);
  process.stdout.write(`  codeCli.type   = ${choice.type}\n`);
  process.stdout.write(`  codeCli.command = ${choice.command}\n`);
}

main().catch((err) => {
  process.stderr.write(`team3 init 失败: ${err.message}\n`);
  process.exit(1);
});
