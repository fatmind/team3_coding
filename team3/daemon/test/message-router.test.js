'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const MessageRouter = require('../src/message-router');

/**
 * Unit tests for MessageRouter (Feature #4)
 *
 * All dependencies (ActionWatcher, Daemon) are mocked.
 * Tests verify:
 * - Agent messages (from=arch/dev/uat) are routed via broadcast
 * - Human messages (from=human) are NOT routed
 * - WS event format is correct: { type: "agent.msg", payload: "<raw line>" }
 * - Lifecycle (start/stop) works correctly
 * - Constructor validation
 */

// Mock ActionWatcher (EventEmitter)
function createMockActionWatcher() {
  return new EventEmitter();
}

// Mock Daemon with broadcast tracking
function createMockDaemon() {
  const daemon = {
    broadcasts: [],
    broadcast(data) {
      daemon.broadcasts.push(data);
    },
  };
  return daemon;
}

describe('MessageRouter', () => {
  let watcher;
  let daemon;
  let router;

  beforeEach(() => {
    watcher = createMockActionWatcher();
    daemon = createMockDaemon();
    router = new MessageRouter({ actionWatcher: watcher, daemon });
  });

  afterEach(() => {
    if (router && router.isRunning) {
      router.stop();
    }
  });

  describe('constructor validation', () => {
    it('should throw if actionWatcher is not provided', () => {
      assert.throws(
        () => new MessageRouter({ daemon: createMockDaemon() }),
        { message: /actionWatcher/ }
      );
    });

    it('should throw if daemon is not provided', () => {
      assert.throws(
        () => new MessageRouter({ actionWatcher: createMockActionWatcher() }),
        { message: /daemon/ }
      );
    });

    it('should create successfully with both dependencies', () => {
      const r = new MessageRouter({
        actionWatcher: createMockActionWatcher(),
        daemon: createMockDaemon(),
      });
      assert.equal(r.isRunning, false);
    });
  });

  describe('start/stop lifecycle', () => {
    it('should emit "started" on start', () => {
      let started = false;
      router.on('started', () => { started = true; });
      router.start();
      assert.equal(started, true);
      assert.equal(router.isRunning, true);
    });

    it('should emit "stopped" on stop', () => {
      router.start();
      let stopped = false;
      router.on('stopped', () => { stopped = true; });
      router.stop();
      assert.equal(stopped, true);
      assert.equal(router.isRunning, false);
    });

    it('should be idempotent on start', () => {
      let count = 0;
      router.on('started', () => { count++; });
      router.start();
      router.start(); // second call should be no-op
      assert.equal(count, 1);
    });

    it('should be idempotent on stop', () => {
      let count = 0;
      router.on('stopped', () => { count++; });
      router.stop(); // never started
      assert.equal(count, 0);
    });

    it('should not route messages after stop', () => {
      router.start();
      router.stop();

      const rawLine = '{"action":"to_human","from":"arch","to":"human","ts":1234,"message":"hello"}';
      const action = JSON.parse(rawLine);
      watcher.emit('action', action, rawLine);

      assert.equal(daemon.broadcasts.length, 0);
    });
  });

  describe('agent message routing', () => {
    beforeEach(() => {
      router.start();
    });

    it('should broadcast agent.msg when from=arch', () => {
      const rawLine = '{"action":"to_human","from":"arch","to":"human","ts":1234,"message":"hello from arch"}';
      const action = JSON.parse(rawLine);

      watcher.emit('action', action, rawLine);

      assert.equal(daemon.broadcasts.length, 1);
      const event = JSON.parse(daemon.broadcasts[0]);
      assert.equal(event.type, 'agent.msg');
      assert.equal(event.payload, rawLine);
    });

    it('should broadcast agent.msg when from=dev', () => {
      const rawLine = '{"action":"to_arch","from":"dev","to":"arch","ts":1234,"message":"feature done"}';
      const action = JSON.parse(rawLine);

      watcher.emit('action', action, rawLine);

      assert.equal(daemon.broadcasts.length, 1);
      const event = JSON.parse(daemon.broadcasts[0]);
      assert.equal(event.type, 'agent.msg');
      assert.equal(event.payload, rawLine);
    });

    it('should broadcast agent.msg when from=uat', () => {
      const rawLine = '{"action":"to_arch","from":"uat","to":"arch","ts":1234,"message":"uat report"}';
      const action = JSON.parse(rawLine);

      watcher.emit('action', action, rawLine);

      assert.equal(daemon.broadcasts.length, 1);
      const event = JSON.parse(daemon.broadcasts[0]);
      assert.equal(event.type, 'agent.msg');
      assert.equal(event.payload, rawLine);
    });

    it('should emit "routed" event with action and rawLine', () => {
      const rawLine = '{"action":"to_human","from":"arch","to":"human","ts":1234,"message":"hi"}';
      const action = JSON.parse(rawLine);

      let routedEvent = null;
      router.on('routed', (data) => { routedEvent = data; });

      watcher.emit('action', action, rawLine);

      assert.ok(routedEvent);
      assert.deepStrictEqual(routedEvent.action, action);
      assert.equal(routedEvent.rawLine, rawLine);
    });
  });

  describe('human message filtering', () => {
    beforeEach(() => {
      router.start();
    });

    it('should NOT broadcast when from=human', () => {
      const rawLine = '{"action":"to_arch","from":"human","to":"arch","ts":1234,"message":"please do X"}';
      const action = JSON.parse(rawLine);

      watcher.emit('action', action, rawLine);

      assert.equal(daemon.broadcasts.length, 0);
    });

    it('should emit "skipped" event when from=human', () => {
      const rawLine = '{"action":"to_arch","from":"human","to":"arch","ts":1234,"message":"hey"}';
      const action = JSON.parse(rawLine);

      let skippedEvent = null;
      router.on('skipped', (data) => { skippedEvent = data; });

      watcher.emit('action', action, rawLine);

      assert.ok(skippedEvent);
      assert.equal(skippedEvent.reason, 'from is not an agent role');
    });

    it('should NOT broadcast when from is unknown role', () => {
      const rawLine = '{"action":"note","from":"system","to":"","ts":1234,"message":"note"}';
      const action = JSON.parse(rawLine);

      watcher.emit('action', action, rawLine);

      assert.equal(daemon.broadcasts.length, 0);
    });
  });

  describe('ws event payload format', () => {
    beforeEach(() => {
      router.start();
    });

    it('should produce valid JSON with type and payload fields', () => {
      const rawLine = '{"action":"dev_do","from":"arch","to":"dev","ts":1234,"message":"implement X"}';
      const action = JSON.parse(rawLine);

      watcher.emit('action', action, rawLine);

      const wsData = daemon.broadcasts[0];
      assert.equal(typeof wsData, 'string');

      const parsed = JSON.parse(wsData);
      assert.ok(parsed.hasOwnProperty('type'));
      assert.ok(parsed.hasOwnProperty('payload'));
      assert.equal(parsed.type, 'agent.msg');
      assert.equal(typeof parsed.payload, 'string');
    });

    it('should preserve the exact raw line in payload (not re-serialized)', () => {
      // Raw line with specific formatting/spacing
      const rawLine = '{"action":"to_human","from":"dev","to":"human","ts":9999,"message":"done with   spaces"}';
      const action = JSON.parse(rawLine);

      watcher.emit('action', action, rawLine);

      const event = JSON.parse(daemon.broadcasts[0]);
      assert.equal(event.payload, rawLine);
    });

    it('should handle multiple messages sequentially', () => {
      const lines = [
        '{"action":"to_human","from":"arch","to":"human","ts":1001,"message":"msg1"}',
        '{"action":"to_arch","from":"dev","to":"arch","ts":1002,"message":"msg2"}',
        '{"action":"to_human","from":"uat","to":"human","ts":1003,"message":"msg3"}',
      ];

      for (const line of lines) {
        watcher.emit('action', JSON.parse(line), line);
      }

      assert.equal(daemon.broadcasts.length, 3);

      for (let i = 0; i < 3; i++) {
        const event = JSON.parse(daemon.broadcasts[i]);
        assert.equal(event.type, 'agent.msg');
        assert.equal(event.payload, lines[i]);
      }
    });

    it('should only broadcast agent messages, not human, in mixed sequence', () => {
      const lines = [
        { raw: '{"action":"to_human","from":"arch","to":"human","ts":1,"message":"a"}', shouldRoute: true },
        { raw: '{"action":"to_arch","from":"human","to":"arch","ts":2,"message":"b"}', shouldRoute: false },
        { raw: '{"action":"to_arch","from":"dev","to":"arch","ts":3,"message":"c"}', shouldRoute: true },
        { raw: '{"action":"to_human","from":"human","to":"dev","ts":4,"message":"d"}', shouldRoute: false },
        { raw: '{"action":"to_human","from":"uat","to":"human","ts":5,"message":"e"}', shouldRoute: true },
      ];

      for (const { raw } of lines) {
        watcher.emit('action', JSON.parse(raw), raw);
      }

      assert.equal(daemon.broadcasts.length, 3);
      const expected = lines.filter(l => l.shouldRoute).map(l => l.raw);
      for (let i = 0; i < 3; i++) {
        const event = JSON.parse(daemon.broadcasts[i]);
        assert.equal(event.payload, expected[i]);
      }
    });
  });
});
