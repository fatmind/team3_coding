'use strict';

/**
 * stdout-parser.js - Feature #22
 *
 * Parses claude code --output-format stream-json stdout lines.
 * Input: a complete JSON line (string)
 * Output: [{content, tone?}] or null
 *
 * Real stream-json format (from claude code CLI):
 *
 *   assistant/text:
 *     {"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}],...}}
 *
 *   assistant/thinking:
 *     {"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Let me...","signature":"..."}],...}}
 *
 *   assistant/tool_use:
 *     {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"..."}}],...}}
 *
 *   system/user/result → null (skip)
 *
 * Parsing rules:
 * - thinking → [{content: '[思考] ' + truncate(120)}]
 * - text → [{content: truncate(120), tone?}]
 *     tone='success' when text contains '✓' or 'passed'
 *     tone='mention' when text contains '→' + action keywords
 * - tool_use → [{content: 'name param_summary', tone: 'route'}]
 *     param summary priority: file_path > command > description > query
 */

const MAX_CONTENT_LENGTH = 500;

/**
 * Action keywords that, when combined with '→', trigger tone='mention'.
 */
const ACTION_KEYWORDS = [
  'to_arch', 'to_human', 'dev_do', 'dev_fix', 'uat_check', 'uat_fix', 'uat_design',
  'dispatch', 'route', 'forward', 'send', 'notify',
];

/**
 * Truncate a string to maxLen characters.
 * Appends '...' if truncated.
 *
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen = MAX_CONTENT_LENGTH) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...';
}

/**
 * Extract a short parameter summary from tool_use input.
 * Priority: file_path > command > description > query
 *
 * @param {Object} input - Tool use input parameters
 * @returns {string} Short summary
 */
function getParamSummary(input) {
  if (!input || typeof input !== 'object') return '';

  if (input.file_path) return input.file_path;
  if (input.command) return input.command;
  if (input.description) return input.description;
  if (input.query) return input.query;

  // Fallback: first string value
  const keys = Object.keys(input);
  for (const key of keys) {
    const val = input[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }

  return '';
}

/**
 * Detect tone for text content.
 *
 * @param {string} text
 * @returns {string|undefined} 'success' | 'mention' | undefined
 */
function detectTextTone(text) {
  if (!text) return undefined;

  // Check success indicators
  if (text.includes('✓') || text.toLowerCase().includes('passed')) {
    return 'success';
  }

  // Check mention: '→' + action keyword
  if (text.includes('→')) {
    const lower = text.toLowerCase();
    for (const keyword of ACTION_KEYWORDS) {
      if (lower.includes(keyword)) {
        return 'mention';
      }
    }
  }

  return undefined;
}

/**
 * Parse a single content block from message.content[].
 *
 * @param {Object} block - A content block {type, text?, thinking?, name?, input?}
 * @returns {{content: string, tone?: string}|null}
 */
function parseContentBlock(block) {
  if (!block || !block.type) return null;

  if (block.type === 'thinking') {
    const text = block.thinking || '';
    const content = '[思考] ' + truncate(text, MAX_CONTENT_LENGTH);
    return { content };
  }

  if (block.type === 'text') {
    const text = block.text || '';
    const content = truncate(text, MAX_CONTENT_LENGTH);
    const tone = detectTextTone(text);
    const item = { content };
    if (tone) item.tone = tone;
    return item;
  }

  if (block.type === 'tool_use') {
    const name = block.name || 'unknown_tool';
    const paramSummary = getParamSummary(block.input);
    const summaryText = paramSummary ? `${name} ${paramSummary}` : name;
    const content = truncate(summaryText, MAX_CONTENT_LENGTH);
    return { content, tone: 'route' };
  }

  // Unknown block type (tool_result, etc.) → skip
  return null;
}

/**
 * Parse a single stream-json line.
 *
 * Real format: each line is a JSON object with:
 *   - type: "assistant" | "system" | "user" | "result"
 *   - For assistant: message.content[] array of blocks
 *     Each block: {type: "text"|"thinking"|"tool_use", ...}
 *
 * @param {string} line - A complete JSON line from stream-json stdout
 * @returns {Array<{content: string, tone?: string}>|null}
 *   Returns array of parsed items, or null to skip
 */
function parseStreamJsonLine(line) {
  if (!line || !line.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(line.trim());
  } catch (e) {
    return null; // Non-JSON line, skip
  }

  // Only handle assistant events
  if (parsed.type !== 'assistant') {
    return null; // system, user, result → skip
  }

  // Extract content blocks from message.content[]
  const contentBlocks = parsed.message && parsed.message.content;
  if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
    return null;
  }

  const results = [];
  for (const block of contentBlocks) {
    const item = parseContentBlock(block);
    if (item) {
      results.push(item);
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Format ISO timestamp or Date as HH:MM:SS (24h).
 * @param {string|Date} value
 * @returns {string}
 */
function formatLogTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '';
  }
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

/**
 * Extract top-level timestamp from a raw stream-json line.
 * @param {string} rawLine
 * @returns {string|null}
 */
function extractLogTimestamp(rawLine) {
  if (!rawLine || !rawLine.trim()) return null;

  try {
    const parsed = JSON.parse(rawLine.trim());
    if (typeof parsed.timestamp === 'string') {
      return formatLogTime(parsed.timestamp);
    }
  } catch (e) {
    // Non-JSON line
  }

  return null;
}

module.exports = {
  parseStreamJsonLine,
  parseContentBlock,
  truncate,
  getParamSummary,
  detectTextTone,
  extractLogTimestamp,
  formatLogTime,
  MAX_CONTENT_LENGTH,
};
