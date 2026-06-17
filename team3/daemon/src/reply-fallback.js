'use strict';

const fs = require('fs');

/**
 * ReplyFallback - Feature #14
 *
 * Solves: "claude -p outputs text only, doesn't use file write tool
 * to write actions.jsonl" causing reply loss.
 *
 * On exit 0: parse stdout (stream-json), extract last result text,
 * check if agent wrote to actions.jsonl during execution,
 * if not → auto-append fallback message.
 */

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
 * Build a fallback to_human action from result text.
 *
 * @param {string} resultText - The result text
 * @param {string} role - The agent role
 * @returns {Object} Action object for to_human
 */
function buildFallbackAction(resultText, role) {
  return {
    action: 'to_human',
    from: role,
    to: 'human',
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

  // Step 3: Try to extract action JSON from result, or build fallback
  let action = extractActionFromResult(resultText, role);
  if (!action) {
    action = buildFallbackAction(resultText, role);
  }

  // Ensure ts is current
  if (!action.ts) {
    action.ts = Math.floor(Date.now() / 1000);
  }

  // Step 4: Append to actions.jsonl
  try {
    fs.appendFileSync(actionsFilePath, JSON.stringify(action) + '\n');
  } catch (err) {
    return { applied: false, action, reason: `write-error: ${err.message}` };
  }

  return { applied: true, action, reason: 'fallback-applied' };
}

module.exports = {
  extractResultText,
  extractActionFromResult,
  buildFallbackAction,
  hasNewWritesSince,
  getFileOffset,
  applyFallback,
};
