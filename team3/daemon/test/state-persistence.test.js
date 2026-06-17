'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const StatePersistence = require('../src/state-persistence');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('StatePersistence', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-state-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load()', () => {
    it('should return defaults when file does not exist', () => {
      const sp = new StatePersistence(path.join(tmpDir, 'nonexistent.json'));
      const state = sp.load();
      assert.strictEqual(state.lastProcessingOffset, 0);
      assert.strictEqual(state.lastUpdated, null);
      sp.destroy();
    });

    it('should load persisted state from file', () => {
      const filePath = path.join(tmpDir, 'existing.json');
      fs.writeFileSync(filePath, JSON.stringify({
        lastProcessingOffset: 12345,
        lastUpdated: '2026-05-27T10:00:00Z',
      }));
      const sp = new StatePersistence(filePath);
      const state = sp.load();
      assert.strictEqual(state.lastProcessingOffset, 12345);
      assert.strictEqual(state.lastUpdated, '2026-05-27T10:00:00Z');
      sp.destroy();
    });

    it('should return defaults for corrupted file', () => {
      const filePath = path.join(tmpDir, 'corrupted.json');
      fs.writeFileSync(filePath, '{invalid json!!!');
      const sp = new StatePersistence(filePath);
      const state = sp.load();
      assert.strictEqual(state.lastProcessingOffset, 0);
      sp.destroy();
    });
  });

  describe('updateOffset()', () => {
    it('should update offset in state', () => {
      const sp = new StatePersistence(path.join(tmpDir, 'offset.json'));
      sp.load();
      sp.updateOffset(5000);
      assert.strictEqual(sp.lastProcessingOffset, 5000);
      sp.destroy();
    });

    it('should debounce writes to file', async () => {
      const filePath = path.join(tmpDir, 'debounce.json');
      const sp = new StatePersistence(filePath, { debounceMs: 50 });
      sp.load();

      sp.updateOffset(100);
      sp.updateOffset(200);
      sp.updateOffset(300);

      // File should not exist yet (debounce hasn't fired)
      assert.strictEqual(fs.existsSync(filePath), false);

      await sleep(100);

      // Now file should exist with the last value
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert.strictEqual(saved.lastProcessingOffset, 300);
      sp.destroy();
    });
  });

  describe('saveSync()', () => {
    it('should write state to file immediately', () => {
      const filePath = path.join(tmpDir, 'sync.json');
      const sp = new StatePersistence(filePath, { debounceMs: 99999 });
      sp.load();
      sp.updateOffset(42);
      // Debounce is very long, so file shouldn't exist yet
      assert.strictEqual(fs.existsSync(filePath), false);
      sp.saveSync();
      // Now file should exist
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert.strictEqual(saved.lastProcessingOffset, 42);
      assert.ok(saved.lastUpdated);
      sp.destroy();
    });

    it('should cancel pending debounced write', () => {
      const filePath = path.join(tmpDir, 'cancel.json');
      const sp = new StatePersistence(filePath, { debounceMs: 50 });
      sp.load();
      sp.updateOffset(100);
      sp.saveSync();
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert.strictEqual(saved.lastProcessingOffset, 100);
      sp.destroy();
    });
  });

  describe('destroy()', () => {
    it('should cancel pending timer', async () => {
      const filePath = path.join(tmpDir, 'destroy.json');
      const sp = new StatePersistence(filePath, { debounceMs: 50 });
      sp.load();
      sp.updateOffset(999);
      sp.destroy();
      await sleep(100);
      // File should NOT have been written
      assert.strictEqual(fs.existsSync(filePath), false);
    });
  });
});
