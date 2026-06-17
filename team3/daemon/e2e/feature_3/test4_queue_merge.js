'use strict';

/**
 * Integration Test: Step 4 (Feature #3)
 * "Queue + merge messages: agent busy → messages queued → merged on completion"
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Strategy: Real claude naturally takes 3-10s per invocation, providing a natural
 * "busy" window for queueing messages. No need for artificial delays.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ActionWatcher = require('../../src/action-watcher');
const AgentScheduler = require('../../src/agent-scheduler');

describe('E2E: Queue + merge messages via REAL claude (Step 4)', { timeout: 180_000 }, () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat3-step4-real-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'),
      '# Arch Agent\n你是测试用 arch agent。收到消息后只回复 "确认收到"，不做任何其他操作。');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'),
      '# Dev Agent\n你是测试用 dev agent。');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'),
      '# UAT Agent\n你是测试用 uat agent。');

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

  it('should queue messages while agent busy, then merge and send on completion', async () => {
    scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: realSpawn,
    });

    watcher = new ActionWatcher(filePath);
    watcher.on('action', (action) => scheduler.dispatch(action));
    watcher.start();

    await sleep(300);

    const spawns = [];
    scheduler.on('spawn', (info) => spawns.push(info));
    const completions = [];
    scheduler.on('completed', (info) => completions.push(info));

    // 1. First message: starts execution (agent becomes busy with real claude ~5-10s)
    fs.appendFileSync(filePath, JSON.stringify({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 1000, message: 'Feature #1 delivered',
    }) + '\n');

    // Wait for first spawn to start
    await waitFor(() => spawns.length >= 1, 10_000);
    assert.strictEqual(scheduler.isAgentBusy('arch'), true);
    console.log('[INFO] First message triggered spawn, arch is busy (real claude running)');

    // 2. While busy (real claude takes 3-10s), append more messages
    await sleep(500);
    fs.appendFileSync(filePath, JSON.stringify({
      action: 'to_arch', from: 'human', to: 'arch', ts: 2000, message: 'Please also check tests',
    }) + '\n');

    await sleep(500);
    fs.appendFileSync(filePath, JSON.stringify({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 3000, message: 'Unit tests all pass',
    }) + '\n');

    // Wait for watcher to detect them
    await sleep(500);

    // Verify: still only 1 spawn (messages queued while real claude runs)
    assert.strictEqual(spawns.length, 1, 'should still be 1 spawn (others queued)');
    assert.strictEqual(scheduler.getPendingCount('arch'), 2, 'should have 2 pending messages');
    console.log('[INFO] 2 messages queued while arch is busy');

    // 3. Wait for first process to complete + second batch to fire + complete
    await waitFor(() => completions.length >= 2, 120_000);

    // 4. Verify second spawn had merged prompt
    assert.strictEqual(spawns.length, 2, 'should have 2 total spawns');
    assert.strictEqual(spawns[1].messageCount, 2, 'second spawn should merge 2 messages');

    // Verify merged prompt contains both queued messages
    assert.ok(spawns[1].prompt.includes('Please also check tests'),
      'Merged prompt should contain second message');
    assert.ok(spawns[1].prompt.includes('Unit tests all pass'),
      'Merged prompt should contain third message');

    // Both spawns should exit 0
    assert.strictEqual(completions[0].exitCode, 0, 'first spawn exit 0');
    assert.strictEqual(completions[1].exitCode, 0, 'second spawn exit 0');

    console.log('[PASS] Messages queued during busy, merged into single prompt on completion');
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
