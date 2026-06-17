'use strict';

const fs = require('fs');

/**
 * MessageRewriter - Feature #6
 *
 * Rewrites action messages before they are dispatched to agents.
 * One rewriting rule is applied based on the target (to) field:
 *
 * reread protocol:
 *   Messages may end with [reread: spec/file1.md, spec/file2.json]
 *   - to=human: strip the entire [reread: ...] suffix
 *   - to=arch or to=dev: keep reread unchanged
 *   - to=uat: remove *_feature_list.json and *_progress.txt from the file list,
 *             keep the rest. If list becomes empty, strip the entire [reread: ...]
 */

// Regex to match the [reread: ...] suffix at end of message
// Captures the file list inside the brackets
const REREAD_REGEX = /\[reread:\s*([^\]]+)\]\s*$/;

// Patterns for files that UAT should NOT see
const UAT_FILTER_PATTERNS = [
  /_feature_list\.json$/,
  /_progress\.txt$/,
];

/**
 * Rewrite a message based on the target recipient.
 *
 * @param {string} message - Original message text
 * @param {string} to - Target recipient: 'human', 'arch', 'dev', 'uat'
 * @returns {string} Rewritten message
 */
function rewriteMessage(message, to) {
  return applyRereadRule(message, to);
}

/**
 * Apply the reread rewriting rule.
 *
 * @param {string} message
 * @param {string} to
 * @returns {string}
 */
function applyRereadRule(message, to) {
  if (to === 'arch' || to === 'dev') {
    // Keep reread unchanged
    return message;
  }

  const match = message.match(REREAD_REGEX);
  if (!match) {
    // No reread suffix, nothing to do
    return message;
  }

  if (to === 'human') {
    // Strip the entire [reread: ...] suffix
    return message.replace(REREAD_REGEX, '').trimEnd();
  }

  if (to === 'uat') {
    // Filter out feature_list and progress files
    const fileList = match[1].split(',').map(f => f.trim()).filter(Boolean);
    const filteredFiles = fileList.filter(f => {
      return !UAT_FILTER_PATTERNS.some(pattern => pattern.test(f));
    });

    if (filteredFiles.length === 0) {
      // All files filtered out, remove entire reread suffix
      return message.replace(REREAD_REGEX, '').trimEnd();
    }

    // Replace with filtered list
    const newReread = `[reread: ${filteredFiles.join(', ')}]`;
    return message.replace(REREAD_REGEX, newReread);
  }

  // Unknown target, return as-is
  return message;
}

/**
 * Read modules_progress.json and return the id of the in_progress module.
 *
 * @param {string} filePath - Path to modules_progress.json
 * @returns {string|null} Module id, or null if file missing/empty/no in_progress
 */
function getInProgressModuleId(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return null;
  }

  if (!data.modules || !Array.isArray(data.modules) || data.modules.length === 0) {
    return null;
  }

  const inProgress = data.modules.find(m => m.status === 'in_progress');
  if (!inProgress || !inProgress.id) {
    return null;
  }

  return inProgress.id;
}

module.exports = {
  rewriteMessage,
  applyRereadRule,
  getInProgressModuleId,
  REREAD_REGEX,
};
