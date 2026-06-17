'use strict';

/**
 * Integration Test: init_agent(uat)
 *
 * Checkpoint Step 2: 调用 init_agent(uat)，生成合法 UUID v4 写入 .team3-project.json 的 uat_agent.session.runing
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const { initAgent } = require('../../src/init-agent');

describe('Integration: init_agent(uat)', () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;

  function createMockSpawn() {
    const mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = { write: () => {}, end: () => {} };
    mockProcess.pid = 77777;
    mockProcess.kill = () => {};

    return (cmd, args, opts) => mockProcess;
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feature2-uat-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    // Create project structure
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      init_daemon: process.pid,
      daemon_heart: new Date().toISOString(),
    }, null, 2));

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT Agent\nYou are the UAT verifier.');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 2: should generate valid UUID v4 and write to uat_agent.session.runing', async () => {
    const mockSpawn = createMockSpawn();

    const result = await initAgent('uat', {
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
      data.partner.uat_agent.session.runing,
      result.sessionId,
      'sessionId must be written to uat_agent.session.runing'
    );

    // Verify sessionId is different from arch (unique generation)
    console.log(`✅ Step 2 PASS: uat sessionId = ${result.sessionId}`);
  });

  it('Step 2 (additional): arch and uat get different sessionIds', async () => {
    // Reset project json
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      init_daemon: process.pid,
      daemon_heart: new Date().toISOString(),
    }, null, 2));

    // Also create arch prompt for init_agent to work
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');

    const mockSpawn = createMockSpawn();

    const archResult = await initAgent('arch', {
      projectJsonPath,
      specDir,
      spawnFn: mockSpawn,
    });

    const uatResult = await initAgent('uat', {
      projectJsonPath,
      specDir,
      spawnFn: mockSpawn,
    });

    assert.notStrictEqual(
      archResult.sessionId,
      uatResult.sessionId,
      'arch and uat must have different sessionIds'
    );

    // Both stored in project json
    const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.strictEqual(data.partner.arch_agent.session.runing, archResult.sessionId);
    assert.strictEqual(data.partner.uat_agent.session.runing, uatResult.sessionId);

    console.log(`✅ Step 2 (additional) PASS: arch=${archResult.sessionId}, uat=${uatResult.sessionId}`);
  });
});
