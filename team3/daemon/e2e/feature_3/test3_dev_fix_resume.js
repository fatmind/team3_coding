'use strict';

/**
 * Integration Test: Step 3 (Feature #3)
 * "dev_fix → reuse session, spawn with --resume"
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Strategy:
 * 1. In before(), create a real claude session by running claude with --session-id
 * 2. Then send dev_fix → scheduler should use --resume with that session
 * 3. Verify the session is reused and claude resumes successfully
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const ActionWatcher = require('../../src/action-watcher');
const AgentScheduler = require('../../src/agent-scheduler');

describe('E2E: dev_fix → reuse session, --resume via REAL claude (Step 3)', { timeout: 180_000 }, () => {
  let tmpDir;
  let filePath;
  let projectJsonPath;
  let specDir;
  let watcher;
  let scheduler;

  // Will be created as a REAL session in before()
  let REAL_SESSION_ID;

  function realSpawn(cmd, args, opts) {
    return spawn(cmd, args, {
      ...opts,
      cwd: tmpDir,
    });
  }

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat3-step3-real-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'),
      '# Dev Agent\n你是测试用 dev agent。收到消息后只回复 "确认收到"，不做任何其他操作。');
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'),
      '# Arch Agent\n你是测试用 arch agent。');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'),
      '# UAT Agent\n你是测试用 uat agent。');

    // Step 0: Create a REAL session by spawning claude with --session-id
    // This ensures --resume will find an existing session later
    REAL_SESSION_ID = randomUUID();

    console.log(`[SETUP] Creating real session ${REAL_SESSION_ID}...`);
    await new Promise((resolve, reject) => {
      const proc = spawn('claude', [
        '-p', '只回复 "session 已创建"',
        '--session-id', REAL_SESSION_ID,
        '--system-prompt', '你是测试用 dev agent。收到消息后只回复 "确认收到"。',
        '--output-format', 'stream-json',
        '--verbose',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: tmpDir,
      });

      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`[SETUP] Session created successfully`);
          resolve();
        } else {
          reject(new Error(`Session creation failed (exit ${code}): ${stderr}`));
        }
      });
      proc.on('error', reject);
      setTimeout(() => reject(new Error('Session creation timed out')), 60_000);
    });

    // Set up project json with the real session
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'aaaaaaaa-1111-4222-8333-444444444444' } },
        dev_agent: { session: { runing: REAL_SESSION_ID, done: ['old-session-1'] } },
        uat_agent: { session: { runing: 'bbbbbbbb-5555-4666-8777-888888888888' } },
      }
    }, null, 2));

    fs.writeFileSync(filePath, '');
  });

  after(async () => {
    if (watcher) await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect dev_fix, reuse current sessionId, spawn real claude with --resume', async () => {
    scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: realSpawn,
      // Don't override uuidFn — it shouldn't be called for dev_fix
    });

    watcher = new ActionWatcher(filePath);
    watcher.on('action', (action) => scheduler.dispatch(action));
    watcher.start();

    await sleep(300);

    const spawns = [];
    scheduler.on('spawn', (info) => spawns.push(info));
    const completions = [];
    scheduler.on('completed', (info) => completions.push(info));

    // Append dev_fix action
    const devFixAction = {
      action: 'dev_fix',
      from: 'arch',
      to: 'dev',
      ts: Math.floor(Date.now() / 1000),
      message: '请确认收到修复消息。只回复 "已收到修复指令"。',
    };
    fs.appendFileSync(filePath, JSON.stringify(devFixAction) + '\n');

    await waitFor(() => completions.length >= 1, 90_000);

    // Verify spawn event
    assert.strictEqual(spawns[0].role, 'dev');
    assert.strictEqual(spawns[0].isNew, false, 'should NOT be new (should use --resume)');
    assert.strictEqual(spawns[0].sessionId, REAL_SESSION_ID, 'should reuse existing session');

    // Verify: --resume was in args (not --session-id)
    assert.ok(spawns[0].args.includes('--resume'), 'args should contain --resume');
    assert.ok(!spawns[0].args.includes('--session-id'), 'args should NOT contain --session-id');

    // Verify exit code 0 (real claude resumes the session successfully)
    assert.strictEqual(completions[0].exitCode, 0, 'real claude should exit 0 on resume');

    // Verify: project json NOT changed (session still the same)
    const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.strictEqual(data.partner.dev_agent.session.runing, REAL_SESSION_ID);
    assert.strictEqual(data.partner.dev_agent.session.done.length, 1);

    console.log('[PASS] dev_fix → current session reused, REAL claude spawned with --resume');
    console.log('  Resumed session:', REAL_SESSION_ID);
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
