'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * ReplyFallback - Feature #14
 *
 * Solves: "claude -p outputs text only, doesn't use file write tool
 * to write actions.jsonl" causing reply loss.
 *
 * On exit 0: parse stdout (stream-json), extract last result text,
 * check if agent wrote to actions.jsonl during execution,
 * if not → auto-append fallback message.
 *
 * Write path: goes through cli/write-action.mjs (the single write gate,
 * so VALID_ACTIONS / human-only rules live in ONE place) in lenient mode:
 * judge skipped (session is over, nobody can rewrite), message pre-truncated.
 * Only if the CLI itself is unavailable do we append directly — a rejected
 * fallback with no writer means a message black hole.
 */

// Actions an agent may legitimately emit. to_dev/to_uat are human-only and
// note is drop-on-purpose; anything else found in result text gets downgraded
// to a role-default report instead of being written verbatim.
const AGENT_ACTIONS = ['to_arch', 'to_human', 'dev_do', 'dev_fix', 'uat_design', 'uat_check', 'uat_fix', 'note'];

/**
 * Extract result text from stream-json stdout.
 * Looks for the last JSON line with type="result" and returns its result field.
 *
 * @param {string} stdout - Raw stdout from claude --output-format stream-json
 * @returns {string|null} The result text, or null if not found
 */
function extractResultText(stdout) {
  if (!stdout || !stdout.trim()) return null;

  const lines = stdout.trim().split('\n');
  let lastResult = null;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed.type === 'result' && parsed.result != null) {
        lastResult = String(parsed.result);
      }
    } catch (e) {
      // Skip non-JSON lines
    }
  }

  return lastResult;
}

/**
 * Try to extract a valid action JSON object from result text.
 * The agent may have included the JSON in its text output instead of writing to file.
 *
 * @param {string} resultText - The result text from stream-json
 * @param {string} role - The agent role (arch/dev/uat)
 * @returns {Object|null} Extracted action object, or null if not found
 */
function extractActionFromResult(resultText, role) {
  if (!resultText) return null;

  // Try to find a JSON object that looks like an action
  const jsonRegex = /\{[^{}]*"action"\s*:\s*"[^"]+"\s*,[^{}]*"from"\s*:\s*"[^"]+"\s*,[^{}]*"to"\s*:\s*"[^"]+"\s*,[^{}]*"message"\s*:\s*"[^"]*"[^{}]*\}/g;

  let match;
  while ((match = jsonRegex.exec(resultText)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.action && obj.from && obj.to && obj.message != null) {
        return obj;
      }
    } catch (e) {
      // Invalid JSON, continue
    }
  }

  return null;
}

/**
 * Build a fallback action from result text.
 * Default recipient follows the reporting chain: dev/uat report to arch
 * (治"UAT 干完活忘记通知 arch"——兜底消息直接把结果递给调度者)，
 * arch reports to human.
 *
 * @param {string} resultText - The result text
 * @param {string} role - The agent role
 * @returns {Object} Action object
 */
function buildFallbackAction(resultText, role) {
  const toArch = role === 'dev' || role === 'uat';
  return {
    action: toArch ? 'to_arch' : 'to_human',
    from: role,
    to: toArch ? 'arch' : 'human',
    ts: Math.floor(Date.now() / 1000),
    message: resultText,
  };
}

/**
 * Check if actions.jsonl has new lines from this role since startOffset.
 *
 * @param {string} filePath - Path to actions.jsonl
 * @param {number} startOffset - File byte offset at spawn time
 * @param {string} role - Agent role to check for
 * @returns {boolean} True if new lines from this role exist
 */
function hasNewWritesSince(filePath, startOffset, role) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= startOffset) return false;

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - startOffset);
    fs.readSync(fd, buf, 0, buf.length, startOffset);
    fs.closeSync(fd);

    const newContent = buf.toString('utf-8');
    const lines = newContent.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.from === role) return true;
      } catch (e) {
        // Skip unparseable lines
      }
    }
  } catch (e) {
    // File read error: treat as no new writes
  }

  return false;
}

/**
 * Get current file size (byte offset) for tracking.
 *
 * @param {string} filePath - Path to file
 * @returns {number} File size in bytes, or 0 if file doesn't exist
 */
function getFileOffset(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (e) {
    return 0;
  }
}

/**
 * Truncate over-long fallback message before append.
 * Fallback bypasses the write-action length gate (500) and judge; nobody can
 * rewrite it (session already ended), so reject = message black hole.
 * Instead: cut at the limit and point to the full text in the agent log.
 *
 * @param {Object} action - Action object (mutated)
 * @param {string} role - Agent role, used for log file name
 * @returns {Object} The same action with message truncated if needed
 */
