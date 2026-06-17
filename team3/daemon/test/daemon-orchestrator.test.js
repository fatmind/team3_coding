'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const DaemonOrchestrator = require('../src/daemon-orchestrator');

/**
 * Unit tests for DaemonOrchestrator (Feature #5)
 *
 * All subsystems (Daemon, ActionWatcher, AgentScheduler, MessageRouter)
 * are mocked to test wiring logic only.
 */

// Mock Daemon
function createMockDaemon() {
  const daemon = new EventEmitter();
  daemon.broadcasts = [];
  daemon.broadcast = (data) => daemon.broadcasts.push(data);
  daemon.start = async () => {};
  daemon.stop = async () => {};
  daemon.clients = new Set();
  daemon.isRunning = false;
  return daemon;
}

// Mock ActionWatcher
function createMockActionWatcher() {
  const watcher = new EventEmitter();
  watcher.start = () => {};
  watcher.stop = async () => {};
  watcher.isWatching = false;
  watcher.filePath = '/tmp/test-actions.jsonl';
  watcher.offset = 0;
  Object.defineProperty(watcher, 'currentOffset', { get() { return this.offset; } });
  return watcher;
}

// Mock AgentScheduler
function createMockAgentScheduler() {
  const scheduler = new EventEmitter();
  scheduler.dispatched = [];
  scheduler.dispatch = (action) => {
    scheduler.dispatched.push(action);
    const targets = { dev_do: 'dev', dev_fix: 'dev', uat_check: 'uat', uat_fix: 'uat', to_arch: 'arch' };
    const target = targets[action.action] || null;
    if (target) {
      scheduler.emit('enqueued', { role: target, action, queueSize: 1 });
    } else {
      scheduler.emit('skip', { action, reason: 'no valid target agent' });
    }
  };
  scheduler.clearAllTimers = () => {};
  scheduler.killAllProcesses = () => [];
  return scheduler;
}

// Mock StatePersistence
function createMockStatePersistence() {
  return {
    _state: { lastProcessingOffset: 0, lastUpdated: null },
    load() { return this._state; },
    get state() { return this._state; },
    get lastProcessingOffset() { return this._state.lastProcessingOffset; },
    updateOffset(offset) { this._state.lastProcessingOffset = offset; },
    saveSync() { this._saved = true; },
    destroy() { this._destroyed = true; },
  };
}

