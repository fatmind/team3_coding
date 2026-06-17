'use strict';

/**
 * E2E: Feature #18 — Daemon structured logging (daemon.log)
 *
 * Step 1: daemon.log created on start with [START] line
 * Step 2: dispatching a message produces [WATCH] [DISPATCH] [DONE] lines
 * Step 3: stop produces [STOP] line
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

describe('E2E: Daemon structured logging (Feature #18)', { timeout: 30_000 }, () => {
  let workspaceDir;
  let projectJsonPath;
  let actionsFile;
  let specDir;
  let daemonLogPath;

  before(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat18-'));
    projectJsonPath = path.join(workspaceDir, '.team3-project.json');
    specDir = path.join(workspaceDir, 'spec');
    actionsFile = path.join(specDir, 'actions.jsonl');
    daemonLogPath = path.join(workspaceDir, 'logs', 'daemon.log');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT');
    fs.writeFileSync(path.join(specDir, 'modules_progress.json'), '{}');
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'a2222222-0000-4000-8000-000000000001' } },
        dev_agent: { session: { runing: 'd2222222-0000-4000-8000-000000000001', done: [] } },
        uat_agent: { session: { runing: 'u2222222-0000-4000-8000-000000000001' } },
      }
    }, null, 2));
    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('should write [START], [WATCH], [DISPATCH], [DONE], [STOP] to daemon.log', async () => {
    const mockWatcher = new EventEmitter();
    mockWatcher.close = async () => {};

    const orchestrator = new DaemonOrchestrator({
      port: 13300,
      projectJsonPath,
      workspaceDir,
      actionsFilePath: actionsFile,
      specDir,
      modulesProgressPath: path.join(specDir, 'modules_progress.json'),
      watcherFactory: () => mockWatcher,
      healthCheckInterval: 0,
      spawnFn: (cmd, args, opts) => {
        const proc = spawn('node', ['-e', 'process.stdout.write("result"); process.exit(0)'], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return proc;
      },
    });

    await orchestrator.start();

    // Verify [START] was logged
    await sleep(200);
    let log = fs.readFileSync(daemonLogPath, 'utf8');
    assert.ok(log.includes('[START]'), 'daemon.log should have [START] line');
    assert.ok(log.includes(`workspace=${workspaceDir}`), '[START] should include workspace path');

    // Dispatch a message
    const action = { action: 'to_arch', from: 'human', to: 'arch', ts: Date.now(), message: 'hello arch' };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');
    mockWatcher.emit('change');

    await sleep(2000);

    log = fs.readFileSync(daemonLogPath, 'utf8');
    assert.ok(log.includes('[WATCH]'), 'daemon.log should have [WATCH] line');
    assert.ok(log.includes('[DISPATCH]'), 'daemon.log should have [DISPATCH] line');
    assert.ok(log.includes('[DONE]'), 'daemon.log should have [DONE] line');
    assert.ok(log.includes('role=arch'), 'log should reference arch role');

    // Stop
    await orchestrator.stop();

    log = fs.readFileSync(daemonLogPath, 'utf8');
    assert.ok(log.includes('[STOP]'), 'daemon.log should have [STOP] line');
  });
});
