'use strict';

/**
 * Integration Test: Step 1
 * "手动追加一行合法 action 到 actions.jsonl，daemon 日志显示检测到新消息并正确解析"
 *
 * Uses real chokidar file watching (no mocks).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ActionWatcher = require('../../src/action-watcher');

describe('E2E: actions.jsonl file watch + parse (Step 1)', () => {
  let tmpDir;
  let filePath;
  let watcher;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat3-step1-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
    // Start with empty file
    fs.writeFileSync(filePath, '');
  });

  after(async () => {
    if (watcher) await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect new line appended to actions.jsonl and parse correctly', async () => {
    watcher = new ActionWatcher(filePath);

    const detected = [];
    watcher.on('action', (action) => {
      detected.push(action);
    });

    watcher.start();

    // Wait a bit for watcher to initialize
    await sleep(200);

    // Append a valid action line (simulating agent or human writing)
    const action = {
      action: 'dev_do',
      from: 'arch',
      to: 'dev',
      ts: Math.floor(Date.now() / 1000),
      message: 'Please implement Feature #3',
    };
    fs.appendFileSync(filePath, JSON.stringify(action) + '\n');

    // Wait for chokidar to detect the change
    await waitFor(() => detected.length >= 1, 3000);

    assert.strictEqual(detected.length, 1);
    assert.strictEqual(detected[0].action, 'dev_do');
    assert.strictEqual(detected[0].from, 'arch');
    assert.strictEqual(detected[0].to, 'dev');
    assert.strictEqual(detected[0].ts, action.ts);
    assert.strictEqual(detected[0].message, 'Please implement Feature #3');

    console.log('[PASS] Detected new action line and parsed correctly');
  });

  it('should detect multiple appended lines incrementally', async () => {
    // Watcher is already running from previous test - restart fresh
    if (watcher) await watcher.stop();

    const filePath2 = path.join(tmpDir, 'actions2.jsonl');
    fs.writeFileSync(filePath2, '');

    watcher = new ActionWatcher(filePath2);
    const detected = [];
    watcher.on('action', (action) => detected.push(action));
    watcher.start();

    await sleep(200);

    // Append first line
    fs.appendFileSync(filePath2, JSON.stringify({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'msg1',
    }) + '\n');

    await waitFor(() => detected.length >= 1, 3000);
    assert.strictEqual(detected.length, 1);

    // Append second line
    fs.appendFileSync(filePath2, JSON.stringify({
      action: 'dev_fix', from: 'arch', to: 'dev', ts: 2, message: 'msg2',
    }) + '\n');

    await waitFor(() => detected.length >= 2, 3000);
    assert.strictEqual(detected.length, 2);
    assert.strictEqual(detected[1].action, 'dev_fix');
    assert.strictEqual(detected[1].message, 'msg2');

    console.log('[PASS] Detected multiple lines incrementally');
  });

  it('should emit validation-error for invalid action (missing fields)', async () => {
    if (watcher) await watcher.stop();

    const filePath3 = path.join(tmpDir, 'actions3.jsonl');
    fs.writeFileSync(filePath3, '');

    watcher = new ActionWatcher(filePath3);
    const errors = [];
    const actions = [];
    watcher.on('validation-error', (e) => errors.push(e));
    watcher.on('action', (a) => actions.push(a));
    watcher.start();

    await sleep(200);

    // Invalid line (missing 'message' field)
    fs.appendFileSync(filePath3, '{"action":"dev_do","from":"arch","to":"dev","ts":1}\n');

    await waitFor(() => errors.length >= 1, 3000);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].missing.includes('message'));
    assert.strictEqual(actions.length, 0);

    console.log('[PASS] Invalid action correctly rejected with validation-error');
  });

  it('should only read new content, not existing lines', async () => {
    if (watcher) await watcher.stop();

    const filePath4 = path.join(tmpDir, 'actions4.jsonl');
    // Pre-populate with existing content
    const existingLine = JSON.stringify({
      action: 'to_human', from: 'arch', to: 'human', ts: 100, message: 'old'
    }) + '\n';
    fs.writeFileSync(filePath4, existingLine);

    watcher = new ActionWatcher(filePath4);
    const detected = [];
    watcher.on('action', (a) => detected.push(a));
    watcher.start();

    await sleep(200);

    // Only new content should be detected
    fs.appendFileSync(filePath4, JSON.stringify({
      action: 'dev_do', from: 'arch', to: 'dev', ts: 200, message: 'new'
    }) + '\n');

    await waitFor(() => detected.length >= 1, 3000);
    assert.strictEqual(detected.length, 1);
    assert.strictEqual(detected[0].message, 'new');
    // 'old' should not appear
    assert.ok(!detected.some(a => a.message === 'old'));

    console.log('[PASS] Only new content read (incremental offset tracking)');
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
