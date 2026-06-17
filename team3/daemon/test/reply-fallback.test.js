'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  extractResultText,
  extractActionFromResult,
  buildFallbackAction,
  hasNewWritesSince,
  getFileOffset,
  applyFallback,
} = require('../src/reply-fallback');

describe('ReplyFallback (Feature #14)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('extractResultText', () => {
    it('should extract result text from stream-json stdout', () => {
      const stdout = [
        '{"type":"system","subtype":"init"}',
        '{"type":"assistant","content":"thinking..."}',
        '{"type":"result","result":"Feature #1 已交付完成。"}',
      ].join('\n');

      assert.strictEqual(extractResultText(stdout), 'Feature #1 已交付完成。');
    });

    it('should return last result when multiple result events exist', () => {
      const stdout = [
        '{"type":"result","result":"first result"}',
        '{"type":"result","result":"last result"}',
      ].join('\n');

      assert.strictEqual(extractResultText(stdout), 'last result');
    });

    it('should return null for empty stdout', () => {
      assert.strictEqual(extractResultText(''), null);
      assert.strictEqual(extractResultText(null), null);
      assert.strictEqual(extractResultText(undefined), null);
    });

    it('should return null when no result event exists', () => {
      const stdout = [
        '{"type":"system","subtype":"init"}',
        '{"type":"assistant","content":"hello"}',
      ].join('\n');

      assert.strictEqual(extractResultText(stdout), null);
    });

    it('should skip non-JSON lines gracefully', () => {
      const stdout = [
        'some random text',
        '{"type":"result","result":"ok"}',
        'more random text',
      ].join('\n');

      assert.strictEqual(extractResultText(stdout), 'ok');
    });

    it('should handle result with numeric value', () => {
      const stdout = '{"type":"result","result":42}\n';
      assert.strictEqual(extractResultText(stdout), '42');
    });
  });

  describe('extractActionFromResult', () => {
    it('should extract valid action JSON from result text', () => {
      const text = '已完成任务。{"action":"to_arch","from":"dev","to":"arch","ts":123,"message":"done"}';
      const action = extractActionFromResult(text, 'dev');

      assert.strictEqual(action.action, 'to_arch');
      assert.strictEqual(action.from, 'dev');
      assert.strictEqual(action.to, 'arch');
      assert.strictEqual(action.message, 'done');
    });

    it('should return null when no valid action JSON found', () => {
      assert.strictEqual(extractActionFromResult('just plain text', 'dev'), null);
    });

    it('should return null for empty/null input', () => {
      assert.strictEqual(extractActionFromResult(null, 'dev'), null);
      assert.strictEqual(extractActionFromResult('', 'dev'), null);
    });

    it('should handle action JSON embedded in longer text', () => {
      const text = 'I have completed the task. Here is my response: {"action":"to_human","from":"arch","to":"human","ts":999,"message":"module 1 完成"} That is all.';
      const action = extractActionFromResult(text, 'arch');

      assert.strictEqual(action.action, 'to_human');
      assert.strictEqual(action.from, 'arch');
      assert.strictEqual(action.message, 'module 1 完成');
    });

    it('should skip malformed JSON that matches regex but is not valid', () => {
      const text = '{"action":"to_arch","from":"dev","to":"arch","message":"ok but no closing brace';
      assert.strictEqual(extractActionFromResult(text, 'dev'), null);
    });
  });

  describe('buildFallbackAction', () => {
    it('should build to_human action with result text as message', () => {
      const action = buildFallbackAction('hello world', 'arch');

      assert.strictEqual(action.action, 'to_human');
      assert.strictEqual(action.from, 'arch');
      assert.strictEqual(action.to, 'human');
      assert.strictEqual(action.message, 'hello world');
      assert.ok(typeof action.ts === 'number');
    });
  });

  describe('hasNewWritesSince', () => {
    it('should return true when new lines from role exist after offset', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      const initial = '{"action":"to_arch","from":"human","to":"arch","ts":1,"message":"hi"}\n';
      fs.writeFileSync(file, initial);
      const offset = Buffer.byteLength(initial);

      // Add a new line from 'arch'
      fs.appendFileSync(file, '{"action":"to_human","from":"arch","to":"human","ts":2,"message":"reply"}\n');

      assert.strictEqual(hasNewWritesSince(file, offset, 'arch'), true);
    });

    it('should return false when no new lines from role exist', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      const initial = '{"action":"to_arch","from":"human","to":"arch","ts":1,"message":"hi"}\n';
      fs.writeFileSync(file, initial);
      const offset = Buffer.byteLength(initial);

      // Add a line from different role
      fs.appendFileSync(file, '{"action":"to_arch","from":"dev","to":"arch","ts":2,"message":"dev msg"}\n');

      assert.strictEqual(hasNewWritesSince(file, offset, 'arch'), false);
    });

    it('should return false when file size has not grown', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      fs.writeFileSync(file, '{"action":"x","from":"arch","to":"human","ts":1,"message":"m"}\n');
      const offset = fs.statSync(file).size;

      assert.strictEqual(hasNewWritesSince(file, offset, 'arch'), false);
    });

    it('should return false for non-existent file', () => {
      assert.strictEqual(hasNewWritesSince('/tmp/nonexistent-xyz.jsonl', 0, 'arch'), false);
    });
  });

  describe('getFileOffset', () => {
    it('should return current file size', () => {
      const file = path.join(tmpDir, 'test.jsonl');
      fs.writeFileSync(file, 'hello\n');
      assert.strictEqual(getFileOffset(file), 6);
    });

    it('should return 0 for non-existent file', () => {
      assert.strictEqual(getFileOffset('/tmp/nonexistent-xyz.jsonl'), 0);
    });
  });

  describe('applyFallback', () => {
    it('should append fallback action when no agent writes detected', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      fs.writeFileSync(file, '');
      const spawnOffset = 0;

      const stdout = '{"type":"result","result":"task completed"}\n';

      const result = applyFallback({ stdout, role: 'arch', actionsFilePath: file, spawnOffset });

      assert.strictEqual(result.applied, true);
      assert.strictEqual(result.reason, 'fallback-applied');
      assert.strictEqual(result.action.action, 'to_human');
      assert.strictEqual(result.action.from, 'arch');
      assert.strictEqual(result.action.message, 'task completed');

      // Verify file written
      const content = fs.readFileSync(file, 'utf-8').trim();
      const parsed = JSON.parse(content);
      assert.strictEqual(parsed.action, 'to_human');
      assert.strictEqual(parsed.from, 'arch');
    });

    it('should not append when agent already wrote to actions.jsonl', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      fs.writeFileSync(file, '');
      const spawnOffset = 0;

      // Agent wrote during execution
      fs.appendFileSync(file, '{"action":"to_human","from":"dev","to":"human","ts":1,"message":"done"}\n');

      const stdout = '{"type":"result","result":"also done"}\n';

      const result = applyFallback({ stdout, role: 'dev', actionsFilePath: file, spawnOffset });

      assert.strictEqual(result.applied, false);
      assert.strictEqual(result.reason, 'already-written');
    });

    it('should not append when stdout has no result event', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      fs.writeFileSync(file, '');

      const stdout = '{"type":"system","subtype":"init"}\n';

      const result = applyFallback({ stdout, role: 'arch', actionsFilePath: file, spawnOffset: 0 });

      assert.strictEqual(result.applied, false);
      assert.strictEqual(result.reason, 'no-result');
    });

    it('should not append when stdout is empty', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      fs.writeFileSync(file, '');

      const result = applyFallback({ stdout: '', role: 'arch', actionsFilePath: file, spawnOffset: 0 });

      assert.strictEqual(result.applied, false);
      assert.strictEqual(result.reason, 'no-result');
    });

    it('should extract embedded action JSON from result text when present', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      fs.writeFileSync(file, '');

      const stdout = '{"type":"result","result":"ok. {\\"action\\":\\"to_arch\\",\\"from\\":\\"dev\\",\\"to\\":\\"arch\\",\\"ts\\":100,\\"message\\":\\"feature done\\"}"}\n';

      const result = applyFallback({ stdout, role: 'dev', actionsFilePath: file, spawnOffset: 0 });

      assert.strictEqual(result.applied, true);
      // Should extract the embedded action, not build fallback
      assert.strictEqual(result.action.action, 'to_arch');
      assert.strictEqual(result.action.from, 'dev');
      assert.strictEqual(result.action.to, 'arch');
    });

    it('should use spawnOffset to only check writes after spawn', () => {
      const file = path.join(tmpDir, 'actions.jsonl');
      // Pre-existing line from arch (before spawn)
      const preLine = '{"action":"to_human","from":"arch","to":"human","ts":1,"message":"old"}\n';
      fs.writeFileSync(file, preLine);
      const spawnOffset = Buffer.byteLength(preLine);

      // No new writes from arch after spawn
      const stdout = '{"type":"result","result":"new reply"}\n';

      const result = applyFallback({ stdout, role: 'arch', actionsFilePath: file, spawnOffset });

      assert.strictEqual(result.applied, true);
      assert.strictEqual(result.action.message, 'new reply');
    });
  });
});
