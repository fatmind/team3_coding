'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { AgentQueue, mergeMessages } = require('../src/agent-queue');

describe('AgentQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new AgentQueue('dev');
  });

  describe('constructor', () => {
    it('should initialize with role and empty state', () => {
      assert.strictEqual(queue.role, 'dev');
      assert.strictEqual(queue.pendingCount, 0);
      assert.strictEqual(queue.isBusy(), false);
      assert.strictEqual(queue.hasPending(), false);
    });
  });

  describe('enqueue', () => {
    it('should add messages to the queue', () => {
      const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'hello' };
      queue.enqueue(action);
      assert.strictEqual(queue.pendingCount, 1);
      assert.strictEqual(queue.hasPending(), true);
    });

    it('should preserve FIFO order', () => {
      queue.enqueue({ action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'first' });
      queue.enqueue({ action: 'dev_fix', from: 'arch', to: 'dev', ts: 2, message: 'second' });
      queue.enqueue({ action: 'dev_do', from: 'arch', to: 'dev', ts: 3, message: 'third' });

      const drained = queue.drain();
      assert.strictEqual(drained[0].message, 'first');
      assert.strictEqual(drained[1].message, 'second');
      assert.strictEqual(drained[2].message, 'third');
    });

    it('should enqueue priority messages before normal pending work', () => {
      queue.enqueue({ action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'normal 1' });
      queue.enqueuePriority(
        { action: 'to_dev', from: 'human', to: 'dev', ts: 2, message: 'human 1' },
        item => item.from === 'human'
      );
      queue.enqueuePriority(
        { action: 'to_dev', from: 'human', to: 'dev', ts: 3, message: 'human 2' },
        item => item.from === 'human'
      );

      const drained = queue.drain();
      assert.strictEqual(drained[0].message, 'human 1');
      assert.strictEqual(drained[1].message, 'human 2');
      assert.strictEqual(drained[2].message, 'normal 1');
    });
  });

  describe('drain', () => {
    it('should return all messages and clear queue', () => {
      queue.enqueue({ action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'a' });
      queue.enqueue({ action: 'dev_do', from: 'arch', to: 'dev', ts: 2, message: 'b' });

      const drained = queue.drain();
      assert.strictEqual(drained.length, 2);
      assert.strictEqual(queue.pendingCount, 0);
      assert.strictEqual(queue.hasPending(), false);
    });

    it('should return empty array when no messages', () => {
      const drained = queue.drain();
      assert.deepStrictEqual(drained, []);
    });

    it('should drain leading messages while predicate matches', () => {
      queue.enqueue({ action: 'to_dev', from: 'human', to: 'dev', ts: 1, message: 'human 1' });
      queue.enqueue({ action: 'to_dev', from: 'human', to: 'dev', ts: 2, message: 'human 2' });
      queue.enqueue({ action: 'dev_do', from: 'arch', to: 'dev', ts: 3, message: 'normal 1' });

      const drained = queue.drainWhile(item => item.from === 'human');
      assert.strictEqual(drained.length, 2);
      assert.strictEqual(drained[0].message, 'human 1');
      assert.strictEqual(drained[1].message, 'human 2');
      assert.strictEqual(queue.pendingCount, 1);
      assert.strictEqual(queue.drain()[0].message, 'normal 1');
    });
  });

  describe('busy state', () => {
    it('should track busy/idle state', () => {
      assert.strictEqual(queue.isBusy(), false);
      queue.markBusy();
      assert.strictEqual(queue.isBusy(), true);
      queue.markIdle();
      assert.strictEqual(queue.isBusy(), false);
    });
  });

  describe('prepend (Feature #13)', () => {
    it('should add messages to the front of the queue', () => {
      queue.enqueue({ action: 'dev_do', from: 'arch', to: 'dev', ts: 3, message: 'existing' });
      queue.prepend([
        { action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'prepended1' },
        { action: 'dev_do', from: 'arch', to: 'dev', ts: 2, message: 'prepended2' },
      ]);

      const drained = queue.drain();
      assert.strictEqual(drained.length, 3);
      assert.strictEqual(drained[0].message, 'prepended1');
      assert.strictEqual(drained[1].message, 'prepended2');
      assert.strictEqual(drained[2].message, 'existing');
    });

    it('should work on empty queue', () => {
      queue.prepend([{ action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'only' }]);
      assert.strictEqual(queue.pendingCount, 1);
      const drained = queue.drain();
      assert.strictEqual(drained[0].message, 'only');
    });
  });
});

describe('mergeMessages', () => {
  it('should return empty string for empty array', () => {
    assert.strictEqual(mergeMessages([]), '');
  });

  it('should return single message directly', () => {
    const actions = [{ message: 'hello world' }];
    assert.strictEqual(mergeMessages(actions), 'hello world');
  });

  it('should merge multiple messages with separator', () => {
    const actions = [
      { message: 'first message' },
      { message: 'second message' },
      { message: 'third message' },
    ];
    const result = mergeMessages(actions);
    assert.ok(result.includes('first message'));
    assert.ok(result.includes('second message'));
    assert.ok(result.includes('third message'));
    assert.ok(result.includes('---'));
  });

  it('should preserve message order', () => {
    const actions = [
      { message: 'AAA' },
      { message: 'BBB' },
      { message: 'CCC' },
    ];
    const result = mergeMessages(actions);
    const aIdx = result.indexOf('AAA');
    const bIdx = result.indexOf('BBB');
    const cIdx = result.indexOf('CCC');
    assert.ok(aIdx < bIdx);
    assert.ok(bIdx < cIdx);
  });
});
