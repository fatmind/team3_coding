'use strict';

/**
 * Integration Test: Step 2 (Feature #3)
 * "dev_do → new session, archive old, spawn with --session-id"
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Verifies:
 * - Scheduler detects dev_do and creates new session UUID
 * - Old session archived to done[]
 * - Real claude spawned with --session-id (verified via spawn event)
 * - Process exits successfully (exit code 0)
 * - Project json updated with new session
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ActionWatcher = require('../../src/action-watcher');
const AgentScheduler = require('../../src/agent-scheduler');

describe('E2E: dev_do → new session via REAL claude (Step 2)', { timeout: 120_000 }, () => {
  let tmpDir;
  let filePath;
  let projectJsonPath;
  let specDir;
  let watcher;
  let scheduler;

  const OLD_SESSION_ID = '11111111-2222-4333-a444-555555555555';

  function realSpawn(cmd, args, opts) {
    return spawn(cmd, args, {
      ...opts,
      cwd: tmpDir,
    });
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat3-step2-real-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'),
      '# Dev Agent\n你是测试用 dev agent。收到消息后只回复 "确认收到"，不执行任何文件或代码操作。');
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'),
      '# Arch Agent\n你是测试用 arch agent。收到消息后只回复 "确认收到"，不执行任何操作。');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'),
      '# UAT Agent\n你是测试用 uat agent。');

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } },
        dev_agent: { session: { runing: OLD_SESSION_ID, done: [] } },
        uat_agent: { session: { runing: 'ffffffff-0000-4111-9222-333333333333' } },
      }
    }, null, 2));

    fs.writeFileSync(filePath, '');
  });

  after(async () => {
    if (watcher) await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect dev_do, generate new UUID, archive old, spawn real claude with --session-id', async () => {
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

    // Append dev_do action to actions.jsonl
    const devDoAction = {
      action: 'dev_do',
      from: 'arch',
      to: 'dev',
      ts: Math.floor(Date.now() / 1000),
      message: '请确认收到此任务消息。只回复 ok。',
    };
    fs.appendFileSync(filePath, JSON.stringify(devDoAction) + '\n');

    // Wait for real claude to complete (longer timeout for real CLI)
    await waitFor(() => completions.length >= 1, 90_000);

    // Verify spawn event
    assert.strictEqual(spawns.length, 1, 'should have 1 spawn');
    assert.strictEqual(spawns[0].role, 'dev', 'should be dev role');
    assert.strictEqual(spawns[0].isNew, true, 'should be new session (--session-id)');

    const newSessionId = spawns[0].sessionId;
    assert.ok(newSessionId, 'should have a session ID');
    assert.notStrictEqual(newSessionId, OLD_SESSION_ID, 'should be a NEW session ID');

    // Verify: exit code 0
    assert.strictEqual(completions[0].exitCode, 0, 'real claude should exit 0');

    // Verify: --session-id was in the args (not --resume)
    assert.ok(spawns[0].args.includes('--session-id'), 'args should contain --session-id');
    assert.ok(!spawns[0].args.includes('--resume'), 'args should NOT contain --resume');
    assert.ok(spawns[0].args.includes(newSessionId), 'args should contain the session UUID');

    // Verify: project json updated
    const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.strictEqual(data.partner.dev_agent.session.runing, newSessionId);
    assert.ok(data.partner.dev_agent.session.done.includes(OLD_SESSION_ID),
      'old session should be archived');

    // Verify: stdout was captured (stream-json from real claude)
    assert.ok(completions[0].stdout.length > 0, 'should have stdout output');
    assert.ok(completions[0].stdout.includes('"type"'), 'stdout should contain stream-json');

    console.log('[PASS] dev_do → new session, old archived, REAL claude spawned with --session-id');
    console.log('  New session:', newSessionId);
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
