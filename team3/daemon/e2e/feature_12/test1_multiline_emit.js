'use strict';

/**
 * E2E Test: Feature #12 - Checkpoint Step 1 & 3
 *
 * Step 1: Append a 3-line JSON to actions.jsonl, ActionWatcher emits complete action.
 * Step 3: Repair write doesn't trigger ActionWatcher double emit (same message only once).
 *
 * Uses real chokidar file watching (no mocks on ActionWatcher).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ActionWatcher = require('../../src/action-watcher');

describe('E2E: Multi-line JSON emit + no double emit (Steps 1 & 3)', () => {
  let tmpDir;
  let filePath;
  let watcher;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat12-step1-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
    fs.writeFileSync(filePath, '');
  });

  after(async () => {
    if (watcher) await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 1: 3-line JSON → ActionWatcher emits complete action object', async () => {
    watcher = new ActionWatcher(filePath);
    const actions = [];
    const repairScheduled = [];
    watcher.on('action', (a) => actions.push(a));
    watcher.on('repair-scheduled', () => repairScheduled.push(Date.now()));
    watcher.start();

    await sleep(200);

    // Build a valid action JSON and split it across 3 lines
    const action = {
      action: 'dev_do',
      from: 'arch',
      to: 'dev',
      ts: Math.floor(Date.now() / 1000),
      message: 'Feature #12 multi-line test: this action is deliberately split across three lines',
    };
    const jsonStr = JSON.stringify(action);
    // Split into 3 roughly equal parts
    const third = Math.floor(jsonStr.length / 3);
    const part1 = jsonStr.slice(0, third);
    const part2 = jsonStr.slice(third, third * 2);
    const part3 = jsonStr.slice(third * 2);

    // Write as 3 separate lines (simulating agent that outputs multi-line JSON)
    const multiLine = part1 + '\n' + part2 + '\n' + part3 + '\n';
    fs.appendFileSync(filePath, multiLine);

    // Wait for chokidar to detect and ActionWatcher to buffer+emit
    await waitFor(() => actions.length >= 1, 5000);

    assert.strictEqual(actions.length, 1);
    assert.deepStrictEqual(actions[0], action);
    assert.strictEqual(repairScheduled.length, 1);

    console.log('[PASS] Step 1: 3-line JSON correctly buffered and emitted as single action');
  });

  it('Step 3: repair write does NOT trigger double emit', async () => {
    // Continue from Step 1 — watcher is still running with 1 action emitted
    // Repair should fire within 500ms of the emit. Wait for it.
    const repaired = [];
    watcher.on('repaired', (info) => repaired.push(info));

    await waitFor(() => repaired.length >= 1, 3000);

    // Count total actions — should still be exactly 1 (no double emit from repair)
    const totalActions = [];
    // Re-register to capture any new emissions
    watcher.on('action', (a) => totalActions.push(a));

    // Wait a bit more to confirm no spurious re-emission
    await sleep(500);
    assert.strictEqual(totalActions.length, 0, 'No additional action emitted after repair');

    console.log(`[PASS] Step 3: Repair write (${repaired[0].oldSize} → ${repaired[0].newSize} bytes) did not trigger double emit`);
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
        setTimeout(check, 50);
      }
    };
    check();
  });
}
