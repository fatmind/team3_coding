'use strict';

/**
 * E2E: Feature #16 — Orphan process cleanup + PID tracking
 *
 * Step 3: Daemon startup reads spawnedPids, kills alive orphans
 * Step 4: dev_agent.session.done[] with alive process → SIGTERM
 * Step 5: Runtime PID tracking: spawn → PID recorded, exit → PID cleared;
 *         graceful shutdown → SIGTERM all children
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const EventEmitter = require('events');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');
const StatePersistence = require('../../src/state-persistence');
const AgentScheduler = require('../../src/agent-scheduler');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe('E2E: Orphan cleanup + PID tracking (Feature #16, Step 3-5)', { timeout: 30_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsFile;
  let stateFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat16-orphan-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');
    actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');
    stateFile = path.join(tmpDir, '.daemon-state.json');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT');

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'aaaa-1111-4222-8333-444444444444' } },
        dev_agent: { session: { runing: 'dddd-1111-4222-8333-444444444444', done: [] } },
        uat_agent: { session: { runing: 'uuuu-1111-4222-8333-444444444444' } },
      }
    }, null, 2));

    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 3: should SIGTERM orphan process found in spawnedPids at startup', async () => {
    // Spawn a real orphan process
    const orphan = spawn('node', ['-e', 'setTimeout(()=>{},60000)'], {
      stdio: 'ignore', detached: true,
    });
    orphan.unref();
    const orphanPid = orphan.pid;

    assert.ok(isAlive(orphanPid), 'orphan should be alive before cleanup');

    // Write state file with orphan PID
    fs.writeFileSync(stateFile, JSON.stringify({
      lastProcessingOffset: 0,
      spawnedPids: { arch: orphanPid, dev: null, uat: null },
      lastUpdated: new Date().toISOString(),
    }));

    function noopSpawn(cmd, args, opts) {
      const proc = spawn('node', ['-e', 'process.exit(0)'], { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
      return proc;
    }

    const port = 13180;
    const orch = new DaemonOrchestrator({
      port,
      projectJsonPath,
      actionsFilePath: actionsFile,
      specDir,
      spawnFn: noopSpawn,
      stateFilePath: stateFile,
      heartbeatInterval: 999999,
      wsPingInterval: 999999,
      modulesProgressPath: '/tmp/nonexistent.json',
    });

    const orphanEvents = [];
    orch.on('orphans-cleaned', (d) => orphanEvents.push(d));

    await orch.start();

    // Orphan should have been killed
    await sleep(200);
    assert.strictEqual(isAlive(orphanPid), false, 'orphan should be dead after cleanup');
    assert.strictEqual(orphanEvents.length, 1);
    assert.strictEqual(orphanEvents[0].cleaned[0].pid, orphanPid);

    // spawnedPids should be cleared
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    // After debounce, arch should be null
    await sleep(300);
    const state2 = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.strictEqual(state2.spawnedPids.arch, null);

    await orch.stop();
  });

  it('Step 5: should track PID in .daemon-state.json during spawn and clear on exit', async () => {
    // Clear state file
    fs.writeFileSync(stateFile, JSON.stringify({
      lastProcessingOffset: 0,
      spawnedPids: { arch: null, dev: null, uat: null },
      lastUpdated: null,
    }));

    let spawnedPid = null;

    function trackingSpawn(cmd, args, opts) {
      const proc = spawn('node', ['-e', 'setTimeout(()=>{process.exit(0)},500)'], {
        ...opts, stdio: ['pipe', 'pipe', 'pipe'],
      });
      spawnedPid = proc.pid;
      return proc;
    }

    const port = 13181;
    const orch = new DaemonOrchestrator({
      port,
      projectJsonPath,
      actionsFilePath: actionsFile,
      specDir,
      spawnFn: trackingSpawn,
      stateFilePath: stateFile,
      heartbeatInterval: 999999,
      wsPingInterval: 999999,
      modulesProgressPath: '/tmp/nonexistent.json',
    });

    await orch.start();

    // Dispatch an action to trigger spawn
    orch.agentScheduler.dispatch({
      action: 'to_arch', from: 'human', to: 'arch', ts: 1, message: 'test pid tracking',
    });

    // Wait for spawn + debounce
    await sleep(300);

    // PID should be recorded
    let state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.strictEqual(state.spawnedPids.arch, spawnedPid);

    // Wait for process to exit + debounce
    await sleep(800);

    // PID should be cleared
    state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.strictEqual(state.spawnedPids.arch, null);

    await orch.stop();
  });

  it('Step 5: graceful shutdown should SIGTERM running child processes', async () => {
    fs.writeFileSync(stateFile, JSON.stringify({
      lastProcessingOffset: 0,
      spawnedPids: { arch: null, dev: null, uat: null },
      lastUpdated: null,
    }));

    let spawnedProc = null;

    function longSpawn(cmd, args, opts) {
      const proc = spawn('node', ['-e', 'setTimeout(()=>{},60000)'], {
        ...opts, stdio: ['pipe', 'pipe', 'pipe'],
      });
      spawnedProc = proc;
      return proc;
    }

    const port = 13182;
    const orch = new DaemonOrchestrator({
      port,
      projectJsonPath,
      actionsFilePath: actionsFile,
      specDir,
      spawnFn: longSpawn,
      stateFilePath: stateFile,
      heartbeatInterval: 999999,
      wsPingInterval: 999999,
      modulesProgressPath: '/tmp/nonexistent.json',
    });

    await orch.start();

    // Dispatch to spawn a long-running process
    orch.agentScheduler.dispatch({
      action: 'to_arch', from: 'human', to: 'arch', ts: 1, message: 'long running',
    });

    await sleep(200);
    assert.ok(spawnedProc, 'process should have been spawned');
    assert.ok(isAlive(spawnedProc.pid), 'child should be alive');

    const shutdownEvents = [];
    orch.on('shutdown-kill', (d) => shutdownEvents.push(d));

    // Graceful shutdown
    await orch.stop();

    // Child should have been killed
    await sleep(200);
    assert.strictEqual(isAlive(spawnedProc.pid), false, 'child should be dead after shutdown');
    assert.strictEqual(shutdownEvents.length, 1);
    assert.strictEqual(shutdownEvents[0].killed[0].role, 'arch');
  });
});
