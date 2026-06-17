'use strict';

/**
 * AgentQueue - Feature #3
 *
 * Per-agent FIFO message queue with serial execution.
 * - Each agent (arch/dev/uat) has its own queue
 * - Single agent executes serially (no concurrency within one agent)
 * - Different agents can execute in parallel
 * - When agent is busy, messages queue up
 * - When previous execution completes, queued messages are merged into one prompt
 */
class AgentQueue {
  constructor(role) {
    this.role = role;
    this.queue = [];      // Pending messages (action objects)
    this.busy = false;    // Whether agent is currently executing
  }

  /**
   * Enqueue a message (action object)
   * @param {Object} action - The action object from actions.jsonl
   */
  enqueue(action) {
    this.queue.push(action);
  }

  /**
   * Enqueue a high-priority message before normal pending work.
   * Preserves FIFO order among existing high-priority messages.
   * @param {Object} action - The action object from actions.jsonl
   * @param {Function} isPriority - Predicate for existing priority actions
   */
  enqueuePriority(action, isPriority) {
    const insertAt = this.queue.findIndex(item => !isPriority(item));
    if (insertAt === -1) {
      this.queue.push(action);
      return;
    }
    this.queue.splice(insertAt, 0, action);
  }

  /**
   * Prepend messages to the front of the queue (for retry).
   * @param {Object[]} messages - Array of action objects to prepend
   */
  prepend(messages) {
    this.queue = [...messages, ...this.queue];
  }

  /**
   * Check if there are pending messages
   */
  hasPending() {
    return this.queue.length > 0;
  }

  /**
   * Get count of pending messages
   */
  get pendingCount() {
    return this.queue.length;
  }

  /**
   * Drain all pending messages from the queue.
   * Returns them in FIFO order and clears the queue.
   * @returns {Object[]} Array of action objects
   */
  drain() {
    const messages = [...this.queue];
    this.queue = [];
    return messages;
  }

  /**
   * Drain leading messages while predicate returns true.
   * Leaves the rest in the queue.
   * @param {Function} predicate
   * @returns {Object[]} Array of drained action objects
   */
  drainWhile(predicate) {
    const messages = [];
    while (this.queue.length > 0 && predicate(this.queue[0])) {
      messages.push(this.queue.shift());
    }
    return messages;
  }

  /**
   * Mark agent as busy (currently executing)
   */
  markBusy() {
    this.busy = true;
  }

  /**
   * Mark agent as idle (execution completed)
   */
  markIdle() {
    this.busy = false;
  }

  /**
   * Check if agent is currently busy
   */
  isBusy() {
    return this.busy;
  }
}

/**
 * Merge multiple action messages into a single prompt string.
 * Preserves order, each message on its own section.
 *
 * @param {Object[]} actions - Array of action objects
 * @returns {string} Merged prompt
 */
function mergeMessages(actions) {
  if (actions.length === 0) return '';
  if (actions.length === 1) return actions[0].message;

  // Multiple messages: merge with separator
  return actions
    .map((a, i) => a.message)
    .join('\n\n---\n\n');
}

module.exports = { AgentQueue, mergeMessages };
