'use strict';

/**
 * Feature #10 e2e: AgentScheduler session resolve follows action semantics.
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Checkpoint Steps covered:
 *   Step 2: no current session uses --session-id
 *   Step 3: existing real session uses --resume
 *   Step 4: UAT new-task actions create a fresh session
 *
 * Strategy:
 *   - Test 1: missing runing → scheduler uses --session-id → real claude succeeds
 *   - Test 2: real existing session → scheduler uses --resume
 *   - Test 3: uat_design creates a new UAT session and archives the old one
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const AgentScheduler = require('../../src/agent-scheduler');

describe('Feature #10 - Scheduler session resolve with REAL claude', { timeout: 300_000 }, () => {
  let tmpDir;
  let specDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-real-sched-'));
    specDir = path.join(tmpDir, 'spec');

    fs.mkdirSync(specDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('first dispatch to arch without a current session should use --session-id', async () => {
    const projectJsonPath = path.join(tmpDir, '.team3-step23.json');

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: {
          session: {
            runing: null,
          }
        }
      }
    }, null, 2));

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: (cmd, args, opts) => {
        return spawn(cmd, args, { ...opts, cwd: tmpDir });
      },
    });

    const spawnInfo = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), 90_000);

      scheduler.on('spawn', (info) => {
        assert.strictEqual(info.isNew, true, 'should use --session-id (isNew=true)');

        // Verify args contain --session-id
        assert.ok(info.args.includes('--session-id'), 'args should include --session-id');
        assert.ok(!info.args.includes('--resume'), 'args should NOT include --resume');
      });

      scheduler.on('completed', (info) => {
        clearTimeout(timer);
        resolve(info);
      });

      scheduler.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Scheduler error: ${err.error}`));
      });

      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: '只回复确认',
      });
    });

    assert.strictEqual(spawnInfo.exitCode, 0, 'real claude should exit 0');

    await new Promise(r => setTimeout(r, 200));
    const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.ok(data.partner.arch_agent.session.runing, 'scheduler should persist generated session id');
    assert.strictEqual(data.partner.arch_agent.session.initialized, undefined,
      'scheduler should not write legacy initialized flag');

    console.log('[PASS] missing runing → --session-id → exit 0');
  });

  it('subsequent dispatch to arch with an existing real session should use --resume', async () => {
    const projectJsonPath = path.join(tmpDir, '.team3-step4.json');

    // Step 1: First create a REAL session
    const sessionId = randomUUID();
    console.log(`[SETUP] Creating real session ${sessionId}...`);

    await new Promise((resolve, reject) => {
      const proc = spawn('claude', [
        '-p', '只回复 "session 已创建"',
        '--session-id', sessionId,
        '--system-prompt', '你是测试用 arch agent。收到消息后只回复 "确认收到"。',
        '--output-format', 'stream-json',
        '--verbose',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: tmpDir,
      });

      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      const timer = setTimeout(() => { proc.kill(); reject(new Error('setup timed out')); }, 60_000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Session creation failed (exit ${code}): ${stderr}`));
      });
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    console.log('[SETUP] Session created successfully');

    // Step 2: Set up project json with the real session id
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: {
          session: {
            runing: sessionId,
          }
        }
      }
    }, null, 2));

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: (cmd, args, opts) => {
        return spawn(cmd, args, { ...opts, cwd: tmpDir });
      },
    });

    const spawnInfo = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), 90_000);

      scheduler.on('spawn', (info) => {
        assert.strictEqual(info.isNew, false, 'should use --resume (isNew=false)');
        assert.strictEqual(info.sessionId, sessionId);

        // Verify args contain --resume
        assert.ok(info.args.includes('--resume'), 'args should include --resume');
        assert.ok(!info.args.includes('--session-id'), 'args should NOT include --session-id');
      });

      scheduler.on('completed', (info) => {
        clearTimeout(timer);
        resolve(info);
      });

      scheduler.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Scheduler error: ${err.error}`));
      });

      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: '只回复确认',
      });
    });

    assert.strictEqual(spawnInfo.exitCode, 0, 'real claude should successfully resume session');

    console.log('[PASS] existing real session → --resume → exit 0');
  });

  it('uat_design should create a new UAT session and archive the old one', async () => {
    const projectJsonPath = path.join(tmpDir, '.team3-noinit.json');
    const oldSessionId = randomUUID();

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        uat_agent: {
          session: {
            runing: oldSessionId,
            done: [],
          }
        }
      }
    }, null, 2));

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: (cmd, args, opts) => {
        return spawn(cmd, args, { ...opts, cwd: tmpDir });
      },
    });

    const spawnInfo = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), 90_000);

      scheduler.on('spawn', (info) => {
        assert.strictEqual(info.isNew, true, 'should use --session-id');
        assert.notStrictEqual(info.sessionId, oldSessionId);
        assert.ok(info.args.includes('--session-id'));
        assert.ok(!info.args.includes('--resume'));
      });

      scheduler.on('completed', (info) => {
        clearTimeout(timer);
        resolve(info);
      });

      scheduler.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Scheduler error: ${err.error}`));
      });

      scheduler.dispatch({
        action: 'uat_design', from: 'human', to: 'uat', ts: 1, message: '只回复确认',
      });
    });

    assert.strictEqual(spawnInfo.exitCode, 0, 'real claude should exit 0');
    const updated = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.ok(updated.partner.uat_agent.session.done.includes(oldSessionId));
    assert.notStrictEqual(updated.partner.uat_agent.session.runing, oldSessionId);

    console.log('[PASS] uat_design → new UAT session and archived old session');
  });
});
