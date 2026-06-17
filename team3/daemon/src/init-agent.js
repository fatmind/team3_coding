'use strict';

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const ProjectJson = require('./project-json');
const config = require('./config');
const { buildClaudeArgs } = require('./claude-args');

/**
 * Agent Initializer - Feature #2
 *
 * Provides init_agent interface to:
 * - Generate a valid UUID v4 as sessionId
 * - Update .team3-project.json partner.<role>_agent.session.runing
 * - Spawn claude code with --session-id, --system-prompt-file, --output-format stream-json
 * - For arch: include -p prompt asking arch to write actions.jsonl notification
 */

// Default paths (relative to project workspace root)
const DEFAULTS = {
  specDir: path.resolve(__dirname, '../../spec'),
  projectJsonPath: config.projectJsonPath,
};

/**
 * Generate a valid UUID v4 (lowercase)
 */
function generateSessionId() {
  return randomUUID(); // crypto.randomUUID() returns lowercase UUID v4
}

/**
 * Get the initial prompt for arch agent on first start
 */
function getArchInitPrompt() {
  return '请在 spec/actions.jsonl 文件末尾追加一行 JSON：{"action":"to_human","from":"arch","to":"human","ts":<当前unix秒级时间戳>,"message":"arch 已在线，我们开始讨论吧"}。只做这一件事，完成后退出。';
}

/**
 * Initialize an agent: generate sessionId, update project json, spawn claude code
 *
 * @param {string} role - 'arch' or 'uat'
 * @param {Object} [options] - Override options for testing
 * @param {string} [options.projectJsonPath] - Path to .team3-project.json
 * @param {string} [options.specDir] - Path to spec/ directory
 * @param {Function} [options.spawnFn] - Override spawn function (for testing)
 * @param {Function} [options.uuidFn] - Override UUID generator (for testing)
 * @returns {Promise<Object>} { sessionId, process }
 */
async function initAgent(role, options = {}) {
  if (!['arch', 'uat'].includes(role)) {
    throw new Error(`Invalid agent role: ${role}. Must be 'arch' or 'uat'`);
  }

  const projectJsonPath = options.projectJsonPath || DEFAULTS.projectJsonPath;
  const specDir = options.specDir || DEFAULTS.specDir;
  const spawnFn = options.spawnFn || spawn;
  const uuidFn = options.uuidFn || generateSessionId;

  // 1. Generate UUID v4 sessionId
  const sessionId = uuidFn();

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!uuidRegex.test(sessionId)) {
    throw new Error(`Generated invalid UUID: ${sessionId}. Must be valid UUID v4 (lowercase)`);
  }

  // 2. Update .team3-project.json
  const projectJson = new ProjectJson(projectJsonPath);
  const data = projectJson.read();

  // Ensure partner structure exists
  if (!data.partner) {
    data.partner = {};
  }

  const agentKey = `${role}_agent`;
  if (!data.partner[agentKey]) {
    data.partner[agentKey] = {};
  }
  if (!data.partner[agentKey].session) {
    data.partner[agentKey].session = {};
  }

  // Write sessionId to runing field. Follow-up resume repair is handled by AgentScheduler.
  data.partner[agentKey].session.runing = sessionId;

  projectJson.write(data);

  // 3. Build spawn arguments using shared claude-args module
  let prompt = null;
  if (role === 'arch') {
    prompt = getArchInitPrompt();
  }

  const claudeArgs = buildClaudeArgs({
    prompt: prompt || `你是 ${role} agent，已成功初始化。`,
    sessionId,
    isNew: true,
    role,
  });

  // 4. Spawn claude code process
  const claudeProcess = spawnFn('claude', claudeArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  return {
    sessionId,
    process: claudeProcess,
    role,
    args: claudeArgs,
  };
}

module.exports = {
  initAgent,
  generateSessionId,
  getArchInitPrompt,
  buildClaudeArgs,
};
