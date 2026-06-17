'use strict';

/**
 * E2E: Feature #17 — Workspace path unification
 *
 * Step 1: spawn cwd = workspaceDir (not daemon's cwd)
 * Step 2: agent logs written to workspace/logs/ (not daemon/logs/)
 * Step 3: .daemon-state.json created in workspace root
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');
const EventEmitter = require('events');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Workspace path unification (Feature #17)', { timeout: 30_000 }, () => {
  let workspaceDir;
  let projectJsonPath;
  let actionsFile;
  let specDir;

  before(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat17-'));
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
        arch_agent: { session: { runing: 'a1111111-0000-4000-8000-000000000001' } },
        dev_agent: { session: { runing: 'd1111111-0000-4000-8000-000000000001', done: [] } },
        uat_agent: { session: { runing: 'u1111111-0000-4000-8000-000000000001' } },
      }
    }, null, 2));
    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('Step 1: spawn should use workspaceDir as cwd', async () => {
    let spawnedCwd = null;

    const mockWatcher = new EventEmitter();
    mockWatcher.close = async () => {};

    const orchestrator = new DaemonOrchestrator({
      port: 13290,
      projectJsonPath,
      workspaceDir,
      actionsFilePath: actionsFile,
      specDir,
      modulesProgressPath: path.join(specDir, 'modules_progress.json'),
      watcherFactory: () => mockWatcher,
      healthCheckInterval: 0,
      spawnFn: (cmd, args, opts) => {
        spawnedCwd = opts.cwd;
        const proc = spawn('node', ['-e', 'process.stdout.write("ok"); process.exit(0)'], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return proc;
      },
    });

    await orchestrator.start();

    // Dispatch a message to trigger spawn
    const action = { action: 'to_arch', from: 'human', to: 'arch', ts: Date.now(), message: 'test' };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');
    mockWatcher.emit('change');

    await sleep(2000);

    assert.equal(spawnedCwd, workspaceDir, 'spawn cwd should be workspaceDir');

    await orchestrator.stop();
  });

  it('Step 2: agent logs should be written to workspace/logs/', async () => {
    const logsDir = path.join(workspaceDir, 'logs');

    const mockWatcher = new EventEmitter();
    mockWatcher.close = async () => {};

    const orchestrator = new DaemonOrchestrator({
      port: 13291,
      projectJsonPath,
      workspaceDir,
      actionsFilePath: actionsFile,
      specDir,
      modulesProgressPath: path.join(specDir, 'modules_progress.json'),
      watcherFactory: () => mockWatcher,
      healthCheckInterval: 0,
      spawnFn: (cmd, args, opts) => {
        const proc = spawn('node', ['-e', 'process.stdout.write("hello agent log"); process.exit(0)'], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return proc;
      },
    });

    await orchestrator.start();

    const action = { action: 'to_arch', from: 'human', to: 'arch', ts: Date.now(), message: 'log test' };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');
    mockWatcher.emit('change');

    await sleep(2000);

    // Check that logs directory was created under workspace
    assert.ok(fs.existsSync(logsDir), 'workspace/logs/ should exist');

    // Check that an arch log file was created
    const logFiles = fs.readdirSync(logsDir).filter(f => f.startsWith('arch_'));
    assert.ok(logFiles.length > 0, 'arch log file should exist in workspace/logs/');

    const logContent = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf8');
    assert.ok(logContent.includes('hello agent log'), 'log should contain agent stdout');

    await orchestrator.stop();
  });

  it('Step 3: .daemon-state.json should be created in workspace root', async () => {
    const stateFile = path.join(workspaceDir, '.daemon-state.json');
    // Remove if exists from previous test
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    const mockWatcher = new EventEmitter();
    mockWatcher.close = async () => {};

    const orchestrator = new DaemonOrchestrator({
      port: 13292,
      projectJsonPath,
      workspaceDir,
      actionsFilePath: actionsFile,
      specDir,
      modulesProgressPath: path.join(specDir, 'modules_progress.json'),
      watcherFactory: () => mockWatcher,
      healthCheckInterval: 0,
      spawnFn: (cmd, args, opts) => {
        const proc = spawn('node', ['-e', 'process.exit(0)'], {
          ...opts,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return proc;
      },
    });

    await orchestrator.start();

    // Trigger a dispatch so offset gets updated
    const action = { action: 'to_arch', from: 'human', to: 'arch', ts: Date.now(), message: 'state test' };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');
    mockWatcher.emit('change');

    await sleep(1500);
    await orchestrator.stop();

    assert.ok(fs.existsSync(stateFile), '.daemon-state.json should exist in workspace root');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.ok('lastProcessingOffset' in state, 'state should have lastProcessingOffset');
  });
});
