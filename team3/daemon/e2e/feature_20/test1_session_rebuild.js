'use strict';

/**
 * E2E: Feature #20 — Session auto-rebuild
 *
 * When --resume fails with "No conversation found" in stderr,
 * auto-generate new session UUID and retry with --session-id.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const AgentScheduler = require('../../src/agent-scheduler');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Session auto-rebuild (Feature #20)', { timeout: 30_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat20-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');
    actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT');
    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should regenerate session UUID when stderr contains "No conversation found"', async () => {
    const originalSessionId = 'dead-session-0000-4000-8000-000000000001';

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: originalSessionId } },
        dev_agent: { session: { runing: 'd0000000-0000-4000-8000-000000000001', done: [] } },
        uat_agent: { session: { runing: 'u0000000-0000-4000-8000-000000000001' } },
      }
    }, null, 2));

    let spawnCount = 0;
    const sessionResetEvents = [];
    const spawnEvents = [];

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      actionsFilePath: actionsFile,
      workspaceDir: tmpDir,
      claudeTimeoutMs: 30000,
      claudeInactivityTimeoutMs: 0, // disable
      claudeKillGraceMs: 1000,
      claudeMaxRetries: 3,
      claudeRetryDelayMs: 500,
      spawnFn: (cmd, args, opts) => {
        spawnCount++;
        if (spawnCount === 1) {
          // First attempt: simulate "No conversation found" error
          const proc = spawn('node', ['-e', `
            process.stderr.write("Error: No conversation found for session dead-session-0000-4000-8000-000000000001\\n");
            process.exit(1);
          `], { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
          return proc;
        } else {
          // Second attempt (after session reset): succeed
          const proc = spawn('node', ['-e', `
            process.stdout.write("ok new session");
            process.exit(0);
          `], { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
          return proc;
        }
      },
    });

    scheduler.on('session-reset', (data) => sessionResetEvents.push(data));
    scheduler.on('spawn', (data) => spawnEvents.push(data));

    // Dispatch
    scheduler.dispatch({ action: 'to_arch', from: 'human', to: 'arch', ts: Date.now(), message: 'test session rebuild' });

    // Wait for first attempt fail + retry delay + second attempt
    await sleep(4000);

    // Should have emitted session-reset
    assert.ok(sessionResetEvents.length >= 1, 'should emit session-reset event');
    assert.equal(sessionResetEvents[0].role, 'arch');
    assert.ok(sessionResetEvents[0].reason.includes('No conversation found'));

    // project.json should have new session UUID
    const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
    const newSessionId = data.partner.arch_agent.session.runing;
    assert.notEqual(newSessionId, originalSessionId, 'session UUID should be regenerated');
    assert.equal(data.partner.arch_agent.session.initialized, undefined, 'legacy initialized flag should not be written');

    // Second spawn should have used new session (isNew=true → --session-id)
    assert.ok(spawnCount >= 2, 'should have spawned at least twice');
    assert.equal(spawnEvents[1].isNew, true, 'second spawn should use isNew=true (--session-id)');

    scheduler.clearAllTimers();
  });
});
