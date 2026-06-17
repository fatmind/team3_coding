'use strict';

/**
 * Integration Test: init_agent(arch)
 *
 * Checkpoint Step 1: 调用 init_agent(arch)，生成合法 UUID v4 写入 .team3-project.json 的 arch_agent.session.runing
 * Checkpoint Step 3: arch 首次启动使用 --session-id + --system-prompt-file + --output-format stream-json
 * Checkpoint Step 4: arch 启动时通过 -p 要求 arch 写 actions.jsonl 通知人类
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { initAgent } = require('../../src/init-agent');

describe('Integration: init_agent(arch)', () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let spawnCalls = [];
  let mockProcess;

  // Create a mock spawn that records calls (no async side effects)
  function createMockSpawn() {
    const EventEmitter = require('events');

    return (cmd, args, opts) => {
      spawnCalls.push({ cmd, args, opts });

      mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.stdin = { write: () => {}, end: () => {} };
      mockProcess.pid = 88888;
      mockProcess.kill = () => {};

      return mockProcess;
    };
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feature2-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    // Create project structure
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      init_daemon: process.pid,
      daemon_heart: new Date().toISOString(),
    }, null, 2));

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch Agent\nYou are the architect.');
    spawnCalls = [];
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 1: should generate valid UUID v4 and write to arch_agent.session.runing', async () => {
    const mockSpawn = createMockSpawn();

    const result = await initAgent('arch', {
      projectJsonPath,
      specDir,
      spawnFn: mockSpawn,
    });

    // Verify UUID v4 format (lowercase, valid)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.match(result.sessionId, uuidRegex, 'sessionId must be valid UUID v4');

    // Verify written to .team3-project.json
    const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.strictEqual(
      data.partner.arch_agent.session.runing,
      result.sessionId,
      'sessionId must be written to arch_agent.session.runing'
    );

    console.log(`✅ Step 1 PASS: arch sessionId = ${result.sessionId}`);
  });

  it('Step 3: should spawn claude with --session-id + --system-prompt + --output-format stream-json', async () => {
    assert.ok(spawnCalls.length >= 1, 'spawn should have been called');

    const call = spawnCalls[0];
    assert.strictEqual(call.cmd, 'claude', 'should spawn claude command');

    const args = call.args;

    // --session-id flag present with valid UUID
    const sessionIdIdx = args.indexOf('--session-id');
    assert.ok(sessionIdIdx >= 0, 'must include --session-id flag');
    const sessionId = args[sessionIdIdx + 1];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.match(sessionId, uuidRegex, '--session-id value must be valid UUID v4');

    // --system-prompt flag present with embedded content
    const sysPromptIdx = args.indexOf('--system-prompt');
    assert.ok(sysPromptIdx >= 0, 'must include --system-prompt flag');
    const promptContent = args[sysPromptIdx + 1];
    assert.ok(promptContent.length > 100, 'embedded prompt should be substantial');

    // --output-format stream-json
    const formatIdx = args.indexOf('--output-format');
    assert.ok(formatIdx >= 0, 'must include --output-format flag');
    assert.strictEqual(args[formatIdx + 1], 'stream-json', 'output-format must be stream-json');

    console.log(`✅ Step 3 PASS: claude spawned with correct flags`);
    console.log(`   --session-id ${sessionId}`);
    console.log(`   --system-prompt (embedded, ${promptContent.length} chars)`);
    console.log(`   --output-format stream-json`);
  });

  it('Step 4: should include -p prompt asking arch to write actions.jsonl notification', async () => {
    assert.ok(spawnCalls.length >= 1, 'spawn should have been called');

    const args = spawnCalls[0].args;
    const pIdx = args.indexOf('-p');
    assert.ok(pIdx >= 0, 'must include -p flag for initial prompt');

    const prompt = args[pIdx + 1];
    assert.ok(prompt.includes('actions.jsonl'), 'prompt must mention actions.jsonl');
    assert.ok(
      prompt.includes('to_human') || prompt.includes('通知人类'),
      'prompt must instruct arch to notify human'
    );

    console.log(`✅ Step 4 PASS: -p prompt instructs arch to write actions.jsonl`);
    console.log(`   prompt: ${prompt.substring(0, 80)}...`);
  });
});
