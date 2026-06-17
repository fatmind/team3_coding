'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const ActionWatcher = require('../src/action-watcher');

describe('ActionWatcher', () => {
  let tmpDir;
  let filePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-watcher-test-'));
    filePath = path.join(tmpDir, 'actions.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should initialize with correct defaults', () => {
      const watcher = new ActionWatcher(filePath);
      assert.strictEqual(watcher.filePath, filePath);
      assert.strictEqual(watcher.offset, 0);
      assert.strictEqual(watcher.isWatching, false);
    });
  });

  describe('start', () => {
    it('should initialize offset to current file size', () => {
      // Create a file with some existing content
      fs.writeFileSync(filePath, '{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"hi"}\n');
      const expectedSize = fs.statSync(filePath).size;

      // Use a mock watcher to avoid actual chokidar
      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      assert.strictEqual(watcher.offset, expectedSize);
      assert.strictEqual(watcher.isWatching, true);

      watcher.stop();
    });

    it('should set offset to 0 if file does not exist', () => {
      const nonExist = path.join(tmpDir, 'nonexist.jsonl');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(nonExist, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      assert.strictEqual(watcher.offset, 0);
      watcher.stop();
    });

    it('should not start twice', () => {
      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};
      let callCount = 0;

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => { callCount++; return mockWatcher; },
      });
      fs.writeFileSync(filePath, '');

      watcher.start();
      watcher.start(); // second call should be no-op

      assert.strictEqual(callCount, 1);
      watcher.stop();
    });
  });

  describe('_readNewContent', () => {
    it('should parse a valid action line', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      // Append a new line
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1779000000, message: 'test' };
      fs.appendFileSync(filePath, JSON.stringify(action) + '\n');

      // Trigger change manually (mock doesn't trigger automatically)
      mockWatcher.emit('change');

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], action);

      watcher.stop();
    });

    it('should handle multiple lines at once', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      // Append multiple lines at once
      const lines = [
        { action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'msg1' },
        { action: 'to_arch', from: 'dev', to: 'arch', ts: 2, message: 'msg2' },
        { action: 'dev_fix', from: 'arch', to: 'dev', ts: 3, message: 'msg3' },
      ];
      fs.appendFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

      mockWatcher.emit('change');

      assert.strictEqual(actions.length, 3);
      assert.deepStrictEqual(actions[0], lines[0]);
      assert.deepStrictEqual(actions[1], lines[1]);
      assert.deepStrictEqual(actions[2], lines[2]);

      watcher.stop();
    });

    it('should skip empty lines', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      fs.appendFileSync(filePath, '\n\n{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"hi"}\n\n');
      mockWatcher.emit('change');

      assert.strictEqual(actions.length, 1);
      watcher.stop();
    });

    it('should only read new content (incremental)', () => {
      // File starts with existing content
      const existing = '{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"old"}\n';
      fs.writeFileSync(filePath, existing);

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      // Append new content
      fs.appendFileSync(filePath, '{"action":"dev_do","from":"arch","to":"dev","ts":2,"message":"new"}\n');
      mockWatcher.emit('change');

      // Should only get the new line
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].message, 'new');

      watcher.stop();
    });
  });

  describe('_parseLine - validation', () => {
    it('should emit parse-error for invalid JSON (flushed when valid line arrives)', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const errors = [];
      watcher.on('parse-error', (e) => errors.push(e));

      // Feature #12: invalid lines are buffered hoping to form multi-line JSON.
      // They flush as parse-error only when a valid standalone line arrives.
      fs.appendFileSync(filePath, 'not-valid-json\n');
      mockWatcher.emit('change');

      // Still buffered — no parse-error yet
      assert.strictEqual(errors.length, 0);

      // Now a valid line arrives, flushing the orphaned buffer
      fs.appendFileSync(filePath, '{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"flush"}\n');
      mockWatcher.emit('change');

      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].line, 'not-valid-json');

      watcher.stop();
    });

    it('should emit validation-error for missing required fields', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const errors = [];
      watcher.on('validation-error', (e) => errors.push(e));

      // Missing 'message' field
      fs.appendFileSync(filePath, '{"action":"dev_do","from":"arch","to":"dev","ts":1}\n');
      mockWatcher.emit('change');

      assert.strictEqual(errors.length, 1);
      assert.ok(errors[0].missing.includes('message'));

      watcher.stop();
    });

    it('should emit validation-error for multiple missing fields', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const errors = [];
      watcher.on('validation-error', (e) => errors.push(e));

      // Missing action, ts, message
      fs.appendFileSync(filePath, '{"from":"arch","to":"dev"}\n');
      mockWatcher.emit('change');

      assert.strictEqual(errors.length, 1);
      assert.ok(errors[0].missing.includes('action'));
      assert.ok(errors[0].missing.includes('ts'));
      assert.ok(errors[0].missing.includes('message'));

      watcher.stop();
    });
  });

  describe('stop', () => {
    it('should stop watching', async () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      let closed = false;
      mockWatcher.close = async () => { closed = true; };

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();
      assert.strictEqual(watcher.isWatching, true);

      await watcher.stop();
      assert.strictEqual(watcher.isWatching, false);
      assert.strictEqual(closed, true);
    });
  });

  describe('raw line emission', () => {
    it('should emit raw line string as second argument of action event', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const results = [];
      watcher.on('action', (parsed, rawLine) => results.push({ parsed, rawLine }));

      const action = { action: 'to_human', from: 'arch', to: 'human', ts: 1234, message: 'hello' };
      const line = JSON.stringify(action);
      fs.appendFileSync(filePath, line + '\n');
      mockWatcher.emit('change');

      assert.strictEqual(results.length, 1);
      assert.deepStrictEqual(results[0].parsed, action);
      assert.strictEqual(results[0].rawLine, line);

      watcher.stop();
    });
  });

  describe('buffer handling', () => {
    it('should buffer incomplete lines across reads', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      // Write partial content (no newline)
      const partial = '{"action":"dev_do","from":"arch","to":"dev",';
      fs.appendFileSync(filePath, partial);
      mockWatcher.emit('change');

      // No action yet (incomplete)
      assert.strictEqual(actions.length, 0);

      // Complete the line
      fs.appendFileSync(filePath, '"ts":1,"message":"test"}\n');
      mockWatcher.emit('change');

      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].message, 'test');

      watcher.stop();
    });
  });

  describe('Feature #12: Multi-line JSON repair', () => {
    it('should buffer consecutive parse-failed lines and emit when joined forms valid JSON', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      const repairScheduled = [];
      watcher.on('action', (a) => actions.push(a));
      watcher.on('repair-scheduled', () => repairScheduled.push(true));

      // Write a valid JSON action split across 3 lines (simulating agent multi-line write)
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1779000000, message: 'multi-line test' };
      const jsonStr = JSON.stringify(action);
      // Split: {"action":"dev_do","from":"arch" | ,"to":"dev","ts":1779000000 | ,"message":"multi-line test"}
      const part1 = jsonStr.slice(0, 30);
      const part2 = jsonStr.slice(30, 60);
      const part3 = jsonStr.slice(60);

      fs.appendFileSync(filePath, part1 + '\n' + part2 + '\n' + part3 + '\n');
      mockWatcher.emit('change');

      // Should emit exactly 1 action from the joined multi-line buffer
      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], action);
      // Should have scheduled a repair
      assert.strictEqual(repairScheduled.length, 1);

      watcher.stop();
    });

    it('should flush orphaned buffer lines as parse-error when a valid standalone line arrives', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      const parseErrors = [];
      watcher.on('action', (a) => actions.push(a));
      watcher.on('parse-error', (e) => parseErrors.push(e));

      // Write orphaned partial lines followed by a valid line
      const validAction = { action: 'to_arch', from: 'dev', to: 'arch', ts: 2, message: 'valid' };
      fs.appendFileSync(filePath,
        '{"orphan": "incomplete\n' +
        'more orphan stuff\n' +
        JSON.stringify(validAction) + '\n'
      );
      mockWatcher.emit('change');

      // Orphaned lines should be flushed as parse-errors
      assert.strictEqual(parseErrors.length, 2);
      assert.ok(parseErrors[0].line.includes('orphan'));
      assert.ok(parseErrors[1].line.includes('orphan'));

      // The valid action should still be emitted
      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], validAction);

      watcher.stop();
    });

    it('should handle mixed: valid line + multi-line + valid line', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      const action1 = { action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'first' };
      const action2 = { action: 'dev_do', from: 'arch', to: 'dev', ts: 2, message: 'split action' };
      const action3 = { action: 'to_human', from: 'arch', to: 'human', ts: 3, message: 'third' };

      // Split action2 across 2 lines
      const json2 = JSON.stringify(action2);
      const mid = Math.floor(json2.length / 2);

      fs.appendFileSync(filePath,
        JSON.stringify(action1) + '\n' +
        json2.slice(0, mid) + '\n' +
        json2.slice(mid) + '\n' +
        JSON.stringify(action3) + '\n'
      );
      mockWatcher.emit('change');

      assert.strictEqual(actions.length, 3);
      assert.deepStrictEqual(actions[0], action1);
      assert.deepStrictEqual(actions[1], action2);
      assert.deepStrictEqual(actions[2], action3);

      watcher.stop();
    });

    it('should repair file by merging multi-line JSON into single lines', async () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      // Write multi-line JSON
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1779000000, message: 'repair test' };
      const jsonStr = JSON.stringify(action);
      const part1 = jsonStr.slice(0, 30);
      const part2 = jsonStr.slice(30);

      fs.appendFileSync(filePath, part1 + '\n' + part2 + '\n');
      mockWatcher.emit('change');

      assert.strictEqual(actions.length, 1);

      // Wait for debounce (500ms) + buffer
      await new Promise(resolve => setTimeout(resolve, 700));

      // Read the file — should now be single-line JSONL
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      assert.strictEqual(lines.length, 1);
      // Verify it's valid JSON on a single line
      const repaired = JSON.parse(lines[0]);
      assert.deepStrictEqual(repaired, action);

      watcher.stop();
    });

    it('should set _repairSafeOffset at start and not repair content before it', async () => {
      // Pre-populate with some multi-line "history" that should NOT be repaired
      const history = '{"broken": true\n,"more": "stuff"}\n';
      fs.writeFileSync(filePath, history);

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      // _repairSafeOffset should be set to the history size
      assert.strictEqual(watcher._repairSafeOffset, Buffer.byteLength(history));

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      // Add new multi-line content
      const action = { action: 'to_arch', from: 'dev', to: 'arch', ts: 5, message: 'new' };
      const jsonStr = JSON.stringify(action);
      const part1 = jsonStr.slice(0, 20);
      const part2 = jsonStr.slice(20);

      fs.appendFileSync(filePath, part1 + '\n' + part2 + '\n');
      mockWatcher.emit('change');

      assert.strictEqual(actions.length, 1);

      // Wait for repair
      await new Promise(resolve => setTimeout(resolve, 700));

      // Verify: history portion is untouched
      const content = fs.readFileSync(filePath);
      const prefix = content.slice(0, watcher._repairSafeOffset).toString('utf-8');
      assert.strictEqual(prefix, history);

      watcher.stop();
    });

    it('should use _expectedSize anti-recursion to skip repair-triggered change events', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      // Write a valid action
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'test' };
      fs.appendFileSync(filePath, JSON.stringify(action) + '\n');
      mockWatcher.emit('change');

      assert.strictEqual(actions.length, 1);

      // Simulate what _repairFile does: set _expectedSize and write file
      const newContent = fs.readFileSync(filePath);
      watcher._expectedSize = newContent.length;

      // Trigger change event — should be skipped due to anti-recursion
      mockWatcher.emit('change');

      // Still only 1 action (no double processing)
      assert.strictEqual(actions.length, 1);
      // _expectedSize should be cleared after check
      assert.strictEqual(watcher._expectedSize, null);

      watcher.stop();
    });

    it('should debounce repair — only one repair after multiple rapid multi-line writes', async () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const repaired = [];
      watcher.on('repaired', (info) => repaired.push(info));

      // Write first multi-line JSON
      const action1 = { action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'a1' };
      const json1 = JSON.stringify(action1);
      fs.appendFileSync(filePath, json1.slice(0, 20) + '\n' + json1.slice(20) + '\n');
      mockWatcher.emit('change');

      // Immediately write another multi-line JSON (within debounce window)
      const action2 = { action: 'dev_do', from: 'arch', to: 'dev', ts: 2, message: 'a2' };
      const json2 = JSON.stringify(action2);
      fs.appendFileSync(filePath, json2.slice(0, 20) + '\n' + json2.slice(20) + '\n');
      mockWatcher.emit('change');

      // Wait for debounce (500ms) + buffer
      await new Promise(resolve => setTimeout(resolve, 700));

      // Should only have repaired once (debounced)
      assert.strictEqual(repaired.length, 1);

      // File should have both actions on single lines
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      assert.strictEqual(lines.length, 2);
      assert.deepStrictEqual(JSON.parse(lines[0]), action1);
      assert.deepStrictEqual(JSON.parse(lines[1]), action2);

      watcher.stop();
    });

    it('should not lose new valid single-line writes during repair debounce', async () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const actions = [];
      watcher.on('action', (a) => actions.push(a));

      // Write multi-line JSON (triggers repair schedule)
      const action1 = { action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'ml' };
      const json1 = JSON.stringify(action1);
      fs.appendFileSync(filePath, json1.slice(0, 20) + '\n' + json1.slice(20) + '\n');
      mockWatcher.emit('change');

      // Immediately write a valid single-line (during debounce window)
      const action2 = { action: 'dev_do', from: 'arch', to: 'dev', ts: 2, message: 'single' };
      fs.appendFileSync(filePath, JSON.stringify(action2) + '\n');
      mockWatcher.emit('change');

      // Both actions should have been emitted
      assert.strictEqual(actions.length, 2);
      assert.deepStrictEqual(actions[0], action1);
      assert.deepStrictEqual(actions[1], action2);

      // Wait for repair
      await new Promise(resolve => setTimeout(resolve, 700));

      // File should have both actions properly
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      assert.strictEqual(lines.length, 2);

      watcher.stop();
    });

    it('should cancel pending repair timer on stop()', async () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      // Write multi-line to trigger repair schedule
      const action = { action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'stop test' };
      const json = JSON.stringify(action);
      fs.appendFileSync(filePath, json.slice(0, 20) + '\n' + json.slice(20) + '\n');
      mockWatcher.emit('change');

      assert.ok(watcher._repairTimer !== null);

      // Stop before repair fires
      await watcher.stop();

      assert.strictEqual(watcher._repairTimer, null);

      // Wait past debounce to confirm repair doesn't fire
      const repaired = [];
      watcher.on('repaired', (info) => repaired.push(info));
      await new Promise(resolve => setTimeout(resolve, 700));
      assert.strictEqual(repaired.length, 0);
    });

    it('should emit repaired event with old and new file sizes', async () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      const repaired = [];
      watcher.on('repaired', (info) => repaired.push(info));

      // Write multi-line JSON
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'size test' };
      const json = JSON.stringify(action);
      fs.appendFileSync(filePath, json.slice(0, 20) + '\n' + json.slice(20) + '\n');
      const oldSize = fs.statSync(filePath).size;
      mockWatcher.emit('change');

      // Wait for repair
      await new Promise(resolve => setTimeout(resolve, 700));

      assert.strictEqual(repaired.length, 1);
      assert.strictEqual(repaired[0].oldSize, oldSize);
      // New size should be smaller (removed extra newline from multi-line split)
      assert.ok(repaired[0].newSize < repaired[0].oldSize);

      watcher.stop();
    });

    it('should handle file with trailing newline correctly after repair', async () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });
      watcher.start();

      // Write multi-line JSON
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'newline test' };
      const json = JSON.stringify(action);
      fs.appendFileSync(filePath, json.slice(0, 20) + '\n' + json.slice(20) + '\n');
      mockWatcher.emit('change');

      // Wait for repair
      await new Promise(resolve => setTimeout(resolve, 700));

      // File should end with newline
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.endsWith('\n'), 'Repaired file should end with newline');

      watcher.stop();
    });
  });

  describe('Feature #15: initialOffset + replay', () => {
    it('should start from initialOffset when provided and <= file size', () => {
      const existing = '{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"old"}\n';
      fs.writeFileSync(filePath, existing);

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const actions = [];
      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
        initialOffset: 0,
      });
      watcher.on('action', (a) => actions.push(a));
      watcher.start();

      assert.strictEqual(watcher.offset, existing.length);
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].message, 'old');

      watcher.stop();
    });

    it('should replay from mid-file when initialOffset is set to mid-point', () => {
      const line1 = '{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"first"}\n';
      const line2 = '{"action":"dev_do","from":"arch","to":"dev","ts":2,"message":"second"}\n';
      fs.writeFileSync(filePath, line1 + line2);

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const midOffset = Buffer.byteLength(line1);
      const actions = [];
      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
        initialOffset: midOffset,
      });
      watcher.on('action', (a) => actions.push(a));
      watcher.start();

      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].message, 'second');

      watcher.stop();
    });

    it('should reset to 0 when initialOffset > file size (truncation)', () => {
      const content = '{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"short"}\n';
      fs.writeFileSync(filePath, content);

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const actions = [];
      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
        initialOffset: 99999,
      });
      watcher.on('action', (a) => actions.push(a));
      watcher.start();

      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].message, 'short');

      watcher.stop();
    });

    it('should skip existing content when no initialOffset provided', () => {
      const existing = '{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"skip"}\n';
      fs.writeFileSync(filePath, existing);

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
      });

      const actions = [];
      watcher.on('action', (a) => actions.push(a));
      watcher.start();

      assert.strictEqual(actions.length, 0);

      watcher.stop();
    });

    it('should call onOffsetUpdate once per batch with processed offset', () => {
      fs.writeFileSync(filePath, '');

      const mockWatcher = new EventEmitter();
      mockWatcher.close = async () => {};

      const offsets = [];
      const watcher = new ActionWatcher(filePath, {
        watcherFactory: () => mockWatcher,
        onOffsetUpdate: (offset) => offsets.push(offset),
      });
      watcher.start();

      const line1 = '{"action":"to_arch","from":"dev","to":"arch","ts":1,"message":"a"}\n';
      const line2 = '{"action":"dev_do","from":"arch","to":"dev","ts":2,"message":"b"}\n';
      fs.appendFileSync(filePath, line1 + line2);
      mockWatcher.emit('change');

      assert.strictEqual(offsets.length, 1);
      const expectedOffset = Buffer.byteLength(line1 + line2);
      assert.strictEqual(offsets[0], expectedOffset);

      watcher.stop();
    });
  });
});