describe('DaemonOrchestrator', () => {
  let daemon;
  let watcher;
  let scheduler;
  let statePersistence;
  let orchestrator;

  // Use nonexistent path so arch session binding has no in-progress module in unit tests
  const NO_MODULES_PROGRESS = '/tmp/nonexistent-modules-progress.json';

  beforeEach(() => {
    daemon = createMockDaemon();
    watcher = createMockActionWatcher();
    scheduler = createMockAgentScheduler();
    statePersistence = createMockStatePersistence();
  });

  afterEach(async () => {
    if (orchestrator && orchestrator.isRunning) {
      await orchestrator.stop();
    }
  });

  describe('constructor', () => {
    it('should create orchestrator with injected dependencies', () => {
      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      assert.equal(orchestrator.isRunning, false);
      assert.ok(orchestrator.daemon);
      assert.ok(orchestrator.actionWatcher);
      assert.ok(orchestrator.agentScheduler);
      assert.ok(orchestrator.messageRouter);
    });
  });

  describe('start/stop lifecycle', () => {
    beforeEach(() => {
      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
    });

    it('should emit "started" on start', async () => {
      let started = false;
      orchestrator.on('started', () => { started = true; });
      await orchestrator.start();
      assert.equal(started, true);
      assert.equal(orchestrator.isRunning, true);
    });

    it('should emit "stopped" on stop', async () => {
      await orchestrator.start();
      let stopped = false;
      orchestrator.on('stopped', () => { stopped = true; });
      await orchestrator.stop();
      assert.equal(stopped, true);
      assert.equal(orchestrator.isRunning, false);
    });

    it('should be idempotent on start', async () => {
      let count = 0;
      orchestrator.on('started', () => { count++; });
      await orchestrator.start();
      await orchestrator.start();
      assert.equal(count, 1);
    });

    it('should be idempotent on stop', async () => {
      let count = 0;
      orchestrator.on('stopped', () => { count++; });
      await orchestrator.stop(); // never started
      assert.equal(count, 0);
    });
  });

  describe('wiring: ActionWatcher → AgentScheduler', () => {
    beforeEach(async () => {
      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      await orchestrator.start();
    });

    it('should dispatch to_arch action to AgentScheduler when ActionWatcher emits', () => {
      const action = { action: 'to_arch', from: 'human', to: 'arch', ts: 1234, message: 'hello arch' };
      const rawLine = JSON.stringify(action);

      watcher.emit('action', action, rawLine);

      assert.equal(scheduler.dispatched.length, 1);
      assert.deepStrictEqual(scheduler.dispatched[0], action);
    });

    it('should dispatch dev_do action to AgentScheduler', () => {
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1234, message: 'do feature' };
      watcher.emit('action', action, JSON.stringify(action));

      assert.equal(scheduler.dispatched.length, 1);
      assert.deepStrictEqual(scheduler.dispatched[0], action);
    });

    it('should dispatch to_human action to AgentScheduler (scheduler will skip it)', () => {
      const action = { action: 'to_human', from: 'arch', to: 'human', ts: 1234, message: 'hi human' };
      watcher.emit('action', action, JSON.stringify(action));

      // AgentScheduler still receives dispatch, but will skip (to=human, no agent target)
      assert.equal(scheduler.dispatched.length, 1);
    });

    it('should NOT dispatch after stop', async () => {
      await orchestrator.stop();

      const action = { action: 'to_arch', from: 'human', to: 'arch', ts: 1234, message: 'late msg' };
      watcher.emit('action', action, JSON.stringify(action));

      assert.equal(scheduler.dispatched.length, 0);
    });
  });

  describe('wiring: ActionWatcher → MessageRouter (ws push)', () => {
    beforeEach(async () => {
      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      await orchestrator.start();
    });

    it('should broadcast agent messages via daemon', () => {
      const action = { action: 'to_human', from: 'arch', to: 'human', ts: 1234, message: 'hello' };
      const rawLine = JSON.stringify(action);

      watcher.emit('action', action, rawLine);

      // MessageRouter should have broadcast via daemon
      assert.equal(daemon.broadcasts.length, 1);
      const event = JSON.parse(daemon.broadcasts[0]);
      assert.equal(event.type, 'agent.msg');
      assert.equal(event.payload, rawLine);
    });

    it('should NOT broadcast human messages', () => {
      const action = { action: 'to_arch', from: 'human', to: 'arch', ts: 1234, message: 'hey' };
      watcher.emit('action', action, JSON.stringify(action));

      assert.equal(daemon.broadcasts.length, 0);
    });
  });

  describe('dual handling: same action triggers both scheduler and router', () => {
    beforeEach(async () => {
      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      await orchestrator.start();
    });

    it('agent action should trigger both scheduler dispatch AND ws broadcast', () => {
      // arch sends dev_do — should be dispatched to scheduler AND broadcast to ws
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1234, message: 'implement X' };
      const rawLine = JSON.stringify(action);

      watcher.emit('action', action, rawLine);

      // Scheduler received dispatch
      assert.equal(scheduler.dispatched.length, 1);
      assert.deepStrictEqual(scheduler.dispatched[0], action);

      // MessageRouter broadcast (from=arch, so it's an agent msg)
      assert.equal(daemon.broadcasts.length, 1);
      const event = JSON.parse(daemon.broadcasts[0]);
      assert.equal(event.type, 'agent.msg');
    });

    it('human action should trigger scheduler dispatch but NOT ws broadcast', () => {
      const action = { action: 'to_arch', from: 'human', to: 'arch', ts: 1234, message: 'please do X' };
      watcher.emit('action', action, JSON.stringify(action));

      // Scheduler received dispatch (will route to arch)
      assert.equal(scheduler.dispatched.length, 1);

      // No ws broadcast (from=human)
      assert.equal(daemon.broadcasts.length, 0);
    });

    it('should handle mixed sequence correctly', () => {
      const actions = [
        { action: 'to_arch', from: 'human', to: 'arch', ts: 1, message: 'q1' },     // dispatch only
        { action: 'to_human', from: 'arch', to: 'human', ts: 2, message: 'a1' },     // dispatch + broadcast
        { action: 'dev_do', from: 'arch', to: 'dev', ts: 3, message: 'do it' },       // dispatch + broadcast
        { action: 'to_arch', from: 'dev', to: 'arch', ts: 4, message: 'done' },       // dispatch + broadcast
      ];

      for (const action of actions) {
        watcher.emit('action', action, JSON.stringify(action));
      }

      // All 4 dispatched to scheduler
      assert.equal(scheduler.dispatched.length, 4);

      // Only 3 broadcast (from human excluded)
      assert.equal(daemon.broadcasts.length, 3);
      const froms = daemon.broadcasts.map(b => JSON.parse(JSON.parse(b).payload).from);
      assert.deepStrictEqual(froms, ['arch', 'arch', 'dev']);
    });
  });

  describe('event forwarding', () => {
    beforeEach(async () => {
      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      await orchestrator.start();
    });

    it('should forward AgentScheduler "enqueued" event', () => {
      const events = [];
      orchestrator.on('enqueued', (data) => events.push(data));

      const action = { action: 'to_arch', from: 'human', to: 'arch', ts: 1, message: 'hi' };
      watcher.emit('action', action, JSON.stringify(action));

      assert.equal(events.length, 1);
      assert.equal(events[0].role, 'arch');
    });

    it('should forward MessageRouter "routed" event', () => {
      const events = [];
      orchestrator.on('routed', (data) => events.push(data));

      const action = { action: 'to_human', from: 'arch', to: 'human', ts: 1, message: 'done' };
      watcher.emit('action', action, JSON.stringify(action));

      assert.equal(events.length, 1);
      assert.equal(events[0].action.from, 'arch');
    });
  });

  describe('Feature #15: state persistence integration', () => {
    it('should call statePersistence.saveSync and destroy on stop', async () => {
      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      await orchestrator.start();

      watcher.offset = 500;
      await orchestrator.stop();

      assert.strictEqual(statePersistence._saved, true);
      assert.strictEqual(statePersistence._destroyed, true);
      assert.strictEqual(statePersistence._state.lastProcessingOffset, 500);
    });

    it('should load persisted state during construction', () => {
      statePersistence._state.lastProcessingOffset = 12345;
      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      assert.strictEqual(statePersistence.lastProcessingOffset, 12345);
    });
  });

  describe('Feature #16: graceful shutdown', () => {
    it('should call killAllProcesses and clearAllTimers on stop', async () => {
      let killCalled = false;
      let clearCalled = false;
      scheduler.killAllProcesses = () => { killCalled = true; return []; };
      scheduler.clearAllTimers = () => { clearCalled = true; };

      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      await orchestrator.start();
      await orchestrator.stop();

      assert.strictEqual(killCalled, true);
      assert.strictEqual(clearCalled, true);
    });

    it('should emit shutdown-kill when processes are killed on stop', async () => {
      scheduler.killAllProcesses = () => [{ role: 'arch', pid: 99999 }];

      orchestrator = new DaemonOrchestrator({
        daemon,
        actionWatcher: watcher,
        agentScheduler: scheduler,
        statePersistence,
        modulesProgressPath: NO_MODULES_PROGRESS,
      });
      await orchestrator.start();

      const events = [];
      orchestrator.on('shutdown-kill', (d) => events.push(d));
      await orchestrator.stop();

      assert.strictEqual(events.length, 1);
      assert.deepStrictEqual(events[0].killed, [{ role: 'arch', pid: 99999 }]);
    });

  });
});
