'use strict';

/**
 * Feature #7 - E2E Test 1: Agent log file creation and content
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Checkpoint coverage:
 *   Step 1: Agent executes a task → corresponding log file created (logs/arch_YYYY-MM-DD.log)
 *   Step 2: Log content contains claude code stream-json raw output
 *   Step 4: Different Agents (arch/dev/uat) each have independent log files
 *
 * Approach:
 * - Uses AgentScheduler with real claude (real spawn)
 * - Verifies log files are created in the correct directory
 * - Verifies log content is valid stream-json from real claude
 * - Verifies arch, dev, uat each get independent log files
 * - Uses spawn events to capture session IDs for independence verification
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const AgentScheduler = require('../../src/agent-scheduler');

describe('Feature #7 - Log file creation and stream-json content via REAL claude', { timeout: 300_000 }, () => {
  let tmpDir;
  let logDir;
  let projectJsonPath;
  let specDir;

  function realSpawn(cmd, args, opts) {
    return spawn(cmd, args, { ...opts, cwd: tmpDir });
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f7-e2e-test1-real-'));
    logDir = path.join(tmpDir, 'logs');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    fs.mkdirSync(specDir, { recursive: true });

    // Create initial project json with no current arch/uat session.
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      name: 'test-project',
      partner: {
        arch_agent: { session: { runing: null } },
        dev_agent: { session: { runing: 'd1e2f3a4-b5c6-7890-abcd-ef1234567890', done: [] } },
        uat_agent: { session: { runing: null } },
      },
    }));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 1 & 2: Agent execution creates log file with stream-json content', async () => {
    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      logDir,
      spawnFn: realSpawn,
    });

    // Dispatch to_arch action
    const action = {
      action: 'to_arch',
      from: 'human',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: '只回复 "确认收到"',
    };

    const completedPromise = new Promise((resolve, reject) => {
      scheduler.on('completed', resolve);
      scheduler.on('error', reject);
      setTimeout(() => reject(new Error('Timeout waiting for completion')), 90_000);
    });

    scheduler.dispatch(action);
    const result = await completedPromise;

    assert.equal(result.role, 'arch');
    assert.equal(result.exitCode, 0);

    // Verify log file was created
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const logPath = path.join(logDir, `arch_${dateStr}.log`);

    assert.ok(fs.existsSync(logPath), `Log file should exist: ${logPath}`);

    // Verify content is stream-json
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 2, `Should have at least 2 JSON lines, got ${lines.length}`);

    // Parse each line as JSON (stream-json format)
    const parsed = lines.map(l => JSON.parse(l));
    // Should contain an init event (real claude may output hook_started before init)
    const initEvent = parsed.find(p => p.type === 'system' && p.subtype === 'init');
    assert.ok(initEvent, 'Should contain a system/init event in stream-json output');
    // Last line should be result
    assert.equal(parsed[parsed.length - 1].type, 'result');
    assert.equal(parsed[parsed.length - 1].subtype, 'success');

    // Clean up logger
    scheduler.agentLogger.closeAll();
  });

  it('Step 4: Different agents get independent log files', async () => {
    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      logDir,
      spawnFn: realSpawn,
    });

    // Capture session IDs from spawn events for independence verification
    const spawnedSessions = {};
    scheduler.on('spawn', (info) => {
      spawnedSessions[info.role] = info.sessionId;
    });

    // Dispatch to arch, dev, and uat
    const actions = [
      { action: 'to_arch', from: 'human', to: 'arch', ts: Math.floor(Date.now() / 1000), message: '只回复 "arch ok"' },
      { action: 'dev_do', from: 'arch', to: 'dev', ts: Math.floor(Date.now() / 1000), message: '只回复 "dev ok"' },
      { action: 'uat_check', from: 'arch', to: 'uat', ts: Math.floor(Date.now() / 1000), message: '只回复 "uat ok"' },
    ];

    // Wait for all three to complete
    let completedCount = 0;
    const completedRoles = [];
    const allDone = new Promise((resolve, reject) => {
      scheduler.on('completed', (data) => {
        completedRoles.push(data.role);
        completedCount++;
        if (completedCount === 3) resolve();
      });
      scheduler.on('error', (data) => {
        completedRoles.push(`error:${data.role}`);
        completedCount++;
        if (completedCount === 3) resolve();
      });
      setTimeout(() => reject(new Error(`Timeout: only ${completedCount}/3 completed (${completedRoles.join(', ')})`)), 120_000);
    });

    for (const a of actions) {
      scheduler.dispatch(a);
    }
    await allDone;

    // Verify each role has its own log file
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const archLog = path.join(logDir, `arch_${dateStr}.log`);
    const devLog = path.join(logDir, `dev_${dateStr}.log`);
    const uatLog = path.join(logDir, `uat_${dateStr}.log`);

    // Wait for streams to flush
    scheduler.agentLogger.closeAll();
    await new Promise(r => setTimeout(r, 500));

    assert.ok(fs.existsSync(archLog), 'arch log should exist');
    assert.ok(fs.existsSync(devLog), 'dev log should exist');
    assert.ok(fs.existsSync(uatLog), 'uat log should exist');

    // Verify each contains valid stream-json
    for (const logFile of [archLog, devLog, uatLog]) {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.trim());
      assert.ok(lines.length >= 2, `${path.basename(logFile)} should have >= 2 lines`);
      // Every line should be valid JSON
      for (const line of lines) {
        assert.doesNotThrow(() => JSON.parse(line), `Invalid JSON in ${path.basename(logFile)}: ${line}`);
      }
    }

    // Verify logs are independent using captured session IDs
    const archContent = fs.readFileSync(archLog, 'utf-8');
    const devContent = fs.readFileSync(devLog, 'utf-8');
    const uatContent = fs.readFileSync(uatLog, 'utf-8');

    const archSessionId = spawnedSessions.arch;
    const devSessionId = spawnedSessions.dev;
    const uatSessionId = spawnedSessions.uat;

    assert.ok(archSessionId, 'arch should have a session ID');
    assert.ok(devSessionId, 'dev should have a session ID');
    assert.ok(uatSessionId, 'uat should have a session ID');

    // All session IDs should be different
    assert.notEqual(archSessionId, devSessionId, 'arch and dev should have different sessions');
    assert.notEqual(archSessionId, uatSessionId, 'arch and uat should have different sessions');
    assert.notEqual(devSessionId, uatSessionId, 'dev and uat should have different sessions');

    // Each log should contain its own session ID (from stream-json init event)
    assert.ok(archContent.includes(archSessionId),
      'arch log should reference arch session ID');
    // Dev log should NOT contain arch session ID
    assert.ok(!devContent.includes(archSessionId),
      'dev log should not reference arch session ID');
    // Uat log should contain uat session ID
    assert.ok(uatContent.includes(uatSessionId),
      'uat log should reference uat session ID');
  });
});
