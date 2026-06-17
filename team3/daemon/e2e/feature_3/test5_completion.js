'use strict';

/**
 * Integration Test: Step 5 (Feature #3)
 * "Agent completion detection: exit code 0, non-zero exit, parallel execution"
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Strategy for non-zero exit: override spawnFn to force --resume with a
 * non-existent session UUID. Real claude will fail with "No conversation found"
 * and exit non-zero.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ActionWatcher = require('../../src/action-watcher');
const AgentScheduler = require('../../src/agent-scheduler');

describe('E2E: Agent completion detection via REAL claude (Step 5)', { timeout: 180_000 }, () => {
  let tmpDir;
  let filePath;
  let projectJsonPath;
  let specDir;
  let watcher;
  let scheduler;

  function realSpawn(cmd, args, opts) {
    return spawn(cmd, args, {
      ...opts,
      cwd: tmpDir,
    });
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat3-step5-real-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'),
      '# Arch Agent\n你是测试用 arch agent。收到消息后只回复 "确认收到"，不做任何其他操作。');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'),
      '# Dev Agent\n你是测试用 dev agent。收到消息后只回复 "确认收到"。');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'),
      '# UAT Agent\n你是测试用 uat agent。收到消息后只回复 "确认收到"。');

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: null } },
        dev_agent: { session: { runing: 'dddddddd-1111-4222-8333-444444444444', done: [] } },
        uat_agent: { session: { runing: null } },
      }
    }, null, 2));

    fs.writeFileSync(filePath, '');
  });

  after(async () => {
    if (watcher) await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect exit code 0 and emit completed event', async () => {
    scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: realSpawn,
    });

    watcher = new ActionWatcher(filePath);
    watcher.on('action', (action) => scheduler.dispatch(action));
    watcher.start();

    await sleep(300);

    const completions = [];
    scheduler.on('completed', (info) => completions.push(info));

    // Send a message to arch
    fs.appendFileSync(filePath, JSON.stringify({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: '只回复 ok',
    }) + '\n');

    // Wait for completion (real claude ~5-10s)
    await waitFor(() => completions.length >= 1, 90_000);

    // Verify completion event
    assert.strictEqual(completions[0].role, 'arch');
    assert.strictEqual(completions[0].exitCode, 0, 'real claude should exit 0');
    assert.ok(completions[0].stdout.includes('"type"'), 'should have stream-json stdout');

    // Verify agent is now idle
    assert.strictEqual(scheduler.isAgentBusy('arch'), false);
    assert.strictEqual(scheduler.getProcess('arch'), null);

    console.log('[PASS] Exit code 0 correctly detected, agent marked idle');
  });

  it('should handle non-zero exit code and still mark agent idle', async () => {
    // Strategy: force --resume with a non-existent session UUID
    // Real claude will fail with "No conversation found" and exit non-zero
    const FAKE_SESSION_ID = 'deadbeef-dead-4bad-beef-ffffffffffff';

    const failScheduler = new AgentScheduler({
      projectJsonPath: path.join(tmpDir, '.team3-fail.json'),
      specDir,
      spawnFn: realSpawn,
    });

    // Write project json that will cause --resume with non-existent session
    fs.writeFileSync(path.join(tmpDir, '.team3-fail.json'), JSON.stringify({
      partner: {
        arch_agent: {
          session: {
            runing: FAKE_SESSION_ID,
          }
        }
      }
    }, null, 2));

    const completions = [];
    failScheduler.on('completed', (info) => completions.push(info));

    // Dispatch directly (no watcher needed for this sub-test)
    failScheduler.dispatch({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 2, message: '只回复 ok',
    });

    await waitFor(() => completions.length >= 1, 90_000);

    // Claude should fail because the session doesn't exist
    assert.notStrictEqual(completions[0].exitCode, 0, 'should have non-zero exit code');
    assert.strictEqual(failScheduler.isAgentBusy('arch'), false, 'agent should still be idle after failure');

    console.log('[PASS] Non-zero exit code handled, agent still marked idle (exit code:', completions[0].exitCode + ')');
  });

  it('should allow parallel execution of different agents', async () => {
    // Create fresh scheduler for parallel test
    const parallelScheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: realSpawn,
      uuidFn: () => require('crypto').randomUUID(),
    });

    const parallelCompletions = [];
    parallelScheduler.on('completed', (info) => parallelCompletions.push(info));

    // Dispatch messages to different agents simultaneously
    parallelScheduler.dispatch({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 10, message: '只回复 "arch ok"',
    });
    parallelScheduler.dispatch({
      action: 'dev_do', from: 'arch', to: 'dev', ts: 11, message: '只回复 "dev ok"',
    });

    // Wait for both to complete
    await waitFor(() => parallelCompletions.length >= 2, 90_000);

    // Both should have completed
    const archCompletion = parallelCompletions.find(c => c.role === 'arch');
    const devCompletion = parallelCompletions.find(c => c.role === 'dev');
    assert.ok(archCompletion, 'arch should have completed');
    assert.ok(devCompletion, 'dev should have completed');
    assert.strictEqual(archCompletion.exitCode, 0);
    assert.strictEqual(devCompletion.exitCode, 0);

    // Both idle now
    assert.strictEqual(parallelScheduler.isAgentBusy('arch'), false);
    assert.strictEqual(parallelScheduler.isAgentBusy('dev'), false);

    console.log('[PASS] Different agents execute in parallel');
  });
});

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}
