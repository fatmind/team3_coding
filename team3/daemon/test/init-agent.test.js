'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const {
  initAgent,
  generateSessionId,
  buildClaudeArgs,
  getArchInitPrompt,
} = require('../src/init-agent');

describe('init-agent', () => {
  let tmpDir;
  let projectJsonPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-agent-test-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      init_daemon: 12345,
      daemon_heart: '2026-05-24T10:00:00.000Z',
    }, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateSessionId', () => {
    it('should generate a valid UUID v4', () => {
      const uuid = generateSessionId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      assert.match(uuid, uuidRegex);
    });

    it('should generate lowercase UUIDs', () => {
      const uuid = generateSessionId();
      assert.strictEqual(uuid, uuid.toLowerCase());
    });

    it('should generate unique UUIDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSessionId());
      }
      assert.strictEqual(ids.size, 100);
    });
  });

  describe('getArchInitPrompt', () => {
    it('should return a non-empty prompt string', () => {
      const prompt = getArchInitPrompt();
      assert.ok(prompt.length > 0);
      assert.ok(prompt.includes('actions.jsonl'));
    });
  });

  describe('buildClaudeArgs (re-exported from claude-args.js)', () => {
    it('should build args with --session-id for new session', () => {
      const args = buildClaudeArgs({
        prompt: 'Hello arch',
        sessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        isNew: true,
        role: 'arch',
      });

      assert.ok(args.includes('--session-id'));
      assert.ok(args.includes('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'));
      assert.ok(args.includes('--system-prompt'));
      assert.ok(args.includes('--output-format'));
      assert.ok(args.includes('stream-json'));
      assert.ok(args.includes('-p'));
      assert.ok(args.includes('Hello arch'));
    });

    it('should build args with --resume for existing session', () => {
      const args = buildClaudeArgs({
        prompt: 'Resume task',
        sessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        isNew: false,
        role: 'dev',
      });

      assert.ok(args.includes('--resume'));
      assert.ok(!args.includes('--session-id'));
      assert.ok(args.includes('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'));
    });

    it('should throw when prompt is missing', () => {
      assert.throws(() => {
        buildClaudeArgs({
          sessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          isNew: true,
          role: 'uat',
        });
      }, /prompt is required/);
    });
  });

  describe('initAgent', () => {
    function createMockSpawn() {
      const mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.stdin = { write: () => {}, end: () => {} };
      mockProcess.pid = 99999;
      mockProcess.kill = () => {};

      const spawnFn = (cmd, args, opts) => {
        spawnFn.lastCall = { cmd, args, opts };
        spawnFn.calls.push({ cmd, args, opts });
        return mockProcess;
      };
      spawnFn.calls = [];
      spawnFn.lastCall = null;
      spawnFn.mockProcess = mockProcess;

      return spawnFn;
    }

    it('should reject invalid roles', async () => {
      await assert.rejects(
        () => initAgent('invalid'),
        { message: /Invalid agent role/ }
      );
    });

    it('should reject dev role (only arch/uat supported)', async () => {
      await assert.rejects(
        () => initAgent('dev'),
        { message: /Invalid agent role/ }
      );
    });

    it('should generate valid UUID v4 and write to project json for arch', async () => {
      const mockSpawn = createMockSpawn();
      const specDir = path.join(tmpDir, 'spec');
      fs.mkdirSync(specDir, { recursive: true });

      const result = await initAgent('arch', {
        projectJsonPath,
        specDir,
        spawnFn: mockSpawn,
      });

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      assert.match(result.sessionId, uuidRegex);

      const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      assert.strictEqual(data.partner.arch_agent.session.runing, result.sessionId);
    });

    it('should generate valid UUID v4 and write to project json for uat', async () => {
      const mockSpawn = createMockSpawn();
      const specDir = path.join(tmpDir, 'spec');
      fs.mkdirSync(specDir, { recursive: true });

      const result = await initAgent('uat', {
        projectJsonPath,
        specDir,
        spawnFn: mockSpawn,
      });

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      assert.match(result.sessionId, uuidRegex);

      const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      assert.strictEqual(data.partner.uat_agent.session.runing, result.sessionId);
    });

    it('should spawn claude with --system-prompt (embedded) for arch', async () => {
      const mockSpawn = createMockSpawn();
      const specDir = path.join(tmpDir, 'spec');
      fs.mkdirSync(specDir, { recursive: true });

      const result = await initAgent('arch', {
        projectJsonPath,
        specDir,
        spawnFn: mockSpawn,
      });

      assert.strictEqual(mockSpawn.calls.length, 1);
      const call = mockSpawn.lastCall;
      assert.strictEqual(call.cmd, 'claude');

      const args = call.args;
      assert.ok(args.includes('--session-id'));
      assert.ok(args.includes(result.sessionId));
      assert.ok(args.includes('--system-prompt'));
      assert.ok(!args.includes('--system-prompt-file'));
      assert.ok(args.includes('--output-format'));
      assert.ok(args.includes('stream-json'));
      assert.ok(args.includes('-p'));

      const pIndex = args.indexOf('-p');
      assert.ok(args[pIndex + 1].includes('actions.jsonl'));
    });

    it('should use custom uuidFn when provided', async () => {
      const mockSpawn = createMockSpawn();
      const fixedUuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
      const specDir = path.join(tmpDir, 'spec');
      fs.mkdirSync(specDir, { recursive: true });

      const result = await initAgent('arch', {
        projectJsonPath,
        specDir,
        spawnFn: mockSpawn,
        uuidFn: () => fixedUuid,
      });

      assert.strictEqual(result.sessionId, fixedUuid);
    });

    it('should reject invalid UUID from custom uuidFn', async () => {
      const mockSpawn = createMockSpawn();
      const specDir = path.join(tmpDir, 'spec');
      fs.mkdirSync(specDir, { recursive: true });

      await assert.rejects(
        () => initAgent('arch', {
          projectJsonPath,
          specDir,
          spawnFn: mockSpawn,
          uuidFn: () => 'NOT-A-VALID-UUID',
        }),
        { message: /Generated invalid UUID/ }
      );
    });
  });
});
