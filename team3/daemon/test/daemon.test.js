'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Daemon = require('../src/daemon');

describe('Daemon', () => {
  let tmpDir;
  let tmpFile;
  let daemon;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team3-daemon-test-'));
    tmpFile = path.join(tmpDir, '.team3-project.json');
    // Write initial project json
    fs.writeFileSync(tmpFile, JSON.stringify({ name: 'test-project' }));
  });

  afterEach(async () => {
    if (daemon && daemon.isRunning) {
      await daemon.stop();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should use default config values', () => {
      daemon = new Daemon({ projectJsonPath: tmpFile });
      assert.strictEqual(daemon.port, 3100);
      assert.strictEqual(daemon.projectJsonPath, tmpFile);
    });

    it('should accept custom port', () => {
      daemon = new Daemon({ port: 4000, projectJsonPath: tmpFile });
      assert.strictEqual(daemon.port, 4000);
    });
  });

  describe('start()', () => {
    it('should start WebSocket server and write PID', async () => {
      daemon = new Daemon({
        port: 0, // random available port
        projectJsonPath: tmpFile,
        heartbeatInterval: 60000, // slow for testing
        wsPingInterval: 60000,
      });

      // Use port 0 trick - need to pick a real port
      const port = 13100 + Math.floor(Math.random() * 1000);
      daemon.port = port;

      await daemon.start();

      assert.strictEqual(daemon.isRunning, true);

      // Check PID was written
      const data = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      assert.strictEqual(data.init_daemon, process.pid);
    });

    it('should reject on port conflict', async () => {
      const port = 13100 + Math.floor(Math.random() * 1000);
      daemon = new Daemon({
        port,
        projectJsonPath: tmpFile,
        heartbeatInterval: 60000,
        wsPingInterval: 60000,
      });

      await daemon.start();

      // Try to start another on same port
      const daemon2 = new Daemon({
        port,
        projectJsonPath: tmpFile,
        heartbeatInterval: 60000,
        wsPingInterval: 60000,
      });

      await assert.rejects(() => daemon2.start(), (err) => {
        return err.code === 'EADDRINUSE';
      });
    });
  });

  describe('stop()', () => {
    it('should stop cleanly', async () => {
      const port = 13100 + Math.floor(Math.random() * 1000);
      daemon = new Daemon({
        port,
        projectJsonPath: tmpFile,
        heartbeatInterval: 60000,
        wsPingInterval: 60000,
      });

      await daemon.start();
      assert.strictEqual(daemon.isRunning, true);

      await daemon.stop();
      assert.strictEqual(daemon.isRunning, false);
    });
  });

  describe('broadcast()', () => {
    it('should not throw with no clients', async () => {
      const port = 13100 + Math.floor(Math.random() * 1000);
      daemon = new Daemon({
        port,
        projectJsonPath: tmpFile,
        heartbeatInterval: 60000,
        wsPingInterval: 60000,
      });

      await daemon.start();
      // Should not throw
      daemon.broadcast({ type: 'test', message: 'hello' });
    });
  });

  describe('clientCount', () => {
    it('should start at 0', async () => {
      const port = 13100 + Math.floor(Math.random() * 1000);
      daemon = new Daemon({
        port,
        projectJsonPath: tmpFile,
        heartbeatInterval: 60000,
        wsPingInterval: 60000,
      });

      await daemon.start();
      assert.strictEqual(daemon.clientCount, 0);
    });
  });
});
