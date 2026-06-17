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

  function callClaude(prompt) {
    const args = ['-p', prompt, '--output-format', 'text'];

    if (!sessionId) {
      sessionId = randomUUID();
      args.push('--session-id', sessionId);
      args.push('--system-prompt', SYSTEM_PROMPT);
    } else {
      args.push('--resume', sessionId);
    }

    const result = execFileSync('claude', args, {
      timeout: TIMEOUT_MS,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    saveSession();
    return result.trim();
  }

  async function ask(prompt) {
    log(`asking: ${prompt.slice(0, 80)}...`);

    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const content = callClaude(prompt);
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
