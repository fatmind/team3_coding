'use strict';

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const ProjectJson = require('./project-json');
const config = require('./config');
const { AgentQueue, mergeMessages } = require('./agent-queue');
const { getInProgressModuleId } = require('./message-rewriter');
const AgentLogger = require('./agent-logger');
const { hasNewWritesSince, getFileOffset, extractActionFromResult, buildFallbackAction } = require('./reply-fallback');
const { formatLogTime } = require('./stdout-parser');
const claudeCodeProvider = require('./code-cli/claude-code');

const HUMAN_DISPATCH_ACK_MESSAGE = 'get，开始处理中，稍等';

/**
 * AgentScheduler - Feature #3 + Feature #13
 *
 * Core scheduling engine for Agent→Agent communication via actions.jsonl.
 * Responsibilities:
 * - Maintain per-agent FIFO queues (arch/dev/uat)
 * - Serial execution per agent, parallel across agents
 * - Spawn claude code with correct --session-id or --resume
 * - Dev session lifecycle: dev_do → new UUID, archive old; dev_fix → reuse current
 * - UAT session lifecycle: uat_check → new UUID, archive old; uat_fix → reuse current
 * - Arch session lifecycle: bound_module + modules_progress in_progress → rotate on module switch
 * - Detect task completion (exit code 0)
 * - Merge queued messages when agent becomes idle
 * - Feature #13: Timeout kill + retry on failure + dead letter notification
 */
