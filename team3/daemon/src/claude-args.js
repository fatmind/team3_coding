'use strict';

const embeddedPrompts = require('./embedded-prompts');

/**
 * Build command-line arguments for spawning a claude code process.
 *
 * @param {Object} options
 * @param {string} options.prompt - The prompt text (passed via -p)
 * @param {string} options.sessionId - UUID v4 session identifier
 * @param {boolean} options.isNew - true → use --session-id (new); false → use --resume (existing)
 * @param {string} options.role - Agent role (arch/dev/uat)
 * @returns {string[]} Array of command-line arguments for spawn('claude', args)
 */
function buildClaudeArgs(options) {
  const { prompt, sessionId, isNew, role } = options;

  if (!prompt) {
    throw new Error('buildClaudeArgs: prompt is required');
  }
  if (!sessionId) {
    throw new Error('buildClaudeArgs: sessionId is required');
  }
  if (!role) {
    throw new Error('buildClaudeArgs: role is required');
  }

  const args = ['-p', prompt];

  if (isNew) {
    args.push('--session-id', sessionId);
  } else {
    args.push('--resume', sessionId);
  }

  args.push('--system-prompt', embeddedPrompts[role]);
  args.push('--output-format', 'stream-json');
  args.push('--verbose');

  if (process.env.TEAM3_SUPERMAN) {
    args.push('--dangerously-skip-permissions');
  }

  return args;
}

module.exports = { buildClaudeArgs };
