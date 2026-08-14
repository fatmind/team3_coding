'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { loadProvider, loadCodeCliConfig } = require('../src/code-cli');
const claudeCode = require('../src/code-cli/claude-code');
const qoderCode = require('../src/code-cli/qoder-code');

describe('code-cli providers', () => {
  describe('loadProvider', () => {
    it('should return claude-code provider', () => {
      const p = loadProvider({ type: 'claude-code' });
      assert.strictEqual(p.name, 'claude-code');
      assert.strictEqual(p.command, 'claude');
    });

    it('should return qoder-code provider', () => {
      const p = loadProvider({ type: 'qoder-code' });
      assert.strictEqual(p.name, 'qoder-code');
      assert.strictEqual(p.command, 'qodercli');
    });

    it('should accept qodercli as backward-compat alias', () => {
      const p = loadProvider({ type: 'qodercli' });
      assert.strictEqual(p.name, 'qoder-code');
      assert.strictEqual(p.command, 'qodercli');
    });

    it('should honor a custom command override (e.g. qoderclicn)', () => {
      const p = loadProvider({ type: 'qoder-code', command: 'qoderclicn' });
      assert.strictEqual(p.name, 'qoder-code');
      assert.strictEqual(p.command, 'qoderclicn');
      assert.strictEqual(typeof p.buildArgs, 'function');
    });

    it('should not mutate the shared provider singleton when overriding command', () => {
      loadProvider({ type: 'qoder-code', command: 'qoderclicn' });
      const p = loadProvider({ type: 'qoder-code' });
      assert.strictEqual(p.command, 'qodercli');
    });

    it('should throw on unknown type', () => {
      assert.throws(() => loadProvider({ type: 'unknown' }), /Unknown codeCli type/);
    });

    it('should throw when config is missing', () => {
      assert.throws(() => loadProvider(null), /missing/);
    });
  });

  describe('claude-code provider', () => {
    it('buildArgs: new session includes --verbose and --session-id', () => {
      const args = claudeCode.buildArgs({ prompt: 'hi', sessionId: 'abc-123', isNew: true, role: 'arch' });
      assert.ok(args.includes('--verbose'));
      assert.ok(args.includes('--session-id'));
      assert.ok(args.includes('abc-123'));
      assert.ok(args.includes('-p'));
      assert.ok(args.includes('hi'));
      assert.ok(args.includes('--output-format'));
      assert.ok(args.includes('stream-json'));
    });

    it('buildArgs: resume session includes --resume, no --session-id', () => {
      const args = claudeCode.buildArgs({ prompt: 'hi', sessionId: 'abc-123', isNew: false, role: 'dev' });
      assert.ok(args.includes('--resume'));
      assert.ok(!args.includes('--session-id'));
    });

    it('parseStdoutLine: parses assistant text event', () => {
      const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello world' }] } });
      const result = claudeCode.parseStdoutLine(line);
      assert.ok(result);
      assert.strictEqual(result[0].content, 'hello world');
    });

    it('parseStdoutLine: skips system events', () => {
      const line = JSON.stringify({ type: 'system', subtype: 'init' });
      assert.strictEqual(claudeCode.parseStdoutLine(line), null);
    });

    it('parseStdoutLine: skips result events', () => {
      const line = JSON.stringify({ type: 'result', result: 'done' });
      assert.strictEqual(claudeCode.parseStdoutLine(line), null);
    });

    it('extractResult: gets last result text', () => {
      const stdout = [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working...' }] } }),
        JSON.stringify({ type: 'result', result: 'final answer' }),
      ].join('\n');
      assert.strictEqual(claudeCode.extractResult(stdout), 'final answer');
    });

    it('isMissingSessionError: detects no conversation found in stderr', () => {
      assert.ok(claudeCode.isMissingSessionError(1, 'Error: No conversation found for id abc', ''));
      assert.ok(!claudeCode.isMissingSessionError(1, 'Some other error', ''));
    });

    it('buildArgs: replaces {cwd} in system prompt with workspaceDir', () => {
      const args = claudeCode.buildArgs({
        prompt: 'hi', sessionId: 'abc-123', isNew: true, role: 'arch',
        workspaceDir: '/home/user/my-project',
      });
      const sysPromptIdx = args.indexOf('--system-prompt');
      assert.ok(sysPromptIdx >= 0);
      const sysPrompt = args[sysPromptIdx + 1];
      assert.ok(!sysPrompt.includes('{cwd}'), 'system prompt should not contain {cwd} placeholder');
      assert.ok(sysPrompt.includes('/home/user/my-project'), 'system prompt should contain workspaceDir');
    });
  });

  describe('qoder-code provider', () => {
    it('buildArgs: no --verbose flag', () => {
      const args = qoderCode.buildArgs({ prompt: 'hi', sessionId: 'abc-123', isNew: true, role: 'arch' });
      assert.ok(!args.includes('--verbose'));
      assert.ok(args.includes('--session-id'));
      assert.ok(args.includes('--output-format'));
      assert.ok(args.includes('stream-json'));
    });

    it('buildArgs: adds --dangerously-skip-permissions when TEAM3_SUPERMAN=1', () => {
      const prev = process.env.TEAM3_SUPERMAN;
      process.env.TEAM3_SUPERMAN = '1';
      try {
        const args = qoderCode.buildArgs({ prompt: 'hi', sessionId: 'abc-123', isNew: true, role: 'arch' });
        assert.ok(args.includes('--dangerously-skip-permissions'));
      } finally {
        if (prev === undefined) delete process.env.TEAM3_SUPERMAN;
        else process.env.TEAM3_SUPERMAN = prev;
      }
    });

    it('parseStdoutLine: parses same format as claude-code', () => {
      const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '好' }] } });
      const result = qoderCode.parseStdoutLine(line);
      assert.ok(result);
      assert.strictEqual(result[0].content, '好');
    });

    it('extractResult: works with qoder-code output', () => {
      const stdout = JSON.stringify({ type: 'result', subtype: 'success', result: '好' });
      assert.strictEqual(qoderCode.extractResult(stdout), '好');
    });

    it('isMissingSessionError: returns true for exit code 42', () => {
      assert.ok(qoderCode.isMissingSessionError(42, '', ''));
      assert.ok(qoderCode.isMissingSessionError(42, null, null));
    });

    it('isMissingSessionError: returns false for other exit codes', () => {
      assert.ok(!qoderCode.isMissingSessionError(1, '', ''));
      assert.ok(!qoderCode.isMissingSessionError(0, '', ''));
      assert.ok(!qoderCode.isMissingSessionError(137, '', ''));
    });

    it('buildArgs: replaces {cwd} in system prompt with workspaceDir', () => {
      const args = qoderCode.buildArgs({
        prompt: 'hi', sessionId: 'abc-123', isNew: true, role: 'dev',
        workspaceDir: '/tmp/test-project',
      });
      const sysPromptIdx = args.indexOf('--system-prompt');
      const sysPrompt = args[sysPromptIdx + 1];
      assert.ok(!sysPrompt.includes('{cwd}'));
      assert.ok(sysPrompt.includes('/tmp/test-project'));
    });
  });

  describe('loadCodeCliConfig', () => {
    it('should read config from given path', () => {
      const tmpFile = path.join(os.tmpdir(), `team3-config-test-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({ codeCli: { type: 'qoder-code', command: 'qodercli' } }));
      const result = loadCodeCliConfig(tmpFile);
      assert.strictEqual(result.type, 'qoder-code');
      fs.unlinkSync(tmpFile);
    });

    it('should throw if file does not exist', () => {
      assert.throws(() => loadCodeCliConfig('/tmp/nonexistent-team3-config.json'), /not found/);
    });
  });
});
