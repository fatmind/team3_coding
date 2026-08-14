// simulate_human.mjs — 模拟被开发产品的最终用户
// UAT agent 调用此工具生成人类决策/内容，自己写 puppeteer 代码执行
//
// 用法：
//   import { createHumanSimulator } from './simulate_human.mjs';
//   const human = createHumanSimulator({ workspace: '/abs/path' });
//   const reply = await human.ask('你是群主，现在要创建一个周六的羽毛球活动，请给出活动信息 JSON');
//   // reply = { content: '{"venue":"阳光馆","date":"2026-06-01","time":"14:00-16:00"}' }

import { execSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SYSTEM_PROMPT = `你是一个真实用户，正在使用一款产品。
你的任务是根据上下文，模拟真实用户的决策和输入。

规则：
- 只输出用户会产生的内容（文字、选择、数据），不要输出操作步骤
- 内容要自然、合理，像真人会写的
- 如果要求 JSON 格式输出，严格按 JSON 输出，不加多余解释
- 每次回答保持角色一致性（记住之前的决策）`;

const MAX_RETRIES = 2;
const TIMEOUT_MS = 60_000;

const CODE_CLI_COMMANDS = { 'claude-code': 'claude', 'qoder-code': 'qodercli' };

// 本机 code CLI 命令由 ~/.team3/config.json 的 codeCli 决定（如 qoder-code → qodercli）。
// 不能硬编码：命令不存在时 execFileSync 报的是 ENOENT/被杀，表象像"安全软件拦截"，
// UAT 会误判成环境问题去找人类要白名单，排查成本极高。
function resolveCodeCliCommand() {
  if (process.env.TEAM3_CODE_CLI) return process.env.TEAM3_CODE_CLI;
  try {
    const configPath = path.join(os.homedir(), '.team3', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const codeCli = config.codeCli || {};
    const command = codeCli.command || CODE_CLI_COMMANDS[codeCli.type];
    if (command) return command;
  } catch { /* 配置缺失/损坏 → 兜底 */ }
  return 'claude';
}

export function createHumanSimulator({ workspace, logger } = {}) {
  let sessionId = null;
  const stateFile = workspace
    ? path.join(workspace, 'uat', 'human_session.json')
    : null;

  // 恢复已有 session
  if (stateFile && fs.existsSync(stateFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      sessionId = saved.sessionId;
    } catch {}
  }

  function log(msg) {
    if (logger) logger('HUMAN', msg);
  }

  function saveSession() {
    if (stateFile && sessionId) {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ sessionId }), 'utf-8');
    }
  }

  function callCli(prompt) {
    const command = resolveCodeCliCommand();
    const args = ['-p', prompt, '--output-format', 'text'];

    if (!sessionId) {
      sessionId = randomUUID();
      args.push('--session-id', sessionId);
      args.push('--system-prompt', SYSTEM_PROMPT);
    } else {
      args.push('--resume', sessionId);
    }

    try {
      const result = execFileSync(command, args, {
        timeout: TIMEOUT_MS,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      saveSession();
      return result.trim();
    } catch (e) {
      e.message = `code CLI "${command}" 调用失败: ${e.message}`;
      throw e;
    }
  }

  async function ask(prompt) {
    log(`asking: ${prompt.slice(0, 80)}...`);

    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const content = callCli(prompt);
        log(`got reply (${content.length} chars)`);
        return { content, error: null };
      } catch (e) {
        lastError = e;
        log(`attempt ${attempt + 1} failed: ${e.message}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }

    log(`all retries failed, returning error`);
    return { content: null, error: lastError.message };
  }

  function reset() {
    sessionId = null;
    if (stateFile && fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
    }
  }

  return { ask, reset, getSessionId: () => sessionId };
}
