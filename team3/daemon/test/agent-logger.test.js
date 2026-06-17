'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AgentLogger = require('../src/agent-logger');

describe('AgentLogger', () => {
  let tmpDir;
  let logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-logger-test-'));
  });

  afterEach(async () => {
    if (logger) logger.closeAll();
    // Wait for streams to fully close before removing tmpDir
    await new Promise(r => setTimeout(r, 30));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('uses default logDir when not specified', () => {
      logger = new AgentLogger();
      assert.ok(logger.logDir.includes('logs'));
    });

    it('accepts custom logDir', () => {
      logger = new AgentLogger({ logDir: tmpDir });
      assert.equal(logger.logDir, tmpDir);
    });

    it('accepts custom dateProvider', () => {
      const dp = () => '2026-01-15';
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: dp });
      assert.equal(logger._getCurrentDate(), '2026-01-15');
    });
  });

  describe('getLogPath', () => {
    it('returns correct path format', () => {
      logger = new AgentLogger({ logDir: tmpDir });
      const p = logger.getLogPath('arch', '2026-05-25');
      assert.equal(p, path.join(tmpDir, 'arch_2026-05-25.log'));
    });

    it('handles different roles', () => {
      logger = new AgentLogger({ logDir: tmpDir });
      assert.equal(
        path.basename(logger.getLogPath('dev', '2026-01-01')),
        'dev_2026-01-01.log'
      );
      assert.equal(
        path.basename(logger.getLogPath('uat', '2026-12-31')),
        'uat_2026-12-31.log'
      );
    });
  });

  describe('getStream', () => {
    it('creates a writable stream for the role', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      const stream = logger.getStream('arch');
      assert.ok(stream);
      assert.ok(stream.writable);
    });

    it('creates log directory if it does not exist', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'logs');
      logger = new AgentLogger({ logDir: nestedDir, dateProvider: () => '2026-05-25' });
      logger.getStream('arch');
      assert.ok(fs.existsSync(nestedDir));
    });

    it('reuses same stream for same role and date', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      const s1 = logger.getStream('arch');
      const s2 = logger.getStream('arch');
      assert.strictEqual(s1, s2);
    });

    it('returns different streams for different roles', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      const sArch = logger.getStream('arch');
      const sDev = logger.getStream('dev');
      assert.notStrictEqual(sArch, sDev);
    });

    it('rolls over to new stream on date change', () => {
      let currentDate = '2026-05-25';
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => currentDate });

      const s1 = logger.getStream('arch');
      currentDate = '2026-05-26';
      const s2 = logger.getStream('arch');

      assert.notStrictEqual(s1, s2);
      // Old stream should be ended
      assert.ok(s1.destroyed || s1.writableEnded);
    });
  });

  describe('write', () => {
    it('writes data to the correct log file', async () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      logger.write('arch', '{"type":"system","subtype":"init"}\n');
      logger.write('arch', '{"type":"result","subtype":"success"}\n');

      // Close to flush
      logger.close('arch');

      // Wait for fs flush
      await new Promise(r => setTimeout(r, 50));

      const logPath = path.join(tmpDir, 'arch_2026-05-25.log');
      assert.ok(fs.existsSync(logPath));
      const content = fs.readFileSync(logPath, 'utf-8');
      assert.ok(content.includes('{"type":"system","subtype":"init"}'));
      assert.ok(content.includes('{"type":"result","subtype":"success"}'));
    });

    it('writes to different files for different roles', async () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      logger.write('arch', 'arch-data\n');
      logger.write('dev', 'dev-data\n');
      logger.write('uat', 'uat-data\n');
      logger.closeAll();

      await new Promise(r => setTimeout(r, 50));

      assert.ok(fs.existsSync(path.join(tmpDir, 'arch_2026-05-25.log')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'dev_2026-05-25.log')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'uat_2026-05-25.log')));

      const archContent = fs.readFileSync(path.join(tmpDir, 'arch_2026-05-25.log'), 'utf-8');
      const devContent = fs.readFileSync(path.join(tmpDir, 'dev_2026-05-25.log'), 'utf-8');
      assert.ok(archContent.includes('arch-data'));
      assert.ok(!archContent.includes('dev-data'));
      assert.ok(devContent.includes('dev-data'));
    });

    it('rolls log file when date changes', async () => {
      let currentDate = '2026-05-25';
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => currentDate });

      logger.write('arch', 'day1-data\n');
      currentDate = '2026-05-26';
      logger.write('arch', 'day2-data\n');
      logger.closeAll();

      await new Promise(r => setTimeout(r, 50));

      const day1Log = path.join(tmpDir, 'arch_2026-05-25.log');
      const day2Log = path.join(tmpDir, 'arch_2026-05-26.log');

      assert.ok(fs.existsSync(day1Log));
      assert.ok(fs.existsSync(day2Log));

      const day1Content = fs.readFileSync(day1Log, 'utf-8');
      const day2Content = fs.readFileSync(day2Log, 'utf-8');
      assert.ok(day1Content.includes('day1-data'));
      assert.ok(day2Content.includes('day2-data'));
    });
  });

  describe('close', () => {
    it('closes the stream for a role', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      logger.getStream('arch');
      assert.ok(logger.hasStream('arch'));
      logger.close('arch');
      assert.ok(!logger.hasStream('arch'));
    });

    it('is safe to call multiple times', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      logger.getStream('arch');
      logger.close('arch');
      logger.close('arch'); // Should not throw
    });

    it('is safe to call for role that never opened', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      logger.close('dev'); // Should not throw
    });
  });

  describe('closeAll', () => {
    it('closes all open streams', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      logger.getStream('arch');
      logger.getStream('dev');
      logger.getStream('uat');
      assert.ok(logger.hasStream('arch'));
      assert.ok(logger.hasStream('dev'));
      assert.ok(logger.hasStream('uat'));

      logger.closeAll();
      assert.ok(!logger.hasStream('arch'));
      assert.ok(!logger.hasStream('dev'));
      assert.ok(!logger.hasStream('uat'));
    });
  });

  describe('hasStream', () => {
    it('returns false for unopened role', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      assert.equal(logger.hasStream('arch'), false);
    });

    it('returns true after getStream', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      logger.getStream('arch');
      assert.equal(logger.hasStream('arch'), true);
    });
  });

  describe('getInfo', () => {
    it('returns empty object when no streams open', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      assert.deepEqual(logger.getInfo(), {});
    });

    it('returns info about open streams', () => {
      logger = new AgentLogger({ logDir: tmpDir, dateProvider: () => '2026-05-25' });
      logger.getStream('arch');
      logger.getStream('dev');
      const info = logger.getInfo();
      assert.equal(info.arch.date, '2026-05-25');
      assert.ok(info.arch.path.endsWith('arch_2026-05-25.log'));
      assert.equal(info.dev.date, '2026-05-25');
      assert.ok(!info.uat); // not opened
    });
  });
});
