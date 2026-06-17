'use strict';

/**
 * E2E Test: Feature #12 - Checkpoint Step 4
 *
 * Step 4: During repair debounce window, new valid single-line writes
 *         are not lost and emit normally.
 *
 * Uses real chokidar file watching (no mocks on ActionWatcher).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ActionWatcher = require('../../src/action-watcher');

describe('E2E: New writes during repair not lost (Step 4)', () => {
  let tmpDir;
  let filePath;
  let watcher;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat12-step4-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
    fs.writeFileSync(filePath, '');
  });

  after(async () => {
    if (watcher) await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should emit new valid single-line writes during repair debounce window', async () => {
    watcher = new ActionWatcher(filePath);
    const actions = [];
    const repaired = [];
    watcher.on('action', (a) => actions.push(a));
    watcher.on('repaired', (info) => repaired.push(info));
    watcher.start();

    await sleep(200);

    // 1. Write multi-line JSON (triggers repair schedule with 500ms debounce)
    const action1 = {
      action: 'dev_do',
      from: 'arch',
      to: 'dev',
      ts: 1,
      message: 'multi-line action triggers repair',
    };
    const json1 = JSON.stringify(action1);
    const mid1 = Math.floor(json1.length / 2);
    fs.appendFileSync(filePath, json1.slice(0, mid1) + '\n' + json1.slice(mid1) + '\n');

    // Wait for first action to emit
    await waitFor(() => actions.length >= 1, 5000);
    assert.strictEqual(actions.length, 1);
    assert.deepStrictEqual(actions[0], action1);

    // 2. Immediately write a valid single-line (within debounce window)
    const action2 = {
      action: 'to_arch',
      from: 'dev',
      to: 'arch',
      ts: 2,
      message: 'valid single-line during debounce window',
    };
    fs.appendFileSync(filePath, JSON.stringify(action2) + '\n');

    // Wait for second action to emit
    await waitFor(() => actions.length >= 2, 5000);
    assert.strictEqual(actions.length, 2);
    assert.deepStrictEqual(actions[1], action2);

    // 3. Wait for repair to complete
    await waitFor(() => repaired.length >= 1, 3000);

    // 4. Write another valid single-line AFTER repair (verify offset tracking still works)
    const action3 = {
      action: 'to_human',
      from: 'arch',
      to: 'human',
      ts: 3,
      message: 'post-repair action',
    };
    fs.appendFileSync(filePath, JSON.stringify(action3) + '\n');

    await waitFor(() => actions.length >= 3, 5000);
    assert.strictEqual(actions.length, 3);
    assert.deepStrictEqual(actions[2], action3);

    // 5. Verify final file state: all 3 actions on single lines
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    assert.strictEqual(lines.length, 3, `Expected 3 lines, got ${lines.length}`);

    // Each line should be valid JSON
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `Line is not valid JSON: ${line}`);
    }

    console.log('[PASS] Step 4: New valid writes during and after repair all emitted correctly');
  });

  it('should handle interleaved multi-line and single-line writes', async () => {
    await watcher.stop();

    const filePath2 = path.join(tmpDir, 'actions2.jsonl');
    fs.writeFileSync(filePath2, '');

    watcher = new ActionWatcher(filePath2);
    const actions = [];
    watcher.on('action', (a) => actions.push(a));
    watcher.start();

    await sleep(200);

    // Valid single-line first
    const a1 = { action: 'to_arch', from: 'dev', to: 'arch', ts: 10, message: 'single1' };
    fs.appendFileSync(filePath2, JSON.stringify(a1) + '\n');

    await waitFor(() => actions.length >= 1, 5000);

    // Multi-line second
    const a2 = { action: 'dev_do', from: 'arch', to: 'dev', ts: 20, message: 'multi-line interleaved' };
    const j2 = JSON.stringify(a2);
    fs.appendFileSync(filePath2, j2.slice(0, 25) + '\n' + j2.slice(25) + '\n');

    await waitFor(() => actions.length >= 2, 5000);

    // Valid single-line third
    const a3 = { action: 'to_human', from: 'arch', to: 'human', ts: 30, message: 'single2' };
    fs.appendFileSync(filePath2, JSON.stringify(a3) + '\n');

    await waitFor(() => actions.length >= 3, 5000);
    assert.strictEqual(actions.length, 3);
    assert.deepStrictEqual(actions[0], a1);
    assert.deepStrictEqual(actions[1], a2);
    assert.deepStrictEqual(actions[2], a3);

    // Wait for repair to settle
    await sleep(800);

    // All lines should be valid single-line JSONL
    const content = fs.readFileSync(filePath2, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    assert.strictEqual(lines.length, 3);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }

    console.log('[PASS] Step 4 (extended): Interleaved multi-line and single-line all handled correctly');
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
