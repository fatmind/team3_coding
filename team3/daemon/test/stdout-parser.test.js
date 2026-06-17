'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseStreamJsonLine,
  parseContentBlock,
  truncate,
  getParamSummary,
  detectTextTone,
  MAX_CONTENT_LENGTH,
} = require('../src/stdout-parser');

/**
 * Helper: build a real stream-json assistant line.
 * Real format: {"type":"assistant","message":{"content":[block],...}}
 */
function assistantLine(blocks) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-opus-4-6',
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: Array.isArray(blocks) ? blocks : [blocks],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    session_id: 'test-session',
  });
}

describe('stdout-parser', () => {

  // ── truncate ──────────────────────────────────────────────

  describe('truncate()', () => {
    it('should return short strings unchanged', () => {
      assert.equal(truncate('hello', 500), 'hello');
    });

    it('should truncate long strings and append ...', () => {
      const long = 'a'.repeat(600);
      const result = truncate(long, 500);
      assert.equal(result.length, 503); // 500 + '...'
      assert.ok(result.endsWith('...'));
    });

    it('should handle exact boundary', () => {
      const exact = 'b'.repeat(500);
      assert.equal(truncate(exact, 500), exact);
    });

    it('should handle empty string', () => {
      assert.equal(truncate('', 500), '');
    });

    it('should handle null/undefined', () => {
      assert.equal(truncate(null), '');
      assert.equal(truncate(undefined), '');
    });
  });

  // ── getParamSummary ───────────────────────────────────────

  describe('getParamSummary()', () => {
    it('should prefer file_path', () => {
      assert.equal(
        getParamSummary({ file_path: '/src/foo.js', command: 'ls' }),
        '/src/foo.js'
      );
    });

    it('should fall back to command', () => {
      assert.equal(
        getParamSummary({ command: 'npm test', description: 'run tests' }),
        'npm test'
      );
    });

    it('should fall back to description', () => {
      assert.equal(
        getParamSummary({ description: 'Check file contents' }),
        'Check file contents'
      );
    });

    it('should fall back to query', () => {
      assert.equal(
        getParamSummary({ query: 'search term' }),
        'search term'
      );
    });

    it('should fall back to first string value', () => {
      assert.equal(
        getParamSummary({ foo: 42, bar: 'fallback value' }),
        'fallback value'
      );
    });

    it('should return empty string for empty/null input', () => {
      assert.equal(getParamSummary(null), '');
      assert.equal(getParamSummary({}), '');
      assert.equal(getParamSummary(undefined), '');
    });
  });

  // ── detectTextTone ────────────────────────────────────────

  describe('detectTextTone()', () => {
    it('should detect success with checkmark', () => {
      assert.equal(detectTextTone('Test ✓ all done'), 'success');
    });

    it('should detect success with "passed"', () => {
      assert.equal(detectTextTone('All tests passed'), 'success');
    });

    it('should detect success with "Passed" (case-insensitive)', () => {
      assert.equal(detectTextTone('Tests PASSED successfully'), 'success');
    });

    it('should detect mention with arrow + action keyword', () => {
      assert.equal(detectTextTone('→ dev_do: dispatch task'), 'mention');
    });

    it('should detect mention with arrow + to_arch', () => {
      assert.equal(detectTextTone('消息 → to_arch 转发'), 'mention');
    });

    it('should detect mention with arrow + notify', () => {
      assert.equal(detectTextTone('→ notify human about result'), 'mention');
    });

    it('should return undefined for plain text', () => {
      assert.equal(detectTextTone('just some ordinary text'), undefined);
    });

    it('should return undefined for arrow without action keyword', () => {
      assert.equal(detectTextTone('→ doing some work'), undefined);
    });

    it('should return undefined for empty/null', () => {
      assert.equal(detectTextTone(''), undefined);
      assert.equal(detectTextTone(null), undefined);
    });

    it('should prioritize success over mention', () => {
      assert.equal(detectTextTone('✓ → dev_do completed'), 'success');
    });
  });

  // ── parseContentBlock ─────────────────────────────────────

  describe('parseContentBlock()', () => {
    it('should parse text block', () => {
      const result = parseContentBlock({ type: 'text', text: 'Hello world' });
      assert.ok(result);
      assert.equal(result.content, 'Hello world');
      assert.equal(result.tone, undefined);
    });

    it('should parse thinking block (thinking field, not text)', () => {
      const result = parseContentBlock({ type: 'thinking', thinking: 'Let me analyze...', signature: 'abc...' });
      assert.ok(result);
      assert.ok(result.content.startsWith('[思考]'));
      assert.ok(result.content.includes('Let me analyze'));
    });

    it('should parse tool_use block', () => {
      const result = parseContentBlock({ type: 'tool_use', id: 'toolu_123', name: 'Read', input: { file_path: '/src/app.js' } });
      assert.ok(result);
      assert.equal(result.content, 'Read /src/app.js');
      assert.equal(result.tone, 'route');
    });

    it('should return null for tool_result block', () => {
      assert.equal(parseContentBlock({ type: 'tool_result', content: 'output...' }), null);
    });

    it('should return null for null', () => {
      assert.equal(parseContentBlock(null), null);
    });
  });

  // ── parseStreamJsonLine (real format) ─────────────────────

  describe('parseStreamJsonLine()', () => {

    // ─ assistant/text (real format) ─

    it('should parse assistant message with text block', () => {
      const line = assistantLine({ type: 'text', text: 'Hello world, this is a response.' });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result.length, 1);
      assert.equal(result[0].content, 'Hello world, this is a response.');
      assert.equal(result[0].tone, undefined);
    });

    it('should truncate long text content', () => {
      const longText = 'x'.repeat(600);
      const line = assistantLine({ type: 'text', text: longText });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content.length, 503); // 500 + '...'
    });

    it('should detect success tone in text', () => {
      const line = assistantLine({ type: 'text', text: 'All 10 tests passed successfully ✓' });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].tone, 'success');
    });

    it('should detect mention tone in text', () => {
      const line = assistantLine({ type: 'text', text: '→ dev_do Feature #5 dispatched' });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].tone, 'mention');
    });

    it('should handle empty text content', () => {
      const line = assistantLine({ type: 'text', text: '' });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, '');
    });

    // ─ assistant/thinking (real format: block.thinking, not block.text) ─

    it('should parse thinking with [思考] prefix from block.thinking', () => {
      const line = assistantLine({
        type: 'thinking',
        thinking: 'Let me analyze the requirements...',
        signature: 'Eq8D...',
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result.length, 1);
      assert.equal(result[0].content, '[思考] Let me analyze the requirements...');
      assert.equal(result[0].tone, undefined);
    });

    it('should truncate long thinking content after prefix', () => {
      const longThinking = 'y'.repeat(600);
      const line = assistantLine({ type: 'thinking', thinking: longThinking, signature: 'abc' });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.ok(result[0].content.startsWith('[思考] '));
      const afterPrefix = result[0].content.substring('[思考] '.length);
      assert.equal(afterPrefix.length, 503); // 500 + '...'
    });

    // ─ assistant/tool_use (real format: block.name + block.input) ─

    it('should parse tool_use with file_path', () => {
      const line = assistantLine({
        type: 'tool_use',
        id: 'toolu_vrtx_123',
        name: 'Read',
        input: { file_path: '/src/app.js' },
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, 'Read /src/app.js');
      assert.equal(result[0].tone, 'route');
    });

    it('should parse tool_use with command', () => {
      const line = assistantLine({
        type: 'tool_use',
        id: 'toolu_vrtx_456',
        name: 'Bash',
        input: { command: 'npm test', description: 'Run tests' },
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, 'Bash npm test');
      assert.equal(result[0].tone, 'route');
    });

    it('should parse tool_use with description (no file_path/command)', () => {
      const line = assistantLine({
        type: 'tool_use',
        id: 'toolu_vrtx_789',
        name: 'Agent',
        input: { description: 'Find team3.md file', prompt: 'Search for...' },
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, 'Agent Find team3.md file');
    });

    it('should parse tool_use with query', () => {
      const line = assistantLine({
        type: 'tool_use',
        id: 'toolu_vrtx_000',
        name: 'Grep',
        input: { query: 'TODO fixme' },
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, 'Grep TODO fixme');
    });

    it('should handle tool_use with no input', () => {
      const line = assistantLine({ type: 'tool_use', id: 'toolu_x', name: 'SomeTool' });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, 'SomeTool');
      assert.equal(result[0].tone, 'route');
    });

    it('should truncate long tool_use content', () => {
      const longPath = '/very/long/path/' + 'x'.repeat(600);
      const line = assistantLine({
        type: 'tool_use',
        id: 'toolu_y',
        name: 'Read',
        input: { file_path: longPath },
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.ok(result[0].content.length <= 503); // 500 + '...'
    });

    // ─ Skip types ─

    it('should return null for system events', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'abc',
        cwd: '/some/path',
      });
      assert.equal(parseStreamJsonLine(line), null);
    });

    it('should return null for system hook events', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'hook_started',
        hook_id: 'abc',
        hook_name: 'SessionStart:startup',
      });
      assert.equal(parseStreamJsonLine(line), null);
    });

    it('should return null for user events', () => {
      const line = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: 'file contents...' }],
        },
      });
      assert.equal(parseStreamJsonLine(line), null);
    });

    it('should return null for result events', () => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'done',
        is_error: false,
      });
      assert.equal(parseStreamJsonLine(line), null);
    });

    // ─ Edge cases ─

    it('should return null for empty string', () => {
      assert.equal(parseStreamJsonLine(''), null);
    });

    it('should return null for null', () => {
      assert.equal(parseStreamJsonLine(null), null);
    });

    it('should return null for invalid JSON', () => {
      assert.equal(parseStreamJsonLine('not json {'), null);
    });

    it('should return null for assistant with empty content array', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { content: [] },
      });
      assert.equal(parseStreamJsonLine(line), null);
    });

    it('should return null for assistant with no message', () => {
      const line = JSON.stringify({ type: 'assistant' });
      assert.equal(parseStreamJsonLine(line), null);
    });

    it('should handle missing text field in text block', () => {
      const line = assistantLine({ type: 'text' });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, '');
    });

    it('should handle missing name field in tool_use block', () => {
      const line = assistantLine({ type: 'tool_use', id: 'toolu_z', input: { file_path: '/a.js' } });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, 'unknown_tool /a.js');
    });

    // ─ Real-world format validation ─

    it('should parse a real thinking line from claude log', () => {
      // Simplified version of actual log format (line 4 from arch log)
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg_vrtx_01G1XqNU7D8xpM2hLSTVhtHS',
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'thinking',
            thinking: 'The user is asking me to check if the product design is clear.',
            signature: 'Eq8D...',
          }],
          stop_reason: null,
          usage: { input_tokens: 3, output_tokens: 14 },
        },
        parent_tool_use_id: null,
        session_id: 'c90f755f-31b3-412a-ba36-4cd624dd61c9',
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result.length, 1);
      assert.ok(result[0].content.startsWith('[思考]'));
      assert.ok(result[0].content.includes('product design'));
    });

    it('should parse a real text line from claude log', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg_vrtx_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '好的，让我先建立项目全局认识，按顺序读取关键文件。' }],
          stop_reason: null,
          usage: { input_tokens: 3, output_tokens: 14 },
        },
        session_id: 'test-session',
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, '好的，让我先建立项目全局认识，按顺序读取关键文件。');
    });

    it('should parse a real tool_use line from claude log', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg_vrtx_test2',
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_vrtx_011heq84Pfny4q6EhJ9CRNMM',
            name: 'Read',
            input: { file_path: '/home/user/human_coding/team3.md' },
          }],
          stop_reason: null,
          usage: { input_tokens: 3, output_tokens: 14 },
        },
        session_id: 'test-session',
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      assert.equal(result[0].content, 'Read /home/user/human_coding/team3.md');
      assert.equal(result[0].tone, 'route');
    });

    it('should parse a real Bash tool_use from claude log', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_vrtx_01GQdXsgs5HYDDSpFNLzzcV9',
            name: 'Bash',
            input: { command: 'pwd && ls', description: 'Check current directory' },
          }],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 26 },
        },
        session_id: 'test-session',
      });
      const result = parseStreamJsonLine(line);
      assert.ok(result);
      // file_path > command > description, so 'command' wins here
      assert.equal(result[0].content, 'Bash pwd && ls');
      assert.equal(result[0].tone, 'route');
    });
  });
});
