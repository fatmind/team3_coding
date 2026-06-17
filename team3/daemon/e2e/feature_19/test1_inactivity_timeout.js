'use strict';

/**
 * E2E: Feature #19 — Activity-based heartbeat timeout
 *
 * Spawn a process that outputs nothing after initial data.
 * With short inactivity timeout (2s), verify it gets killed.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const EventEmitter = require('events');

const AgentScheduler = require('../../src/agent-scheduler');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Inactivity heartbeat timeout (Feature #19)', { timeout: 30_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat19-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');
    actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT');
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'a3333333-0000-4000-8000-000000000001' } },
        dev_agent: { session: { runing: 'd3333333-0000-4000-8000-000000000001', done: [] } },
        uat_agent: { session: { runing: 'u3333333-0000-4000-8000-000000000001' } },
      }
    }, null, 2));
    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should kill process after inactivity timeout (no stdout for 2s)', async () => {
    const inactivityEvents = [];
    const completedEvents = [];

    // Spawn a process that writes initial output then goes silent
    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      actionsFilePath: actionsFile,
      workspaceDir: tmpDir,
      claudeTimeoutMs: 60000,  // wall-clock timeout: 60s (won't trigger)
      claudeInactivityTimeoutMs: 2000,  // inactivity timeout: 2s
      claudeKillGraceMs: 1000,
      claudeMaxRetries: 1,
      claudeRetryDelayMs: 100,
      spawnFn: (cmd, args, opts) => {
        // Write one line immediately, then hang forever
        const proc = spawn('node', ['-e', `
          process.stdout.write("initial output\\n");
          setTimeout(() => {}, 999000);
        `], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return proc;
      },
    });

    scheduler.on('inactivity-timeout', (data) => inactivityEvents.push(data));
    scheduler.on('completed', (data) => completedEvents.push(data));

    // Dispatch
    scheduler.dispatch({ action: 'to_arch', from: 'human', to: 'arch', ts: Date.now(), message: 'test inactivity' });

    // Wait for inactivity timeout (2s) + kill grace (1s) + buffer
    await sleep(5000);

    assert.ok(inactivityEvents.length >= 1, 'should emit inactivity-timeout event');
    assert.equal(inactivityEvents[0].role, 'arch');
    assert.equal(inactivityEvents[0].inactivityMs, 2000);

    // Process should have been killed (completed with non-zero)
    assert.ok(completedEvents.length >= 1, 'should emit completed event');
    assert.notEqual(completedEvents[0].exitCode, 0, 'exit code should be non-zero (killed)');

    scheduler.clearAllTimers();
  });

  it('should NOT trigger inactivity timeout if stdout is active', async () => {
    const inactivityEvents = [];

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      actionsFilePath: actionsFile,
      workspaceDir: tmpDir,
      claudeTimeoutMs: 60000,
      claudeInactivityTimeoutMs: 2000,
      claudeKillGraceMs: 1000,
      claudeMaxRetries: 1,
      claudeRetryDelayMs: 100,
      spawnFn: (cmd, args, opts) => {
        // Write output every second — always active
        const proc = spawn('node', ['-e', `
          let i = 0;
          const iv = setInterval(() => {
            process.stdout.write("tick " + i++ + "\\n");
            if (i >= 4) { clearInterval(iv); process.exit(0); }
          }, 800);
        `], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return proc;
      },
    });

    scheduler.on('inactivity-timeout', (data) => inactivityEvents.push(data));

    scheduler.dispatch({ action: 'to_arch', from: 'human', to: 'arch', ts: Date.now(), message: 'test active' });

    // Wait for process to naturally complete (~3.2s)
    await sleep(5000);

    assert.equal(inactivityEvents.length, 0, 'should NOT emit inactivity-timeout when stdout is active');

    scheduler.clearAllTimers();
  });
});
