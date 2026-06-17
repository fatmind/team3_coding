'use strict';

/**
 * E2E: Feature #21 — Daemon internal health check
 *
 * Verify that consecutive health check failures lead to process exit.
 * Uses a mock orchestrator with broken actionWatcher to trigger failures.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const EventEmitter = require('events');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Daemon internal health check (Feature #21)', { timeout: 30_000 }, () => {
  let workspaceDir;
  let projectJsonPath;
  let actionsFile;
  let specDir;

  before(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat21-'));
    projectJsonPath = path.join(workspaceDir, '.team3-project.json');
    specDir = path.join(workspaceDir, 'spec');
    actionsFile = path.join(specDir, 'actions.jsonl');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT');
    fs.writeFileSync(path.join(specDir, 'modules_progress.json'), '{}');
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'a5555555-0000-4000-8000-000000000001' } },
        dev_agent: { session: { runing: 'd5555555-0000-4000-8000-000000000001', done: [] } },
        uat_agent: { session: { runing: 'u5555555-0000-4000-8000-000000000001' } },
      }
    }, null, 2));
    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('should emit health-fail events when actions.jsonl is unreadable', async () => {
    const healthFailEvents = [];

    const mockWatcher = new EventEmitter();
    mockWatcher.close = async () => {};
    // Point filePath to a non-existent file to trigger health check failure
    mockWatcher.filePath = path.join(workspaceDir, 'nonexistent', 'actions.jsonl');

    const orchestrator = new DaemonOrchestrator({
      port: 13310,
      projectJsonPath,
      workspaceDir,
      actionsFilePath: actionsFile,
      specDir,
      modulesProgressPath: path.join(specDir, 'modules_progress.json'),
      watcherFactory: () => mockWatcher,
      healthCheckInterval: 500, // check every 500ms for faster test
      healthCheckMaxFailures: 3,
      spawnFn: (cmd, args, opts) => {
        return spawn('node', ['-e', 'process.exit(0)'], { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
      },
    });

    // Override actionWatcher.filePath to broken path AFTER start
    orchestrator.on('health-fail', (data) => healthFailEvents.push(data));

    // Mock process.exit to prevent actual exit
    const originalExit = process.exit;
    let exitCalled = false;
    let exitCode = null;
    process.exit = (code) => { exitCalled = true; exitCode = code; };

    await orchestrator.start();

    // Override the actionWatcher filePath to non-existent
    orchestrator.actionWatcher.filePath = path.join(workspaceDir, 'nonexistent', 'actions.jsonl');

    // Wait for 3 health check intervals (500ms * 3 + buffer)
    await sleep(2500);

    process.exit = originalExit;

    // Stop the orchestrator (cleanup timer)
    await orchestrator.stop();

    assert.ok(healthFailEvents.length >= 3, `should have at least 3 health-fail events, got ${healthFailEvents.length}`);
    assert.ok(exitCalled, 'process.exit should have been called');
    assert.equal(exitCode, 1, 'exit code should be 1');
  });

  it('should reset fail count when health check passes', async () => {
    const mockWatcher = new EventEmitter();
    mockWatcher.close = async () => {};
    mockWatcher.filePath = actionsFile; // valid path

    const orchestrator = new DaemonOrchestrator({
      port: 13311,
      projectJsonPath,
      workspaceDir,
      actionsFilePath: actionsFile,
      specDir,
      modulesProgressPath: path.join(specDir, 'modules_progress.json'),
      watcherFactory: () => mockWatcher,
      healthCheckInterval: 300,
      healthCheckMaxFailures: 3,
      spawnFn: (cmd, args, opts) => {
        return spawn('node', ['-e', 'process.exit(0)'], { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
      },
    });

    await orchestrator.start();

    // Wait for 2 successful health checks
    await sleep(800);

    // Health fail count should be 0
    assert.equal(orchestrator._healthFailCount, 0, 'fail count should be 0 when healthy');

    await orchestrator.stop();
  });
});
