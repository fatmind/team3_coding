'use strict';

/**
 * Integration Test: Step 3 & 4 (Feature #13)
 * "Simulate 3 consecutive non-zero exits → dead letter notification to actions.jsonl
 *  + verify queue recovers idle and processes new messages normally"
 *
 * Uses real spawned processes that exit with code 1 (node -e "process.exit(1)")
 * to test the full retry→dead-letter→recovery flow.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const AgentScheduler = require('../../src/agent-scheduler');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Dead letter + queue recovery (Feature #13, Step 3 & 4)', { timeout: 60_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat13-deadletter-'));
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

  it('should write dead letter after 3 consecutive failures (Step 3)', async () => {
    let spawnCount = 0;
    const deadLetterEvents = [];
    const spawnEvents = [];

    function failSpawn(cmd, args, opts) {
      spawnCount++;
      // All attempts exit with code 1
      const proc = spawn('node', ['-e', 'process.stderr.write("error"); process.exit(1)'], {
        ...opts,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return proc;
    }

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: failSpawn,
      claudeTimeoutMs: 60000,
      claudeRetryDelayMs: 200,   // Short delay for testing
      claudeMaxRetries: 3,
      actionsFilePath: actionsFile,
    });

    scheduler.on('spawn', (info) => spawnEvents.push(info));
    scheduler.on('dead-letter', (info) => deadLetterEvents.push(info));

    // Dispatch a message with known content
    const testMessage = 'Feature #13 验证：这条消息将触发连续失败并最终进入 dead letter 通知人类。这是一条较长的消息用于测试截断行为。';
    scheduler.dispatch({
      action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: testMessage,
    });

    // Wait for 3 retries: each ~200ms delay + process exit time
    // Total: 3 * (200ms + ~50ms) ≈ 750ms, use 3s to be safe
    await sleep(3000);

    // Verify: 3 spawn attempts
    assert.strictEqual(spawnCount, 3, `Expected 3 spawns, got ${spawnCount}`);

    // Verify: retryCount increments across spawns
    assert.strictEqual(spawnEvents[0].retryCount, 0);
    assert.strictEqual(spawnEvents[1].retryCount, 1);
    assert.strictEqual(spawnEvents[2].retryCount, 2);

    // Verify: dead letter emitted
    assert.strictEqual(deadLetterEvents.length, 1);
    assert.strictEqual(deadLetterEvents[0].role, 'dev');
    assert.ok(deadLetterEvents[0].reason.includes('exit code 1'));

    // Verify: dead letter written to actions.jsonl
    const content = fs.readFileSync(actionsFile, 'utf-8').trim();
    assert.ok(content.length > 0, 'actions.jsonl should have dead letter entry');
    const action = JSON.parse(content);
    assert.strictEqual(action.action, 'to_human');
    assert.strictEqual(action.from, 'dev');
    assert.strictEqual(action.to, 'human');
    assert.ok(action.message.includes('Agent dev'));
    assert.ok(action.message.includes('已重试 3 次'));
    assert.ok(action.message.includes('exit code 1'));
    // Message summary should contain first 200 chars of prompt
    assert.ok(action.message.includes(testMessage.substring(0, 50)));

    scheduler.clearAllTimers();
  });

  it('should recover idle after dead letter and process new messages (Step 4)', async () => {
    // Clear actions file from previous test
    fs.writeFileSync(actionsFile, '');

    let spawnCount = 0;
    const completedEvents = [];
    const deadLetterEvents = [];

    function mixedSpawn(cmd, args, opts) {
      spawnCount++;
      const current = spawnCount;
      if (current <= 3) {
        // First 3 attempts fail (for dead letter of first message)
        return spawn('node', ['-e', 'process.exit(1)'], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        // 4th attempt succeeds (new message after recovery)
        return spawn('node', ['-e', 'process.stdout.write("success"); process.exit(0)'], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    }

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: mixedSpawn,
      claudeTimeoutMs: 60000,
      claudeRetryDelayMs: 100,
      claudeMaxRetries: 3,
      actionsFilePath: actionsFile,
    });

    scheduler.on('completed', (info) => completedEvents.push(info));
    scheduler.on('dead-letter', (info) => deadLetterEvents.push(info));

    // First message: will fail 3 times → dead letter
    scheduler.dispatch({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'will fail',
    });

    // Wait for dead letter
    await sleep(2000);

    assert.strictEqual(deadLetterEvents.length, 1, 'Should have dead letter');
    assert.strictEqual(scheduler.isAgentBusy('arch'), false, 'Queue should be idle after dead letter');

    // Second message: should process normally (4th spawn succeeds)
    scheduler.dispatch({
      action: 'to_arch', from: 'human', to: 'arch', ts: 2, message: 'after recovery',
    });

    await sleep(1000);

    // Verify the new message was processed successfully
    const successEvent = completedEvents.find(e => e.exitCode === 0);
    assert.ok(successEvent, 'New message after dead letter should succeed');
    assert.strictEqual(successEvent.role, 'arch');
    assert.strictEqual(scheduler.isAgentBusy('arch'), false);

    scheduler.clearAllTimers();
  });
});
