'use strict';

/**
 * Feature #7 - E2E Test 2: Date rollover creates new log file
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Checkpoint coverage:
 *   Step 3: When date changes (simulated), automatically creates new log file
 *
 * Approach:
 * - Uses AgentScheduler with real claude and a custom AgentLogger with controllable dateProvider
 * - Executes tasks across a simulated date boundary
 * - Verifies new log file is created for the new date
 * - Both the old and new log files exist with correct content
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const AgentScheduler = require('../../src/agent-scheduler');
const AgentLogger = require('../../src/agent-logger');

describe('Feature #7 - Date rollover creates new log file via REAL claude', { timeout: 300_000 }, () => {
  let tmpDir;
  let logDir;
  let projectJsonPath;
  let specDir;

  function realSpawn(cmd, args, opts) {
    return spawn(cmd, args, { ...opts, cwd: tmpDir });
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f7-e2e-test2-real-'));
    logDir = path.join(tmpDir, 'logs');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    fs.mkdirSync(specDir, { recursive: true });

    // Create initial project json with no current arch session.
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      name: 'test-project',
      partner: {
        arch_agent: { session: { runing: null } },
      },
    }));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 3: Date change triggers new log file creation', async () => {
    // Controllable date provider - starts at day 1
    let simulatedDate = '2026-05-24';

    const agentLogger = new AgentLogger({
      logDir,
      dateProvider: () => simulatedDate,
    });

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      agentLogger,
      spawnFn: realSpawn,
    });

    // === First execution on day 1 ===
    const action1 = {
      action: 'to_arch',
      from: 'human',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: '只回复 "day 1 确认"',
    };

    const completed1 = new Promise((resolve, reject) => {
      scheduler.once('completed', resolve);
      scheduler.once('error', reject);
      setTimeout(() => reject(new Error('Timeout day 1')), 90_000);
    });

    scheduler.dispatch(action1);
    await completed1;

    // Verify day 1 log exists
    const day1Log = path.join(logDir, 'arch_2026-05-24.log');
    // Wait for flush
    await new Promise(r => setTimeout(r, 500));
    assert.ok(fs.existsSync(day1Log), 'Day 1 log should exist: arch_2026-05-24.log');

    const day1Content = fs.readFileSync(day1Log, 'utf-8');
    assert.ok(day1Content.trim().length > 0, 'Day 1 log should have content');

    // === Simulate date change to day 2 ===
    simulatedDate = '2026-05-25';

    const action2 = {
      action: 'to_arch',
      from: 'human',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: '只回复 "day 2 确认"',
    };

    const completed2 = new Promise((resolve, reject) => {
      scheduler.once('completed', resolve);
      scheduler.once('error', reject);
      setTimeout(() => reject(new Error('Timeout day 2')), 90_000);
    });

    scheduler.dispatch(action2);
    await completed2;

    // Wait for flush
    agentLogger.closeAll();
    await new Promise(r => setTimeout(r, 500));

    // Verify day 2 log exists
    const day2Log = path.join(logDir, 'arch_2026-05-25.log');
    assert.ok(fs.existsSync(day2Log), 'Day 2 log should exist: arch_2026-05-25.log');

    const day2Content = fs.readFileSync(day2Log, 'utf-8');
    assert.ok(day2Content.trim().length > 0, 'Day 2 log should have content');

    // Verify day 1 log still exists (not overwritten)
    assert.ok(fs.existsSync(day1Log), 'Day 1 log should still exist after rollover');

    // Verify both files contain valid stream-json
    const day1Lines = day1Content.trim().split('\n').filter(l => l.trim());
    const day2Lines = day2Content.trim().split('\n').filter(l => l.trim());

    for (const line of day1Lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.type, 'Day 1 JSON should have type field');
    }
    for (const line of day2Lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.type, 'Day 2 JSON should have type field');
    }

    // Verify the two files each have meaningful content
    assert.ok(day1Lines.length >= 2, 'Day 1 should have at least init+result');
    assert.ok(day2Lines.length >= 2, 'Day 2 should have at least init+result');
  });
});
