'use strict';

/**
 * Integration Test: Step 1 & 2 (Feature #13)
 * "Spawn a simulated hanging process (sleep), configure short timeout,
 *  verify timeout SIGTERM kill + messages prepend back to queue + re-execution"
 *
 * Uses a real spawned process (node -e "setTimeout(...)") that hangs,
 * with short timeout (2s) to verify timeout kill behavior.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const AgentScheduler = require('../../src/agent-scheduler');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Timeout kill + retry (Feature #13, Step 1 & 2)', { timeout: 60_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat13-timeout-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');
    actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT');

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'aaaaaaaa-1111-4222-8333-444444444444' } },
        dev_agent: { session: { runing: 'dddddddd-1111-4222-8333-444444444444', done: [] } },
        uat_agent: { session: { runing: 'uuuuuuuu-1111-4222-8333-444444444444' } },
      }
    }, null, 2));

    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should timeout and SIGTERM kill a hanging process, then retry', async () => {
    let spawnCount = 0;
    const spawnEvents = [];
    const completedEvents = [];
    const timeoutEvents = [];
    const retryEvents = [];

    // spawnFn: first call hangs (sleep 999), second call exits 0 quickly
    function testSpawn(cmd, args, opts) {
      spawnCount++;
      const current = spawnCount;

      if (current === 1) {
        // First attempt: spawn a process that hangs (never exits on its own)
        const proc = spawn('node', ['-e', 'setTimeout(() => {}, 999000)'], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return proc;
      } else {
        // Second attempt (after retry): spawn a process that exits immediately with 0
        const proc = spawn('node', ['-e', 'process.stdout.write("ok"); process.exit(0)'], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return proc;
      }
    }

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: testSpawn,
      claudeTimeoutMs: 2000,       // 2s timeout (short for testing)
      claudeKillGraceMs: 1000,     // 1s grace
      claudeRetryDelayMs: 500,     // 0.5s retry delay
      claudeMaxRetries: 3,
      actionsFilePath: actionsFile,
    });

    scheduler.on('spawn', (info) => spawnEvents.push(info));
    scheduler.on('completed', (info) => completedEvents.push(info));
    scheduler.on('timeout', (info) => timeoutEvents.push(info));
    scheduler.on('retry', (info) => retryEvents.push(info));

    // Dispatch a message
    scheduler.dispatch({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'test timeout behavior',
    });

    // Wait for timeout (2s) + grace (1s) + retry delay (0.5s) + second exec
    // Total: ~4.5s max, use 8s to be safe
    await sleep(8000);

    // Verify Step 1: Process was killed after timeout
    assert.strictEqual(timeoutEvents.length, 1);
    assert.strictEqual(timeoutEvents[0].role, 'arch');
    assert.strictEqual(timeoutEvents[0].timeoutMs, 2000);

    // First completed should be timedOut=true
    const timedOutCompletion = completedEvents.find(e => e.timedOut === true);
    assert.ok(timedOutCompletion, 'Should have a timed-out completion event');
    assert.strictEqual(timedOutCompletion.role, 'arch');

    // Verify Step 2: Messages were prepended and re-executed
    assert.strictEqual(retryEvents.length, 1);
    assert.strictEqual(retryEvents[0].retryCount, 1);
    assert.strictEqual(spawnCount, 2, 'Should have spawned twice (initial + retry)');

    // Second spawn should succeed (exit 0)
    const successCompletion = completedEvents.find(e => e.exitCode === 0);
    assert.ok(successCompletion, 'Second attempt should succeed');

    // Agent should be idle after success
    assert.strictEqual(scheduler.isAgentBusy('arch'), false);

    scheduler.clearAllTimers();
  });
});