function truncateFallbackMessage(action, role) {
  if (!action || typeof action.message !== 'string') return action;
  const maxLen = Number(process.env.TEAM3_AGENT_MSG_MAX) || 500;
  if (action.message.length <= maxLen) return action;

  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const date = `${now.getFullYear()}-${m}-${d}`;
  // Total length (body + suffix) must stay <= maxLen so the truncated message
  // still passes write-action's length gate instead of bouncing to the
  // direct-append disaster path.
  const suffix = `\n……[超 ${maxLen} 字已截断，全文见 logs/${role}_${date}.log]`;
  action.message = action.message.slice(0, Math.max(0, maxLen - suffix.length)) + suffix;
  return action;
}

/**
 * Sanitize an action extracted from agent result text before writing.
 * Verbatim-extracted JSON is agent-claimed: action type and from are not
 * trustworthy. Anything outside the agent whitelist (e.g. human-only
 * to_dev/to_uat, or a spoofed from=human) is downgraded to the role-default
 * report so the content survives but the routing/session semantics don't
 * get hijacked.
 *
 * @param {Object|null} action - Extracted action (may be null)
 * @param {string} resultText - Full result text (downgrade fallback body)
 * @param {string} role - Actual agent role (authoritative "from")
 * @returns {Object} Safe action object
 */
function sanitizeExtractedAction(action, resultText, role) {
  if (!action) return buildFallbackAction(resultText, role);
  if (!AGENT_ACTIONS.includes(action.action) || action.from !== role) {
    return buildFallbackAction(resultText, role);
  }
  return action;
}

/**
 * Write the fallback action through cli/write-action.mjs — the single write
 * gate — in lenient mode (judge skipped; message already truncated here).
 * Returns { ok, detail }. Caller falls back to a direct append only when the
 * CLI is unavailable/broken, so a tool failure never becomes a message hole.
 *
 * @param {Object} action - Action to write
 * @param {string} actionsFilePath - Path to actions.jsonl
 * @returns {{ ok: boolean, detail: string }}
 */
function writeViaCli(action, actionsFilePath) {
  const workspace = path.resolve(path.dirname(actionsFilePath), '..');
  const cliPath = path.join(workspace, 'cli', 'write-action.mjs');
  if (!fs.existsSync(cliPath)) {
    return { ok: false, detail: 'cli-missing' };
  }

  const res = spawnSync(process.execPath, [
    cliPath, actionsFilePath,
    '--action', action.action,
    '--from', action.from,
    '--to', action.to,
    '--message', action.message,
  ], {
    encoding: 'utf-8',
    cwd: workspace,
    timeout: 30000,
    env: { ...process.env, TEAM3_JUDGE_SKIP: '1' },
  });

  if (res.error) return { ok: false, detail: `cli-error: ${res.error.message}` };
  if (res.status !== 0) {
    return { ok: false, detail: `cli-exit-${res.status}: ${(res.stderr || '').substring(0, 200)}` };
  }
  return { ok: true, detail: 'cli' };
}

/**
 * Execute the full fallback flow.
 * Called after claude exit 0.
 *
 * @param {Object} params
 * @param {string} params.stdout - Raw stdout from claude
 * @param {string} params.role - Agent role
 * @param {string} params.actionsFilePath - Path to actions.jsonl
 * @param {number} params.spawnOffset - File offset at spawn time
 * @returns {{ applied: boolean, action: Object|null, reason: string }}
 */
function applyFallback({ stdout, role, actionsFilePath, spawnOffset }) {
  // Step 1: Extract result text from stdout
  const resultText = extractResultText(stdout);
  if (!resultText) {
    return { applied: false, action: null, reason: 'no-result' };
  }

  // Step 2: Check if agent already wrote to actions.jsonl
  if (hasNewWritesSince(actionsFilePath, spawnOffset, role)) {
    return { applied: false, action: null, reason: 'already-written' };
  }

  // Step 3: Try to extract action JSON from result, sanitize agent claims
  const action = sanitizeExtractedAction(
    extractActionFromResult(resultText, role), resultText, role
  );

  // Ensure ts is current
  if (!action.ts) {
    action.ts = Math.floor(Date.now() / 1000);
  }

  // Step 3.5: Enforce the same length limit as write-action (truncate, not reject)
  truncateFallbackMessage(action, role);

  // Step 4: Write through the single gate; direct append only as disaster
  // fallback (tool unavailable — losing the message is worse than bypassing)
  const gate = writeViaCli(action, actionsFilePath);
  if (gate.ok) {
    return { applied: true, action, reason: 'fallback-applied' };
  }
  try {
    fs.appendFileSync(actionsFilePath, JSON.stringify(action) + '\n');
  } catch (err) {
    return { applied: false, action, reason: `write-error: ${err.message}` };
  }
  return { applied: true, action, reason: `fallback-applied-direct (${gate.detail})` };
}

module.exports = {
  extractResultText,
  extractActionFromResult,
  buildFallbackAction,
  sanitizeExtractedAction,
  truncateFallbackMessage,
  writeViaCli,
  hasNewWritesSince,
  getFileOffset,
  applyFallback,
};
