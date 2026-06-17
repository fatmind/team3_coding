'use strict';

const EventEmitter = require('events');

/**
 * MessageRouter - Feature #4
 *
 * Bridges ActionWatcher and Daemon to route agent messages to web clients via WebSocket.
 *
 * When actions.jsonl receives a new line with from ∈ {arch, dev, uat},
 * this router pushes an agent.msg event through the Daemon's broadcast.
 *
 * Human messages (from=human) are NOT pushed via ws to avoid duplicate display
 * (the web client already shows them locally).
 *
 * WS event format: JSON.stringify({ type: "agent.msg", payload: "<raw jsonl line>" })
 */
class MessageRouter extends EventEmitter {
  /**
   * @param {Object} options
   * @param {import('./action-watcher')} options.actionWatcher - ActionWatcher instance
   * @param {import('./daemon')} options.daemon - Daemon instance (must have broadcast())
   */
  constructor(options = {}) {
    super();

    if (!options.actionWatcher) {
      throw new Error('MessageRouter requires an actionWatcher instance');
    }
    if (!options.daemon) {
      throw new Error('MessageRouter requires a daemon instance');
    }

    this.actionWatcher = options.actionWatcher;
    this.daemon = options.daemon;
    this.isRunning = false;

    // Agent roles that trigger ws push
    this._agentRoles = new Set(['arch', 'dev', 'uat']);

    // Bind handler for cleanup
    this._onAction = this._handleAction.bind(this);
  }

  /**
   * Start routing messages.
   * Subscribes to ActionWatcher 'action' events.
   */
  start() {
    if (this.isRunning) return;

    this.actionWatcher.on('action', this._onAction);
    this.isRunning = true;
    this.emit('started');
  }

  /**
   * Stop routing messages.
   * Unsubscribes from ActionWatcher events.
   */
  stop() {
    if (!this.isRunning) return;

    this.actionWatcher.removeListener('action', this._onAction);
    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * Handle an action event from ActionWatcher.
   *
   * @param {Object} action - Parsed action object
   * @param {string} rawLine - Original JSONL line string
   */
  _handleAction(action, rawLine) {
    // Only push messages from agents, not from human
    if (!this._agentRoles.has(action.from)) {
      this.emit('skipped', { action, reason: 'from is not an agent role' });
      return;
    }

    // Build ws event
    const wsEvent = JSON.stringify({
      type: 'agent.msg',
      payload: rawLine,
    });

    // Broadcast to all connected ws clients
    this.daemon.broadcast(wsEvent);

    this.emit('routed', { action, rawLine });
  }
}

module.exports = MessageRouter;
