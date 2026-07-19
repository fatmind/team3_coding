'use strict';

const embeddedPrompts = require('../embedded-prompts');

const MAX_CONTENT_LENGTH = 500;

const ACTION_KEYWORDS = [
  'to_arch', 'to_human', 'dev_do', 'dev_fix', 'uat_check', 'uat_fix', 'uat_design',
  'dispatch', 'route', 'forward', 'send', 'notify',
];

function truncate(str, maxLen = MAX_CONTENT_LENGTH) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...';
}

function getParamSummary(input) {
  if (!input || typeof input !== 'object') return '';
  if (input.file_path) return input.file_path;
  if (input.command) return input.command;
  if (input.description) return input.description;
  if (input.query) return input.query;
  const keys = Object.keys(input);
  for (const key of keys) {
    const val = input[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return '';
}

function detectTextTone(text) {
  if (!text) return undefined;
  if (text.includes('✓') || text.toLowerCase().includes('passed')) return 'success';
  if (text.includes('→')) {
    const lower = text.toLowerCase();
    for (const keyword of ACTION_KEYWORDS) {
      if (lower.includes(keyword)) return 'mention';
    }
  }
  return undefined;
}

function parseContentBlock(block) {
  if (!block || !block.type) return null;

  if (block.type === 'thinking') {
    return { content: '[思考] ' + truncate(block.thinking || '', MAX_CONTENT_LENGTH) };
  }
  if (block.type === 'text') {
    const text = block.text || '';
    const item = { content: truncate(text, MAX_CONTENT_LENGTH) };
    const tone = detectTextTone(text);
    if (tone) item.tone = tone;
    return item;
  }
  if (block.type === 'tool_use') {
    const name = block.name || 'unknown_tool';
    const paramSummary = getParamSummary(block.input);
    const summaryText = paramSummary ? `${name} ${paramSummary}` : name;
    return { content: truncate(summaryText, MAX_CONTENT_LENGTH), tone: 'route' };
  }
  return null;
}

module.exports = {
  name: 'claude-code',
  command: 'claude',

  buildArgs({ prompt, sessionId, isNew, role, workspaceDir }) {
    if (!prompt) throw new Error('buildArgs: prompt is required');
    if (!sessionId) throw new Error('buildArgs: sessionId is required');
    if (!role) throw new Error('buildArgs: role is required');

    const args = ['-p', prompt];
    args.push(isNew ? '--session-id' : '--resume', sessionId);
    const systemPrompt = embeddedPrompts[role].replace(/\{cwd\}/g, workspaceDir || process.cwd());
    args.push('--system-prompt', systemPrompt);
    args.push('--output-format', 'stream-json');
    args.push('--verbose');

    if (process.env.TEAM3_SUPERMAN) {
      args.push('--dangerously-skip-permissions');
    }
    return args;
  },

  parseStdoutLine(line) {
    if (!line || !line.trim()) return null;
    let parsed;
    try { parsed = JSON.parse(line.trim()); } catch (e) { return null; }
    if (parsed.type !== 'assistant') return null;

    const contentBlocks = parsed.message && parsed.message.content;
    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) return null;

    const results = [];
    for (const block of contentBlocks) {
      const item = parseContentBlock(block);
      if (item) results.push(item);
    }
    return results.length > 0 ? results : null;
  },

  extractResult(stdout) {
    if (!stdout || !stdout.trim()) return null;
    const lines = stdout.trim().split('\n');
    let lastResult = null;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed.type === 'result' && parsed.result != null) {
          lastResult = String(parsed.result);
        }
      } catch (e) { /* skip */ }
    }
    return lastResult;
  },

  isMissingSessionError(exitCode, stderr, stdout) {
    return /no conversation found/i.test(stderr || '');
  },
};
