'use strict';

/**
 * E2E: Feature #15 — ActionWatcher offset persistence + Daemon restart Replay
 *
 * Step 1: Daemon processes actions.jsonl lines → .daemon-state.json offset updated
 * Step 2: Kill daemon, append 2 lines during downtime
 * Step 3: Restart daemon → replays from persisted offset, routes 2 missed lines
 * Step 4: File truncation (size < persisted offset) → reset to 0, read from head
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const ActionWatcher = require('../../src/action-watcher');
const StatePersistence = require('../../src/state-persistence');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Offset persistence + restart replay (Feature #15)', { timeout: 30_000 }, () => {
  let tmpDir;
  let actionsFile;
  let stateFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat15-'));
    actionsFile = path.join(tmpDir, 'actions.jsonl');
    stateFile = path.join(tmpDir, '.daemon-state.json');
    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 1: should update .daemon-state.json offset after processing lines', async () => {
    const sp = new StatePersistence(stateFile, { debounceMs: 50 });
    sp.load();

    const mockWatcher = new EventEmitter();
    mockWatcher.close = async () => {};

    const watcher = new ActionWatcher(actionsFile, {
      watcherFactory: () => mockWatcher,
      onOffsetUpdate: (offset) => sp.updateOffset(offset),
    });
    watcher.start();

    // Append 2 lines
    const line1 = JSON.stringify({ action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'msg1' }) + '\n';
    const line2 = JSON.stringify({ action: 'dev_do', from: 'arch', to: 'dev', ts: 2, message: 'msg2' }) + '\n';
    fs.appendFileSync(actionsFile, line1 + line2);
    mockWatcher.emit('change');

    // Wait for debounce to flush
    await sleep(150);

    // Verify state file was written with correct offset
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const expectedOffset = Buffer.byteLength(line1 + line2);
    assert.strictEqual(saved.lastProcessingOffset, expectedOffset);
    assert.ok(saved.lastUpdated);

    await watcher.stop();
    sp.destroy();
  });

  it('Step 2+3: should replay missed lines after simulated crash and restart', async () => {
    // Phase 1: Daemon processes some lines, then "crashes" (stop without graceful offset update)
    const sp1 = new StatePersistence(stateFile, { debounceMs: 50 });
    sp1.load();

    const mockWatcher1 = new EventEmitter();
    mockWatcher1.close = async () => {};

    const actions1 = [];
    const watcher1 = new ActionWatcher(actionsFile, {
      watcherFactory: () => mockWatcher1,
      onOffsetUpdate: (offset) => sp1.updateOffset(offset),
    });
    watcher1.on('action', (a) => actions1.push(a));
    watcher1.start();

    // Process initial content (from step 1 test, file already has 2 lines)
    // Read existing content
    mockWatcher1.emit('change');
    await sleep(150);

    const offsetAfterPhase1 = sp1.lastProcessingOffset;
    assert.ok(offsetAfterPhase1 > 0);

    // "Crash" — stop watcher, persist current state
    sp1.saveSync();
    await watcher1.stop();
    sp1.destroy();

    // Phase 2: While "crashed", append 2 more lines
    const line3 = JSON.stringify({ action: 'to_arch', from: 'human', to: 'arch', ts: 3, message: 'missed1' }) + '\n';
    const line4 = JSON.stringify({ action: 'dev_do', from: 'arch', to: 'dev', ts: 4, message: 'missed2' }) + '\n';
    fs.appendFileSync(actionsFile, line3 + line4);

    // Phase 3: Restart — load persisted offset, start from there
    const sp2 = new StatePersistence(stateFile, { debounceMs: 50 });
    const persistedState = sp2.load();
    assert.strictEqual(persistedState.lastProcessingOffset, offsetAfterPhase1);

    const mockWatcher2 = new EventEmitter();
    mockWatcher2.close = async () => {};

    const actions2 = [];
    const watcher2 = new ActionWatcher(actionsFile, {
      watcherFactory: () => mockWatcher2,
      initialOffset: persistedState.lastProcessingOffset,
      onOffsetUpdate: (offset) => sp2.updateOffset(offset),
    });
    watcher2.on('action', (a) => actions2.push(a));
    watcher2.start();

    // Replay should have processed the 2 missed lines during start()
    assert.strictEqual(actions2.length, 2);
    assert.strictEqual(actions2[0].message, 'missed1');
    assert.strictEqual(actions2[1].message, 'missed2');

    await sleep(150);

    // Verify offset updated after replay
    const newOffset = sp2.lastProcessingOffset;
    assert.ok(newOffset > offsetAfterPhase1);

    await watcher2.stop();
    sp2.destroy();
  });

  it('Step 4: should reset to 0 when file is truncated (size < persisted offset)', async () => {
    // Write a large persisted offset to state file
    fs.writeFileSync(stateFile, JSON.stringify({
      lastProcessingOffset: 99999,
      spawnedPids: { arch: null, dev: null, uat: null },
      lastUpdated: new Date().toISOString(),
    }));

    // Truncate actions file to something small
    const smallContent = JSON.stringify({ action: 'to_arch', from: 'dev', to: 'arch', ts: 5, message: 'after truncation' }) + '\n';
    fs.writeFileSync(actionsFile, smallContent);

    const sp = new StatePersistence(stateFile, { debounceMs: 50 });
    const persistedState = sp.load();
    assert.strictEqual(persistedState.lastProcessingOffset, 99999);

    const mockWatcher = new EventEmitter();
    mockWatcher.close = async () => {};

    const actions = [];
    const watcher = new ActionWatcher(actionsFile, {
      watcherFactory: () => mockWatcher,
      initialOffset: persistedState.lastProcessingOffset,
      onOffsetUpdate: (offset) => sp.updateOffset(offset),
    });
    watcher.on('action', (a) => actions.push(a));
    watcher.start();

    // Should have reset to 0 and replayed from beginning
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].message, 'after truncation');

    await sleep(150);
    assert.strictEqual(sp.lastProcessingOffset, Buffer.byteLength(smallContent));

    await watcher.stop();
    sp.destroy();
  });
});
