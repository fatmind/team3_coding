'use strict';

/**
 * E2E: Feature #15 — DaemonOrchestrator integration with state persistence
 *
 * Step 5 regression: Full orchestrator lifecycle with real StatePersistence:
 * - Start orchestrator → processes lines → stop → state persisted
 * - Restart orchestrator → replays missed lines → dispatched to scheduler
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { spawn } = require('child_process');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');
const StatePersistence = require('../../src/state-persistence');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Orchestrator + state persistence (Feature #15)', { timeout: 30_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsFile;
  let stateFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat15-orch-'));
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

  it('should persist offset on graceful stop and replay on restart', async () => {
    const port1 = 13175;

    // No-op spawn to avoid real claude
    function testSpawn(cmd, args, opts) {
      const script = 'process.exit(0);';
      return spawn('node', ['-e', script], { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
    }

    // Phase 1: Start orchestrator, process some lines
    const orch1 = new DaemonOrchestrator({
      port: port1,
      projectJsonPath,
      actionsFilePath: actionsFile,
      specDir,
      spawnFn: testSpawn,
      stateFilePath: stateFile,
      heartbeatInterval: 999999,
      wsPingInterval: 999999,
      modulesProgressPath: '/tmp/nonexistent.json',
    });

    const dispatched1 = [];
    orch1.agentScheduler.on('enqueued', (d) => dispatched1.push(d));

    await orch1.start();
    await sleep(500);

    // Write a line while running
    const line1 = JSON.stringify({ action: 'to_arch', from: 'human', to: 'arch', ts: 1, message: 'hello arch' }) + '\n';
    fs.appendFileSync(actionsFile, line1);

    // Wait for chokidar to detect
    await sleep(1500);

    // Graceful stop → state persisted
    await orch1.stop();

    // Verify state file exists with non-zero offset
    assert.ok(fs.existsSync(stateFile));
    const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.ok(savedState.lastProcessingOffset > 0);
    const savedOffset = savedState.lastProcessingOffset;

    // Phase 2: Write lines while "down"
    const line2 = JSON.stringify({ action: 'to_arch', from: 'dev', to: 'arch', ts: 2, message: 'missed during downtime' }) + '\n';
    fs.appendFileSync(actionsFile, line2);

    // Phase 3: Restart orchestrator on a different port
    const port2 = 13176;
    const orch2 = new DaemonOrchestrator({
      port: port2,
      projectJsonPath,
      actionsFilePath: actionsFile,
      specDir,
      spawnFn: testSpawn,
      stateFilePath: stateFile,
      heartbeatInterval: 999999,
      wsPingInterval: 999999,
      modulesProgressPath: '/tmp/nonexistent.json',
    });

    const dispatched2 = [];
    orch2.agentScheduler.on('enqueued', (d) => dispatched2.push(d));

    await orch2.start();
    await sleep(1000);

    // The missed line should have been replayed
    assert.ok(dispatched2.length >= 1, `Expected at least 1 dispatched, got ${dispatched2.length}`);
    const replayedMessages = dispatched2.map(d => d.action.message);
    assert.ok(replayedMessages.includes('missed during downtime'),
      `Expected 'missed during downtime' in ${JSON.stringify(replayedMessages)}`);

    await orch2.stop();

    // Verify final offset updated
    const finalState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.ok(finalState.lastProcessingOffset > savedOffset);
  });
});
