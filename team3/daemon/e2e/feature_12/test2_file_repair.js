'use strict';

/**
 * E2E Test: Feature #12 - Checkpoint Step 2
 *
 * Step 2: After emit, within 500ms the file is auto-repaired to single-line JSONL.
 *         Read file to verify the multi-line entry became a single line.
 *
 * Uses real chokidar file watching (no mocks on ActionWatcher).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ActionWatcher = require('../../src/action-watcher');

describe('E2E: File auto-repair to single-line JSONL (Step 2)', () => {
  let tmpDir;
  let filePath;
  let watcher;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat12-step2-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
    fs.writeFileSync(filePath, '');
  });

  after(async () => {
    if (watcher) await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should repair multi-line JSON to single-line within 500ms of emit', async () => {
    watcher = new ActionWatcher(filePath);
    const actions = [];
    const repaired = [];
    watcher.on('action', (a) => actions.push(a));
    watcher.on('repaired', (info) => repaired.push(info));
    watcher.start();

    await sleep(200);

    // Write a 3-line JSON
    const action = {
      action: 'to_arch',
      from: 'dev',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: 'Repair test: split across three lines for checkpoint step 2',
    };
    const jsonStr = JSON.stringify(action);
    const third = Math.floor(jsonStr.length / 3);

    fs.appendFileSync(filePath,
      jsonStr.slice(0, third) + '\n' +
      jsonStr.slice(third, third * 2) + '\n' +
      jsonStr.slice(third * 2) + '\n'
    );

    // Wait for emit
    await waitFor(() => actions.length >= 1, 5000);
    assert.strictEqual(actions.length, 1);

    // Wait for repair (debounce 500ms)
    await waitFor(() => repaired.length >= 1, 3000);

    // Read the file and verify it's now single-line JSONL
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    assert.strictEqual(lines.length, 1, `Expected 1 line, got ${lines.length}: ${JSON.stringify(lines)}`);

    // Verify the single line is valid JSON matching the original action
    const parsed = JSON.parse(lines[0]);
    assert.deepStrictEqual(parsed, action);

    // Verify file ends with newline
    assert.ok(content.endsWith('\n'), 'File should end with newline');

    console.log(`[PASS] Step 2: File repaired to single-line JSONL (${repaired[0].oldSize} → ${repaired[0].newSize} bytes)`);
  });

  it('should repair multiple multi-line entries in one pass', async () => {
    // Stop previous watcher, start fresh
    await watcher.stop();

    const filePath2 = path.join(tmpDir, 'actions2.jsonl');
    fs.writeFileSync(filePath2, '');

    watcher = new ActionWatcher(filePath2);
    const actions = [];
    const repaired = [];
    watcher.on('action', (a) => actions.push(a));
    watcher.on('repaired', (info) => repaired.push(info));
    watcher.start();

    await sleep(200);

    // Write two multi-line JSONs back to back
    const action1 = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'first multi-line' };
    const action2 = { action: 'to_human', from: 'arch', to: 'human', ts: 2, message: 'second multi-line' };
    const json1 = JSON.stringify(action1);
    const json2 = JSON.stringify(action2);

    const mid1 = Math.floor(json1.length / 2);
    const mid2 = Math.floor(json2.length / 2);

    fs.appendFileSync(filePath2,
      json1.slice(0, mid1) + '\n' + json1.slice(mid1) + '\n' +
      json2.slice(0, mid2) + '\n' + json2.slice(mid2) + '\n'
    );

    // Wait for both actions to emit
    await waitFor(() => actions.length >= 2, 5000);
    assert.strictEqual(actions.length, 2);
    assert.deepStrictEqual(actions[0], action1);
    assert.deepStrictEqual(actions[1], action2);

    // Wait for repair
    await waitFor(() => repaired.length >= 1, 3000);

    // Verify file has exactly 2 single-line entries
    const content = fs.readFileSync(filePath2, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(JSON.parse(lines[0]), action1);
    assert.deepStrictEqual(JSON.parse(lines[1]), action2);

    console.log('[PASS] Step 2 (extended): Multiple multi-line entries repaired to single lines');
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