class AgentScheduler extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {string} [options.projectJsonPath] - Path to .team3-project.json
   * @param {string} [options.specDir] - Path to spec/ directory
   * @param {Function} [options.spawnFn] - Override spawn function (for testing)
   * @param {Function} [options.uuidFn] - Override UUID generator (for testing)
   * @param {Object} [options.agentLogger] - Override AgentLogger instance (for testing)
   * @param {string} [options.logDir] - Log directory for agent logs
   * @param {number} [options.claudeTimeoutMs] - Process timeout in ms (default from config)
   * @param {number} [options.claudeKillGraceMs] - Grace period SIGTERM→SIGKILL (default from config)
   * @param {number} [options.claudeRetryDelayMs] - Delay before retry (default from config)
   * @param {number} [options.claudeMaxRetries] - Max retries before dead letter (default from config)
   * @param {number} [options.claudeInactivityTimeoutMs] - Kill if no stdout for this long (default from config)
   * @param {string} [options.actionsFilePath] - Path to actions.jsonl (for dead letter write)
   * @param {string} [options.workspaceDir] - Workspace root directory (used as cwd for spawned agents)
   * @param {string} [options.modulesProgressPath] - Path to modules_progress.json (arch session binding)
   * @param {Object} [options.provider] - CodeCli provider instance (from code-cli/)
   */
  constructor(options = {}) {
    super();
    this.provider = options.provider || claudeCodeProvider;
    this.projectJsonPath = options.projectJsonPath || config.projectJsonPath;
    this.specDir = options.specDir || path.resolve(__dirname, '../../spec');
    this.modulesProgressPath = options.modulesProgressPath
      || path.join(this.specDir, 'modules_progress.json');
    this.spawnFn = options.spawnFn || spawn;
    this.uuidFn = options.uuidFn || randomUUID;
    // Feature #17: workspace dir used as cwd for spawned claude processes
    this.workspaceDir = options.workspaceDir || path.dirname(this.projectJsonPath);

    // Feature #13: timeout / retry / dead letter config (per-role)
    this.claudeTimeoutMs = this._toPerRole(options.claudeTimeoutMs, config.claudeTimeoutMs);
    this.claudeKillGraceMs = options.claudeKillGraceMs != null ? options.claudeKillGraceMs : config.claudeKillGraceMs;
    this.claudeRetryDelayMs = options.claudeRetryDelayMs != null ? options.claudeRetryDelayMs : config.claudeRetryDelayMs;
    this.claudeMaxRetries = options.claudeMaxRetries != null ? options.claudeMaxRetries : config.claudeMaxRetries;
    // Feature #19: inactivity (no stdout) timeout (per-role)
    this.claudeInactivityTimeoutMs = this._toPerRole(options.claudeInactivityTimeoutMs, config.claudeInactivityTimeoutMs);
    this.actionsFilePath = options.actionsFilePath || path.resolve(__dirname, '../../spec/actions.jsonl');

    // Agent logger for recording claude stdout (Feature #7)
    this.agentLogger = options.agentLogger || new AgentLogger({
      logDir: options.logDir || undefined,
    });

    // Per-agent queues
    this.queues = {
      arch: new AgentQueue('arch'),
      dev: new AgentQueue('dev'),
      uat: new AgentQueue('uat'),
    };

    // Track running processes
    this.processes = {
      arch: null,
      dev: null,
      uat: null,
    };

    // Feature #13: Track timeout timers and kill timers
    this._timeoutTimers = { arch: null, dev: null, uat: null };
    this._killTimers = { arch: null, dev: null, uat: null };
    this._retryTimers = { arch: null, dev: null, uat: null };
    // Feature #19: Heartbeat (inactivity) timers
    this._heartbeatTimers = { arch: null, dev: null, uat: null };
    // Feature #22: Per-role stdout line buffers for stream-json parsing
    this._lineBuffers = { arch: '', dev: '', uat: '' };
    // Token estimation: per-role char counters, active during a session
    this._sessionStats = { arch: null, dev: null, uat: null };
    // User interrupt state: a human message can stop the current claude turn and resume.
    this._interrupts = { arch: null, dev: null, uat: null };
    this._resumeAfterInterrupt = { arch: false, dev: false, uat: false };
  }

  /**
   * Route an action to the appropriate agent queue and trigger execution.
   * This is the main entry point called by ActionWatcher.
   *
   * @param {Object} action - Parsed action object from actions.jsonl
   */
  dispatch(action) {
    const target = this._resolveTarget(action);
    if (!target) {
      this.emit('skip', { action, reason: 'no valid target agent' });
      return;
    }

    const queue = this.queues[target];
    const shouldInterrupt = this._isHumanInterrupt(action) && queue.isBusy();
    if (shouldInterrupt) {
      queue.enqueuePriority(action, this._isHumanInterrupt);
    } else {
      queue.enqueue(action);
    }
    this.emit('enqueued', { role: target, action, queueSize: queue.pendingCount });

    if (action.from === 'human') {
      this._writeHumanDispatchAck(target);
    }

    // Try to execute immediately if agent is idle
    if (!queue.isBusy()) {
      this._executeNext(target);
    } else if (shouldInterrupt) {
      this._requestInterrupt(target, action);
    }
  }

  /**
   * Resolve which agent should receive this action.
   * Returns 'arch', 'dev', 'uat', or null.
   */
  _resolveTarget(action) {
    const { action: actionType, to } = action;

    // Direct agent targets
    if (actionType === 'dev_do' || actionType === 'dev_fix') {
      return 'dev';
    }
    if (actionType === 'uat_check' || actionType === 'uat_fix') {
      return 'uat';
    }
    if (actionType === 'to_arch') {
      return 'arch';
    }

    // Generic routing by 'to' field
    if (['arch', 'dev', 'uat'].includes(to)) {
      return to;
    }

    // to=human or note: no agent target
    return null;
  }

  /**
   * Execute next batch of messages for a given agent.
   * Drains the queue, merges messages, spawns claude.
   * Feature #13: Adds timeout kill, retry on failure, and dead letter notification.
   */
  async _executeNext(role) {
    const queue = this.queues[role];
    if (!queue.hasPending()) return;

    // After a user interrupt, first resume with human messages only.
    // This avoids merging a queued dev_do and accidentally creating a new Dev session.
    let messages;
    if (this._resumeAfterInterrupt[role]) {
      messages = queue.drainWhile(this._isHumanInterrupt);
      if (messages.length === 0) {
        messages = queue.drain();
      }
    } else {
      messages = queue.drain();
    }
    queue.markBusy();

    // Feature #13: Determine retry count from messages (max _retryCount across all)
    const retryCount = messages.reduce((max, m) => Math.max(max, m._retryCount || 0), 0);

    // Determine session ID and spawn mode
    const { sessionId, isNew } = this._resolveSession(role, messages);

    // Merge messages into a single prompt
    let prompt = mergeMessages(messages);
    if (this._resumeAfterInterrupt[role]) {
      prompt = this._buildInterruptResumePrompt(prompt);
      this._resumeAfterInterrupt[role] = false;
    }

    // Build args via provider
    const args = this.provider.buildArgs({ prompt, sessionId, isNew, role, workspaceDir: this.workspaceDir });

    // Init token estimation stats for this session
    this._sessionStats[role] = {
      startTs: Date.now(), turns: 0,
      inputChars: 0, outputChars: 0, toolResultChars: 0, thinkingChars: 0,
    };

    this.emit('spawn', { role, sessionId, isNew, prompt, args, messageCount: messages.length, retryCount });

    // Feature #14: Record actions.jsonl offset before spawn for fallback check
    const spawnOffset = getFileOffset(this.actionsFilePath);

    // Spawn code CLI process (Feature #17: explicit cwd = workspace root)
    const proc = this.spawnFn(this.provider.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: this.workspaceDir,
    });

    this.processes[role] = proc;

    // Collect output for logging
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      this.emit('stdout', { role, data: chunk });
      // Feature #19: Reset inactivity heartbeat on any stdout activity
      this._resetHeartbeat(role, proc, () => { timedOut = true; });
      // Feature #22: Line-buffered stream-json parsing + emit agent-log
      // Also writes to agent log (moved from raw write to line-level write
      // so result events can be enriched with token estimates before logging)
      this._processStdoutChunk(role, chunk);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      this.emit('stderr', { role, data: data.toString() });
    });

    // Feature #13: Start timeout timer (per-role)
    const totalTimeoutMs = this.claudeTimeoutMs[role];
    this._timeoutTimers[role] = setTimeout(() => {
      timedOut = true;
      this.emit('timeout', { role, sessionId, timeoutMs: totalTimeoutMs });

      // SIGTERM first
      try { proc.kill('SIGTERM'); } catch (e) { /* process may already be gone */ }

      // After grace period, SIGKILL
      this._killTimers[role] = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (e) { /* process may already be gone */ }
        this._killTimers[role] = null;
      }, this.claudeKillGraceMs);
    }, totalTimeoutMs);

    // Feature #19: Start initial inactivity heartbeat
    this._resetHeartbeat(role, proc, () => { timedOut = true; });

    proc.on('close', (code, signal) => {
      // Clear timeout/kill timers (includes heartbeat)
      this._clearTimers(role);
      this.processes[role] = null;
      // Feature #22: Flush remaining line buffer to log
      const remaining = this._lineBuffers[role];
      if (remaining && remaining.trim()) {
        const processedLine = this._processLineForStats(role, remaining);
        this.agentLogger.write(role, processedLine + '\n');
      }
      this._lineBuffers[role] = '';
      this._sessionStats[role] = null;

      // Treat signal-killed (code=null, signal='SIGTERM'/'SIGKILL') as non-zero
      const effectiveCode = (code === null && signal) ? 1 : code;

      const interruptInfo = this._interrupts[role];
      if (interruptInfo && interruptInfo.requested) {
        this._interrupts[role] = null;
        this._resumeAfterInterrupt[role] = true;
        queue.markIdle();

        this.emit('interrupted', {
          role,
          sessionId,
          signal,
          exitCode: effectiveCode,
          action: interruptInfo.action,
        });

        this.emit('completed', {
          role,
          sessionId,
          exitCode: effectiveCode,
          stdout,
          stderr,
          timedOut: false,
          interrupted: true,
          retryCount,
        });

        if (queue.hasPending()) {
          this._executeNext(role);
        }
        return;
      }

      // Feature #13: Handle non-zero exit (including timeout kill)
      if (effectiveCode !== 0 && effectiveCode !== null) {
        const failReason = timedOut ? 'timeout' : `exit code ${effectiveCode}`;
        const newRetryCount = retryCount + 1;

        this.emit('completed', {
          role,
          sessionId,
          exitCode: effectiveCode,
          stdout,
          stderr,
          timedOut,
          retryCount: newRetryCount,
        });

        if (newRetryCount >= this.claudeMaxRetries) {
          // Dead Letter: max retries exhausted
          queue.markIdle();
          this._writeDeadLetter(role, failReason, messages, prompt);

          // Process next messages if any were queued during execution
          if (queue.hasPending()) {
            this._executeNext(role);
          }
          return;
        }

        // Feature #20: If resume points at a missing Claude conversation,
        // replace the logical session id and retry the same message as a new CLI session.
        const shouldRepairMissingSession = this._isMissingConversationError(effectiveCode, stderr, stdout);
        if (shouldRepairMissingSession) {
          this._resetSession(role);
          this.emit('session-reset', { role, reason: 'No conversation found' });
        }

        // Retry: prepend messages back with incremented _retryCount
        const retryMessages = messages.map((m) => {
          const retryMessage = { ...m, _retryCount: newRetryCount };
          delete retryMessage._forceNewSession;
          if (shouldRepairMissingSession) {
            retryMessage._forceNewSession = true;
          }
          return retryMessage;
        });
        queue.prepend(retryMessages);
        queue.markIdle();

        this.emit('retry', { role, retryCount: newRetryCount, maxRetries: this.claudeMaxRetries, delayMs: this.claudeRetryDelayMs });

        // Delay before re-execution
        this._retryTimers[role] = setTimeout(() => {
          this._retryTimers[role] = null;
          if (queue.hasPending()) {
            this._executeNext(role);
          }
        }, this.claudeRetryDelayMs);
        return;
      }

      // Exit code 0: success path
      queue.markIdle();

      // Feature #14: Reply fallback — if agent didn't write to actions.jsonl, auto-append
      const fallbackResult = this._applyFallback({ stdout, role, spawnOffset });
      if (fallbackResult.applied) {
        this.emit('fallback', { role, action: fallbackResult.action, reason: fallbackResult.reason });
      }

      this.emit('completed', {
        role,
        sessionId,
        exitCode: effectiveCode,
        stdout,
        stderr,
        timedOut: false,
        retryCount,
        fallback: fallbackResult,
      });

      // If more messages queued while we were busy, execute next batch
      if (queue.hasPending()) {
        this._executeNext(role);
      }
    });

    proc.on('error', (err) => {
      this._clearTimers(role);
      this.processes[role] = null;

      const newRetryCount = retryCount + 1;

      if (newRetryCount >= this.claudeMaxRetries) {
        // Dead Letter on spawn error
        queue.markIdle();
        this.emit('error', { role, sessionId, error: err.message, retryCount: newRetryCount });
        this._writeDeadLetter(role, `spawn error: ${err.message}`, messages, prompt);
        if (queue.hasPending()) {
          this._executeNext(role);
        }
        return;
      }

      // Retry on error
      const retryMessages = messages.map(m => ({ ...m, _retryCount: newRetryCount }));
      queue.prepend(retryMessages);
      queue.markIdle();

      this.emit('error', { role, sessionId, error: err.message, retryCount: newRetryCount });
      this.emit('retry', { role, retryCount: newRetryCount, maxRetries: this.claudeMaxRetries, delayMs: this.claudeRetryDelayMs });

      this._retryTimers[role] = setTimeout(() => {
        this._retryTimers[role] = null;
        if (queue.hasPending()) {
          this._executeNext(role);
        }
      }, this.claudeRetryDelayMs);
    });
  }

  /**
   * Normalize a config value to per-role object { arch, dev, uat }.
   * Accepts a number (applied to all roles) or an object with per-role keys.
   */
  _toPerRole(optionValue, configValue) {
    const val = optionValue != null ? optionValue : configValue;
    if (typeof val === 'number') {
      return { arch: val, dev: val, uat: val };
    }
    return val;
  }

  /**
   * Feature #13: Clear timeout and kill timers for an agent.
   */
  _clearTimers(role) {
    if (this._timeoutTimers[role]) {
      clearTimeout(this._timeoutTimers[role]);
      this._timeoutTimers[role] = null;
    }
    if (this._killTimers[role]) {
      clearTimeout(this._killTimers[role]);
      this._killTimers[role] = null;
    }
    if (this._heartbeatTimers[role]) {
      clearTimeout(this._heartbeatTimers[role]);
      this._heartbeatTimers[role] = null;
    }
  }

  /**
   * Feature #19: Reset inactivity heartbeat timer.
   * If no stdout activity for claudeInactivityTimeoutMs, kill the process.
   */
  _resetHeartbeat(role, proc, onTimeout) {
    const inactivityMs = this.claudeInactivityTimeoutMs[role];
    if (!inactivityMs) return;
    if (this._heartbeatTimers[role]) {
      clearTimeout(this._heartbeatTimers[role]);
    }
    const setAt = Date.now();
    this._heartbeatTimers[role] = setTimeout(() => {
      this._heartbeatTimers[role] = null;
      const elapsed = Date.now() - setAt;
      if (elapsed > inactivityMs * 2) {
        this._resetHeartbeat(role, proc, onTimeout);
        return;
      }
      this.emit('inactivity-timeout', { role, inactivityMs });
      onTimeout();
      try { proc.kill('SIGTERM'); } catch (e) { /* already gone */ }
      this._killTimers[role] = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (e) { /* already gone */ }
        this._killTimers[role] = null;
      }, this.claudeKillGraceMs);
    }, inactivityMs);
  }

  /**
   * Acknowledge human→agent dispatch with a note so web history survives page switches.
   *
   * @param {string} target - Agent role (arch/dev/uat)
   */
  _writeHumanDispatchAck(target) {
    const ackAction = {
      action: 'note',
      from: target,
      to: 'human',
      ts: Math.floor(Date.now() / 1000),
      message: HUMAN_DISPATCH_ACK_MESSAGE,
    };

    try {
      fs.appendFileSync(this.actionsFilePath, JSON.stringify(ackAction) + '\n');
    } catch (err) {
      this.emit('error', { error: err.message, context: 'human-dispatch-ack' });
    }
  }

  /**
   * Feature #13: Write Dead Letter notification to actions.jsonl.
   * Notifies human that an agent has failed after max retries.
   *
   * @param {string} role - Agent role (arch/dev/uat)
   * @param {string} reason - Failure reason
   * @param {Object[]} messages - Original messages that failed
   * @param {string} prompt - The merged prompt text
   */
  _writeDeadLetter(role, reason, messages, prompt) {
    const summary = prompt.substring(0, 200);
    const deadLetterMsg = `Agent ${role} 执行失败（${reason}），已重试 ${this.claudeMaxRetries} 次仍失败。消息摘要：${summary}`;

    const deadLetterAction = {
      action: 'to_human',
      from: role,
      to: 'human',
      ts: Math.floor(Date.now() / 1000),
      message: deadLetterMsg,
    };

    try {
      fs.appendFileSync(this.actionsFilePath, JSON.stringify(deadLetterAction) + '\n');
    } catch (err) {
      // Best-effort: emit error if file write fails
      this.emit('dead-letter-error', { role, error: err.message });
    }

    this.emit('dead-letter', { role, reason, message: deadLetterMsg, action: deadLetterAction });
  }

  /**
   * Resolve session ID for an agent execution.
   * Handles Dev lifecycle (dev_do → new session, dev_fix → reuse).
   *
   * @param {string} role - Agent role
   * @param {Object[]} messages - Batch of action messages
   * @returns {{ sessionId: string, isNew: boolean }}
   */
  _resolveSession(role, messages) {
    const projectJson = new ProjectJson(this.projectJsonPath);
    const data = projectJson.read();

    // Ensure partner structure
    if (!data.partner) data.partner = {};

    const agentKey = `${role}_agent`;
    if (!data.partner[agentKey]) data.partner[agentKey] = {};
    if (!data.partner[agentKey].session) data.partner[agentKey].session = {};

    const session = data.partner[agentKey].session;
    const forceNewSession = messages.some(m => m._forceNewSession);

    if (forceNewSession) {
      const currentId = session.runing;
      if (!currentId) {
        const newId = this.uuidFn();
        session.runing = newId;
        projectJson.write(data);
        return { sessionId: newId, isNew: true };
      }
      return { sessionId: currentId, isNew: true };
    }

    if (role === 'arch') {
      return this._resolveArchSession(data, session, projectJson);
    }

    if (role === 'dev') {
      // Check if any message is dev_do (new task)
      const hasDevDo = messages.some(m => m.action === 'dev_do');

      if (hasDevDo) {
        // Archive old session
        const oldSessionId = session.runing;
        if (oldSessionId) {
          if (!session.done) session.done = [];
          session.done.push(oldSessionId);
        }

        // Generate new session ID
        const newSessionId = this.uuidFn();
        session.runing = newSessionId;
        projectJson.write(data);

        return { sessionId: newSessionId, isNew: true };
      } else {
        // dev_fix or other: reuse current session
        const currentId = session.runing;
        if (!currentId) {
          // No running session, create one
          const newId = this.uuidFn();
          session.runing = newId;
          projectJson.write(data);
          return { sessionId: newId, isNew: true };
        }
        return { sessionId: currentId, isNew: false };
      }
    }

    if (role === 'uat') {
      return this._resolveUatSession(messages, data, session, projectJson);
    }

    const currentId = session.runing;
    if (!currentId) {
      const newId = this.uuidFn();
      session.runing = newId;
      projectJson.write(data);
      return { sessionId: newId, isNew: true };
    }

    return { sessionId: currentId, isNew: false };
  }

  _resolveUatSession(messages, data, session, projectJson) {
    const startsNewUatTask = messages.some(m => m.action === 'uat_design' || m.action === 'uat_check');
    if (startsNewUatTask && !this._resumeAfterInterrupt.uat) {
      const oldSessionId = session.runing;
      if (oldSessionId) {
        if (!session.done) session.done = [];
        session.done.push(oldSessionId);
      }

      const newSessionId = this.uuidFn();
      session.runing = newSessionId;
      projectJson.write(data);
      return { sessionId: newSessionId, isNew: true };
    }

    const currentId = session.runing;
    if (!currentId) {
      const newId = this.uuidFn();
      session.runing = newId;
      projectJson.write(data);
      return { sessionId: newId, isNew: true };
    }

    return { sessionId: currentId, isNew: false };
  }

  /**
   * Arch session: one module per session via bound_module + modules_progress in_progress.
   * @see spec/module_4_hardening.md 问题 2
   */
  _resolveArchSession(data, session, projectJson) {
    const skipModuleRotation = this._resumeAfterInterrupt.arch;
    const inProgressId = getInProgressModuleId(this.modulesProgressPath);
    let boundModule = session.bound_module ?? null;
    let rotated = false;

    if (!skipModuleRotation && inProgressId) {
      if (boundModule === null) {
        session.bound_module = inProgressId;
        boundModule = inProgressId;
        projectJson.write(data);
      } else if (boundModule !== inProgressId) {
        const oldSessionId = session.runing;
        if (oldSessionId) {
          if (!session.done) session.done = [];
          session.done.push(oldSessionId);
        }
        session.runing = this.uuidFn();
        session.bound_module = inProgressId;
        projectJson.write(data);
        rotated = true;
      }
    }

    const currentId = session.runing;
    if (!currentId) {
      const newId = this.uuidFn();
      session.runing = newId;
      if (session.bound_module === undefined) {
        session.bound_module = null;
      }
      projectJson.write(data);
      return { sessionId: newId, isNew: true };
    }

    if (rotated) {
      return { sessionId: currentId, isNew: true };
    }

    return { sessionId: currentId, isNew: false };
  }

  /**
   * Feature #20: Repair a dead CLI session — generate a new UUID.
   * The retry message carries _forceNewSession so this fresh id is created via --session-id.
   */
  _resetSession(role) {
    try {
      const projectJson = new ProjectJson(this.projectJsonPath);
      const data = projectJson.read();
      const agentKey = `${role}_agent`;
      if (!data.partner) data.partner = {};
      if (!data.partner[agentKey]) data.partner[agentKey] = {};
      if (!data.partner[agentKey].session) data.partner[agentKey].session = {};

      const session = data.partner[agentKey].session;
      session.runing = this.uuidFn();
      projectJson.write(data);
    } catch (e) {
      // Non-fatal: next retry will still attempt with old session
    }
  }

  _isMissingConversationError(exitCode, stderr, stdout) {
    return this.provider.isMissingSessionError(exitCode, stderr, stdout);
  }

  /**
   * Feature #14: Apply fallback using provider's extractResult.
   */
  _applyFallback({ stdout, role, spawnOffset }) {
    const resultText = this.provider.extractResult(stdout);
    if (!resultText) {
      return { applied: false, action: null, reason: 'no-result' };
    }
    if (hasNewWritesSince(this.actionsFilePath, spawnOffset, role)) {
      return { applied: false, action: null, reason: 'already-written' };
    }
    let action = extractActionFromResult(resultText, role);
    if (!action) {
      action = buildFallbackAction(resultText, role);
    }
    if (!action.ts) {
      action.ts = Math.floor(Date.now() / 1000);
    }
    try {
      fs.appendFileSync(this.actionsFilePath, JSON.stringify(action) + '\n');
    } catch (err) {
      return { applied: false, action, reason: `write-error: ${err.message}` };
    }
    return { applied: true, action, reason: 'fallback-applied' };
  }

  _isHumanInterrupt(action) {
    return action && action.from === 'human';
  }

  _requestInterrupt(role, action) {
    const existing = this._interrupts[role];
    if (existing && existing.requested) {
      this.emit('interrupt-queued', { role, action });
      return false;
    }

    const proc = this.processes[role];
    if (!proc || typeof proc.kill !== 'function' || proc.exitCode != null || proc.signalCode != null) {
      this.emit('interrupt-skipped', { role, action, reason: 'no running process' });
      return false;
    }

    let sent = false;
    try {
      sent = proc.kill('SIGINT');
    } catch (err) {
      this.emit('interrupt-error', { role, action, error: err.message });
      return false;
    }

    if (!sent) {
      this.emit('interrupt-skipped', { role, action, reason: 'SIGINT not sent' });
      return false;
    }

    this._interrupts[role] = {
      requested: true,
      action,
      signal: 'SIGINT',
      requestedAt: Date.now(),
    };
    this.emit('interrupt', { role, action, signal: 'SIGINT', pid: proc.pid });
    return true;
  }

  _buildInterruptResumePrompt(prompt) {
    return [
      '上一轮执行被用户中断了，不代表任务已经完成。',
      '当前工作区可能已经有部分改动。请先检查现状，再按用户的新消息继续。',
      '不要继续旧方向硬做完，优先处理用户这次补充的新要求。',
      '',
      '用户新消息：',
      prompt,
    ].join('\n');
  }

  /**
   * Check if an agent is currently busy.
   */
  isAgentBusy(role) {
    return this.queues[role] && this.queues[role].isBusy();
  }

  /**
   * Get pending count for an agent.
   */
  getPendingCount(role) {
    return this.queues[role] ? this.queues[role].pendingCount : 0;
  }

  /**
   * Get current running process for an agent (or null).
   */
  getProcess(role) {
    return this.processes[role];
  }

  getAgentRunState(role) {
    const queue = this.queues[role];
    const proc = this.processes[role];
    return {
      role,
      busy: Boolean(queue && queue.isBusy()),
      pendingCount: queue ? queue.pendingCount : 0,
      pid: proc ? proc.pid : null,
      running: Boolean(proc && proc.exitCode == null && proc.signalCode == null),
      interrupted: Boolean(this._interrupts[role] && this._interrupts[role].requested),
    };
  }

  /**
   * Feature #22: Process a stdout chunk with line buffering.
   * Splits on '\n', keeps partial lines in buffer, parses complete lines.
   * Writes each line to agent log (with result events enriched by token estimates).
   * Emits 'agent-log' event with parsed results for WS broadcast.
   *
   * @param {string} role - Agent role (arch/dev/uat)
   * @param {string} chunk - Raw stdout chunk
   */
  _processStdoutChunk(role, chunk) {
    this._lineBuffers[role] += chunk;
    const buffer = this._lineBuffers[role];
    const lastNewline = buffer.lastIndexOf('\n');
    if (lastNewline === -1) return;

    const complete = buffer.substring(0, lastNewline);
    this._lineBuffers[role] = buffer.substring(lastNewline + 1);

    const lines = complete.split('\n');
    const parsedLines = [];
    const logLines = [];

    for (const line of lines) {
      if (!line.trim()) {
        logLines.push(line);
        continue;
      }

      const processedLine = this._processLineForStats(role, line);
      logLines.push(processedLine);

      const result = this.provider.parseStdoutLine(line);
      if (result) {
        const time = formatLogTime(new Date());
        for (const item of result) {
          parsedLines.push({ ...item, time });
        }
      }
    }

    // Write all processed lines to agent log (Feature #7)
    if (logLines.length > 0) {
      this.agentLogger.write(role, logLines.join('\n') + '\n');
    }

    if (parsedLines.length > 0) {
      this.emit('agent-log', { role, lines: parsedLines });
    }
  }

  /**
   * Process a single stream-json line for token estimation.
   * Accumulates char counts by event type. When a result event is encountered,
   * fills in the usage fields (originally 0 from CLI) with char-based estimates.
   *
   * @param {string} role - Agent role
   * @param {string} line - Complete JSON line
   * @returns {string} Original line, or enriched line if it's a result event
   */
  _processLineForStats(role, line) {
    const stats = this._sessionStats[role];
    if (!stats) return line;

    let parsed;
    try {
      parsed = JSON.parse(line.trim());
    } catch (e) {
      return line;
    }

    switch (parsed.type) {
      case 'system':
      case 'user':
        stats.inputChars += line.length;
        return line;

      case 'assistant': {
        stats.turns++;
        const blocks = parsed.message && parsed.message.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === 'thinking') {
              stats.thinkingChars += (block.thinking || '').length;
            } else if (block.type === 'redacted_thinking') {
              stats.thinkingChars += (block.data || '').length;
            } else if (block.type === 'text') {
              stats.outputChars += (block.text || '').length;
            } else if (block.type === 'tool_use') {
              stats.outputChars += JSON.stringify(block.input || {}).length;
            }
          }
        }
        return line;
      }

      case 'tool_result':
        stats.toolResultChars += line.length;
        return line;

      case 'result': {
        if (!parsed.usage) parsed.usage = {};
        parsed.usage.input_tokens = Math.round(stats.inputChars / 4);
        parsed.usage.output_tokens = Math.round((stats.outputChars + stats.thinkingChars) / 4);
        parsed._token_estimate = {
          input_chars: stats.inputChars,
          output_chars: stats.outputChars,
          tool_result_chars: stats.toolResultChars,
          thinking_chars: stats.thinkingChars,
          turns: stats.turns,
          duration_s: Math.round((Date.now() - stats.startTs) / 1000),
        };
        return JSON.stringify(parsed);
      }

      default:
        return line;
    }
  }

  /**
   * Feature #13: Clear all timers for graceful shutdown.
   */
  clearAllTimers() {
    for (const role of ['arch', 'dev', 'uat']) {
      this._clearTimers(role);
      if (this._retryTimers[role]) {
        clearTimeout(this._retryTimers[role]);
        this._retryTimers[role] = null;
      }
    }
  }

  /**
   * Feature #16: SIGTERM all currently tracked child processes.
   * Returns array of PIDs that were signalled.
   */
  killAllProcesses() {
    const killed = [];
    for (const role of ['arch', 'dev', 'uat']) {
      const proc = this.processes[role];
      if (proc && proc.pid) {
        try {
          process.kill(proc.pid, 'SIGTERM');
          killed.push({ role, pid: proc.pid });
        } catch (e) {
          // Process already gone
        }
      }
    }
    return killed;
  }
}

module.exports = AgentScheduler;
