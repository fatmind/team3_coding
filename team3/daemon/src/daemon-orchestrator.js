'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const Daemon = require('./daemon');
const ActionWatcher = require('./action-watcher');
const AgentScheduler = require('./agent-scheduler');
const MessageRouter = require('./message-router');
const StatePersistence = require('./state-persistence');
const ProjectJson = require('./project-json');
const DaemonLogger = require('./daemon-logger');
const config = require('./config');
const { rewriteMessage } = require('./message-rewriter');

/**
 * DaemonOrchestrator - Feature #5
 *
 * Integration entry point that wires together all daemon subsystems:
 *
 *   ActionWatcher (file watch)
 *       ├──→ AgentScheduler.dispatch()   (route to agent queue → spawn claude)
 *       └──→ MessageRouter._handleAction() (push agent msgs to ws clients)
 *
 * This enables the full message roundtrip:
 *   human writes to_arch → ActionWatcher detects
 *     → AgentScheduler routes to arch queue → spawns claude
 *     → claude (arch) responds, writes back to actions.jsonl
 *     → ActionWatcher detects response
 *     → MessageRouter pushes agent.msg via ws to web client
 *
 * Each subsystem remains independently testable; the orchestrator only
 * handles wiring and lifecycle.
 */
class DaemonOrchestrator extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {number} [options.port] - WebSocket port
   * @param {string} [options.projectJsonPath] - Path to .team3-project.json
   * @param {string} [options.actionsFilePath] - Path to actions.jsonl
   * @param {string} [options.specDir] - Path to spec/ directory
   * @param {Function} [options.spawnFn] - Override spawn (for testing)
   * @param {Function} [options.uuidFn] - Override UUID generator (for testing)
   * @param {number} [options.heartbeatInterval] - Daemon heartbeat interval
   * @param {number} [options.wsPingInterval] - Daemon ws ping interval
   * @param {Function} [options.watcherFactory] - Override chokidar (for testing)
   * @param {string} [options.modulesProgressPath] - Path to modules_progress.json (for arch session binding)
   * @param {string} [options.stateFilePath] - Path to .daemon-state.json
   * @param {StatePersistence} [options.statePersistence] - Override StatePersistence (for testing)
   * @param {string} [options.workspaceDir] - Workspace root directory (all paths derived from this)
   * @param {Object} [options.provider] - CodeCli provider instance (from code-cli/)
   */
  constructor(options = {}) {
    super();

    this.options = options;
    this.projectJsonPath = options.projectJsonPath || config.projectJsonPath;

    // Feature #17: Derive workspace directory from projectJsonPath
    this.workspaceDir = options.workspaceDir || path.dirname(this.projectJsonPath);

    this.modulesProgressPath = options.modulesProgressPath
      || path.join(this.workspaceDir, 'spec', 'modules_progress.json');

    // State persistence (Feature #15) — state file lives in workspace root
    const stateFilePath = options.stateFilePath
      || path.join(this.workspaceDir, '.daemon-state.json');
    this.statePersistence = options.statePersistence || new StatePersistence(stateFilePath);
    const persistedState = this.statePersistence.load();

    // Create subsystems
    this.daemon = options.daemon || new Daemon({
      port: options.port || config.port,
      projectJsonPath: this.projectJsonPath,
      heartbeatInterval: options.heartbeatInterval || config.heartbeatInterval,
      wsPingInterval: options.wsPingInterval || config.wsPingInterval,
    });

    this.actionWatcher = options.actionWatcher || new ActionWatcher(
      options.actionsFilePath || path.join(this.workspaceDir, 'spec', 'actions.jsonl'),
      {
        watcherFactory: options.watcherFactory || undefined,
        initialOffset: persistedState.lastProcessingOffset || null,
        onOffsetUpdate: (offset) => this.statePersistence.updateOffset(offset),
      }
    );

    this.agentScheduler = options.agentScheduler || new AgentScheduler({
      projectJsonPath: this.projectJsonPath,
      specDir: options.specDir || path.join(this.workspaceDir, 'spec'),
      modulesProgressPath: this.modulesProgressPath,
      workspaceDir: this.workspaceDir,
      logDir: path.join(this.workspaceDir, 'logs'),
      actionsFilePath: options.actionsFilePath || path.join(this.workspaceDir, 'spec', 'actions.jsonl'),
      spawnFn: options.spawnFn,
      uuidFn: options.uuidFn,
      provider: options.provider,
    });

    this.messageRouter = new MessageRouter({
      actionWatcher: this.actionWatcher,
      daemon: this.daemon,
    });

    // Feature #18: Structured daemon logger
    this.logger = options.logger || new DaemonLogger({
      logDir: path.join(this.workspaceDir, 'logs'),
    });

    // Feature #21: Health check config
    this._healthCheckInterval = options.healthCheckInterval || 60000;
    this._healthCheckMaxFailures = options.healthCheckMaxFailures || 3;
    this._healthCheckTimer = null;
    this._healthFailCount = 0;

    this.isRunning = false;

    // Bind dispatch handler for cleanup
    this._onActionForScheduler = this._dispatchToScheduler.bind(this);
  }

  /**
   * Start all subsystems and wire them together.
   */
  async start() {
    if (this.isRunning) return;

    // 1. Start daemon (ws server)
    await this.daemon.start();

    // 2. Wire ActionWatcher → AgentScheduler BEFORE starting watcher
    //    so replay events (Feature #15) are captured
    this.actionWatcher.on('action', this._onActionForScheduler);

    // Wire validation-error → notify human (don't silently drop bad-format messages)
    this.actionWatcher.on('validation-error', ({ parsed, missing }) => {
      const summary = JSON.stringify(parsed).substring(0, 200);
      const msg = `Agent 写入格式错误（缺少字段: ${missing.join(', ')}）。原始内容: ${summary}`;
      this.logger._write('VALIDATION_ERROR', msg);
      try {
        const action = { action: 'to_human', from: 'daemon', to: 'human', ts: Math.floor(Date.now() / 1000), message: msg };
        const actionsPath = this.actionWatcher.filePath;
        fs.appendFileSync(actionsPath, JSON.stringify(action) + '\n');
      } catch (e) {
        this.logger.error(`Failed to write validation-error notification: ${e.message}`);
      }
    });

    // 3. Start message router (ws push for agent messages)
    this.messageRouter.start();

    // 4. Start action watcher (file monitoring + replay from persisted offset)
    this.actionWatcher.start();

    // Forward key events for observability + Feature #18 logging
    this.agentScheduler.on('enqueued', (data) => this.emit('enqueued', data));
    this.agentScheduler.on('spawn', (data) => {
      this.logger.dispatch(data);
      this.emit('spawn', data);
    });
    this.agentScheduler.on('completed', (data) => {
      this.logger.done(data);
      this.emit('completed', data);
    });
    this.agentScheduler.on('timeout', (data) => {
      this.logger.timeout(data);
    });
    this.agentScheduler.on('inactivity-timeout', (data) => {
      this.logger._write('INACTIVITY', `role=${data.role} no_stdout_for=${data.inactivityMs}ms`);
    });
    this.agentScheduler.on('retry', (data) => {
      this.logger.retry(data);
    });
    this.agentScheduler.on('dead-letter', (data) => {
      this.logger.deadLetter(data);
    });
    this.agentScheduler.on('session-reset', (data) => {
      this.logger._write('SESSION_RESET', `role=${data.role} reason="${data.reason}"`);
    });
    this.agentScheduler.on('error', (data) => {
      this.logger.error(data.error || data.message || 'unknown error');
      this.emit('error', data);
    });
    this.agentScheduler.on('skip', (data) => this.emit('skip', data));
    // Feature #22: Broadcast agent stdout parsed lines via WS
    this.agentScheduler.on('agent-log', (data) => {
      const wsEvent = JSON.stringify({
        type: 'agent.log',
        role: data.role,
        lines: data.lines,
      });
      this.daemon.broadcast(wsEvent);
      this.emit('agent-log', data);
    });
    this.messageRouter.on('routed', (data) => {
      this.logger.route(data.action);
      this.emit('routed', data);
    });

    this.isRunning = true;
    this.logger.start({ port: this.options.port || config.port, workspaceDir: this.workspaceDir });

    // Feature #21: Start periodic health check
    this._startHealthCheck();

    this.emit('started');
  }

  /**
   * Stop all subsystems gracefully.
   */
  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Feature #21: Stop health check
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }

    // Feature #16: SIGTERM all tracked child processes
    this.agentScheduler.clearAllTimers();
    const killed = this.agentScheduler.killAllProcesses();
    if (killed.length > 0) {
      this.emit('shutdown-kill', { killed });
    }

    // Unwire
    this.actionWatcher.removeListener('action', this._onActionForScheduler);

    // Stop in reverse order
    this.messageRouter.stop();
    await this.actionWatcher.stop();
    await this.daemon.stop();

    // Persist final offset synchronously (Feature #15)
    this.statePersistence.updateOffset(this.actionWatcher.currentOffset);
    this.statePersistence.saveSync();
    this.statePersistence.destroy();

    this.logger.stop();
    this.logger.destroy();
    this.emit('stopped');
  }

  /**
   * Dispatch action to AgentScheduler for agent routing.
   * This is the integration bridge between file watching and agent execution.
   *
   * Before dispatching, applies message rewriting rules (Feature #6):
   * - reread protocol: filter files by target
   *
   * @param {Object} action - Parsed action object
   * @param {string} rawLine - Original JSONL line (unused here, consumed by MessageRouter)
   */
  /**
   * Feature #21: Start periodic health check.
   * Checks: actions.jsonl readable, WS server has address (listening).
   * 3 consecutive failures → exit(1) to let watchdog restart.
   */
  _startHealthCheck() {
    if (!this._healthCheckInterval) return;
    this._healthCheckTimer = setInterval(() => {
      this._runHealthCheck();
    }, this._healthCheckInterval);
    if (this._healthCheckTimer.unref) {
      this._healthCheckTimer.unref();
    }
  }

  _runHealthCheck() {
    const checks = [];

    // Check 1: actions.jsonl exists and is readable
    try {
      const actionsPath = this.actionWatcher.filePath || this.options.actionsFilePath;
      if (actionsPath) {
        fs.accessSync(actionsPath, fs.constants.R_OK);
        checks.push('actions=ok');
      }
    } catch (e) {
      checks.push('actions=FAIL');
    }

    // Check 2: WS server is listening
    try {
      const addr = this.daemon.wss && this.daemon.wss.address();
      if (addr) {
        checks.push('ws=ok');
      } else {
        checks.push('ws=FAIL');
      }
    } catch (e) {
      checks.push('ws=FAIL');
    }

    const hasFail = checks.some(c => c.includes('FAIL'));
    if (hasFail) {
      this._healthFailCount++;
      this.logger.health(`FAIL(${this._healthFailCount}/${this._healthCheckMaxFailures}) ${checks.join(' ')}`);
      this.emit('health-fail', { failCount: this._healthFailCount, checks });

      // Try self-recovery before giving up
      if (this._healthFailCount >= this._healthCheckMaxFailures) {
        this.logger._write('RECOVERY', 'Attempting self-recovery...');
        const recovered = this._attemptSelfRecovery(checks);
        if (recovered) {
          this.logger._write('RECOVERY', 'Self-recovery succeeded');
          this._healthFailCount = 0;
        } else {
          this.logger.error(`Health check failed ${this._healthFailCount} times, self-recovery failed, exiting`);
          this.emit('health-fatal', { failCount: this._healthFailCount });
          process.exit(1);
        }
      }
    } else {
      if (this._healthFailCount > 0) {
        this._healthFailCount = 0;
      }
      this.logger.health(`ok ${checks.join(' ')}`);
    }
  }

  _attemptSelfRecovery(checks) {
    let recovered = true;
    for (const check of checks) {
      if (check === 'ws=FAIL') {
        try {
          this.daemon.wss && this.daemon.wss.close();
          // WS server will be re-detected as failed on next health check
          // For now, just mark as attempted — full WS restart is complex
          recovered = false;
        } catch (e) {
          recovered = false;
        }
      }
      // actions=FAIL is often transient (file lock, spotlight indexing) — just wait
    }
    return recovered;
  }

  _dispatchToScheduler(action, rawLine) {
    this.logger.watch(action);

    const rewrittenMessage = rewriteMessage(action.message, action.to);

    const rewrittenAction = { ...action, message: rewrittenMessage };
    this.agentScheduler.dispatch(rewrittenAction);
  }
}

module.exports = DaemonOrchestrator;
