'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildClaudeArgs } = require('../src/claude-args');

describe('claude-args (shared module)', () => {
  describe('buildClaudeArgs', () => {
    it('should build args with --session-id for new session', () => {
      const args = buildClaudeArgs({
        prompt: 'hello world',
        sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        isNew: true,
        role: 'arch',
      });

      assert.strictEqual(args[0], '-p');
      assert.strictEqual(args[1], 'hello world');
      assert.ok(args.includes('--session-id'));
      assert.ok(args.includes('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
      assert.ok(args.includes('--system-prompt'));
      assert.ok(args.includes('--output-format'));
      assert.ok(args.includes('--verbose'));
    });

    it('should build args with --resume for existing session', () => {
      const args = buildClaudeArgs({
        prompt: 'fix the bug',
        sessionId: '11111111-2222-4333-a444-555555555555',
        isNew: false,
        role: 'dev',
      });

      assert.ok(args.includes('--resume'));
      assert.ok(args.includes('11111111-2222-4333-a444-555555555555'));
      assert.ok(!args.includes('--session-id'));
    });

    it('should use --system-prompt with embedded content', () => {
      const args = buildClaudeArgs({
        prompt: 'test',
        sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
        isNew: true,
        role: 'arch',
      });

      const idx = args.indexOf('--system-prompt');
      assert.ok(idx >= 0, 'must include --system-prompt');
      // The value after --system-prompt should be the embedded prompt content
      assert.ok(args[idx + 1].length > 100, 'embedded prompt should be substantial');
    });

    it('should always include -p as first arg pair', () => {
      const args = buildClaudeArgs({
        prompt: 'test prompt',
        sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
        isNew: true,
        role: 'uat',
      });

      assert.strictEqual(args[0], '-p');
      assert.strictEqual(args[1], 'test prompt');
    });

    it('should always include --output-format stream-json', () => {
      const args = buildClaudeArgs({
        prompt: 'x',
        sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
        isNew: false,
        role: 'dev',
      });

      const fmtIdx = args.indexOf('--output-format');
      assert.ok(fmtIdx >= 0);
      assert.strictEqual(args[fmtIdx + 1], 'stream-json');
    });

    it('should always include --verbose', () => {
      const args = buildClaudeArgs({
        prompt: 'x',
        sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
        isNew: true,
        role: 'arch',
      });

      assert.ok(args.includes('--verbose'));
    });

    it('should throw if prompt is missing', () => {
      assert.throws(() => {
        buildClaudeArgs({
          sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
          isNew: true,
          role: 'arch',
        });
      }, /prompt is required/);
    });

    it('should throw if sessionId is missing', () => {
      assert.throws(() => {
        buildClaudeArgs({
          prompt: 'hi',
          isNew: true,
          role: 'arch',
        });
      }, /sessionId is required/);
    });

    it('should throw if role is missing', () => {
      assert.throws(() => {
        buildClaudeArgs({
          prompt: 'hi',
          sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
          isNew: true,
        });
      }, /role is required/);
    });

    it('should not include --session-id when isNew is false', () => {
      const args = buildClaudeArgs({
        prompt: 'x',
        sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
        isNew: false,
        role: 'arch',
      });

      assert.ok(!args.includes('--session-id'));
      assert.ok(args.includes('--resume'));
    });

    it('should not include --resume when isNew is true', () => {
      const args = buildClaudeArgs({
        prompt: 'x',
        sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
        isNew: true,
        role: 'dev',
      });

      assert.ok(args.includes('--session-id'));
      assert.ok(!args.includes('--resume'));
    });
  });
});
