'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');
const ProjectJson = require('./project-json');
const config = require('./config');
const { REREAD_REGEX } = require('./message-rewriter');
const claudeCodeProvider = require('./code-cli/claude-code');

const RESULT_FILENAME = 'rebase_log.md';

const REBASE_ACTIONS = new Set(['rebase']);

// System files under spec/ that keep daemon/tooling alive — the archive
// agent must never move them, and daemon verifies they survive execution.
// (lazada 事故: actions.jsonl 被归档，daemon HEALTH 连续 FAIL 触发自恢复)
const SYSTEM_FILES = ['spec/actions.jsonl', `spec/${RESULT_FILENAME}`];

// Matches a status header appended by the archive agent, e.g.
// "## 2026-07-28 18:00 | executed" / "## ... | cancelled"
const LOG_STATUS_RE = /^##[^\n|]*\|\s*(executed|cancelled)\s*$/m;

// System prompt for the archive agent session (replaces role prompt).
// The LLM both judges AND executes: stale content can be a whole file
// or a partial section, which only the LLM can tell apart.
const ARCHIVE_SYSTEM_PROMPT = `你是归档助手。人类推翻了项目方向（rebase），你负责清理被推翻的过期内容，避免污染后续上下文。

工作分两步，都在本会话内：
1. 提案：全局扫描 {cwd}/spec/ 下所有文件（*.md、*_feature_list.json、*_progress.txt、modules_progress.json 等派生文件同样是污染源），找出与新基准冲突或描述被推翻旧方向的内容——可能是整个文件过期，也可能只是文件中的局部段落过期。输出提案清单。此阶段绝不改动任何文件。
2. 人类确认后执行：
   - 整文件过期 → 移入 {cwd}/archive/
   - 局部过期 → 从原文件删除该部分，并把删除的内容存入 {cwd}/archive/（文件名带来源，保留取证）
   - 白名单（新基准）文件绝不可移动；对其局部修订需人类明确点名
   - 系统文件 spec/actions.jsonl、spec/${RESULT_FILENAME} 是 daemon 运转依赖，**绝不可移动/清空——即使人类点名要求也要拒绝并说明原因**（可建议人类用 cp 自行备份）；spec/decisions.md、spec/experience.md 只可局部清理废止条目，不可整文件归档
   执行完成后，必须在 {cwd}/spec/${RESULT_FILENAME} 末尾**追加**一条记录（只追加，不许改动已有内容），格式：
   ## <YYYY-MM-DD HH:mm> | executed
   - 新基准: <一句话>
   - 整文件归档: <file>（每个一行；没有则写 无）
   - 局部清理: <file> — <删除了什么>（每个一行；没有则写 无）
   - 说明: <一句话>
   人类取消则追加：
   ## <YYYY-MM-DD HH:mm> | cancelled
   - 原因: <一句话>

规矩：仍在讨论、未获确认/取消时，禁止写 ${RESULT_FILENAME}、禁止改动任何文件；判断不了的不要动——宁可漏归档，不可误归档。`;

/**
 * RebaseHandler — collaboration.md 改进项 0「过期及时清理」
 *
 * Single message format [rebase: xxx]. Daemon keeps the sequence:
 *
 *   1. no pending rebase → the message is a new baseline:
 *      spawn an archive agent (fresh session) to scan spec/*.md and
 *      reply with a proposal (whole-file AND partial staleness — the
 *      LLM judges and later executes, daemon never moves files itself)
 *   2. pending rebase → the message is a reply to the archive agent
 *      (确认 / 调整 / 取消, plain language), resumed in the SAME session
 *   3. when the agent has executed (or cancelled) it APPENDS an entry
 *      to spec/rebase_log.md (append-only, one project accumulates all
 *      rebases there). Daemon records the log size before each run and
 *      inspects only the newly appended part — that is the only signal:
 *      "| executed" → clear the target role session → re-dispatch the
 *      original rebase message as the first message of a fresh session
 *
 * Pending state is persisted in .team3-project.json under `rebase`
 * so a daemon restart doesn't lose an in-flight rebase.
 */
class RebaseHandler extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} options.workspaceDir - Workspace root
   * @param {string} options.specDir - Path to spec/
   * @param {string} options.actionsFilePath - Path to actions.jsonl
   * @param {string} options.projectJsonPath - Path to .team3-project.json
   * @param {Function} [options.spawnFn] - Override spawn (for testing)
   * @param {Function} [options.uuidFn] - Override UUID generator (for testing)
   * @param {Object} [options.provider] - CodeCli provider
   * @param {number} [options.rebaseTimeoutMs] - Archive agent timeout
   * @param {number} [options.killGraceMs] - SIGTERM→SIGKILL grace
   */
  constructor(options = {}) {
    super();
    this.workspaceDir = options.workspaceDir;
    this.specDir = options.specDir || path.join(this.workspaceDir, 'spec');
    this.actionsFilePath = options.actionsFilePath || path.join(this.specDir, 'actions.jsonl');
    this.projectJsonPath = options.projectJsonPath || path.join(this.workspaceDir, '.team3-project.json');
    this.spawnFn = options.spawnFn || spawn;
    this.uuidFn = options.uuidFn || randomUUID;
    this.provider = options.provider || claudeCodeProvider;
    this.rebaseTimeoutMs = options.rebaseTimeoutMs != null ? options.rebaseTimeoutMs : config.rebaseTimeoutMs;
    this.killGraceMs = options.killGraceMs != null ? options.killGraceMs : config.claudeKillGraceMs;

    this._proc = null;
    this._timeoutTimer = null;
    this._killTimer = null;
  }

  static get REBASE_ACTIONS() {
    return REBASE_ACTIONS;
  }

  get logPath() {
    return path.join(this.specDir, RESULT_FILENAME);
  }

  /**
   * Entry point. One format, state decides the meaning:
   * no pending → new rebase; pending → reply to the archive agent.
   * @param {Object} action - Parsed action from actions.jsonl
   */
  handle(action) {
    if (action.action !== 'rebase') {
      this.emit('skip', { action, reason: 'not a rebase action' });
      return;
    }
    if (this._proc) {
      this._writeToHuman('归档 Agent 正在执行中，请等它回复后再发 [rebase: ...]。');
      return;
    }

    const pending = this._readPending();
    if (!pending) {
      this._startNew(action);
    } else {
      this._resume(pending, action.message);
    }
  }

  /**
   * Phase 1: new baseline — spawn archive agent to scan and propose.
   */
  _startNew(action) {
    const role = this._targetRole();
    const whitelist = this._extractWhitelist(action.message);
    const sessionId = this.uuidFn();

    const pending = {
      sessionId,
      role,
      message: action.message,
      whitelist,
      // Snapshot which system files exist now — verify they survive later
      systemFiles: SYSTEM_FILES.filter((f) => fs.existsSync(path.resolve(this.workspaceDir, f))),
      ts: Math.floor(Date.now() / 1000),
    };
    this._savePending(pending);

    const prompt = [
      '人类发起 rebase，新基准如下：',
      '',
      action.message,
      '',
      `白名单（新基准文档，绝不移动）：${whitelist.length > 0 ? whitelist.join(', ') : '（无）'}`,
      '',
      '现在执行第 1 步（提案）：先读白名单文档理解新方向，再逐个检查 spec/ 下其余所有文件',
      '（含 *.md、*_feature_list.json、*_progress.txt、modules_progress.json 等），',
      '输出归档提案清单，格式：',
      '- 整文件归档：<file> — 理由（≤50字）',
      '- 局部清理：<file> — 哪一段、为什么',
      '本轮只输出提案文本，不改任何文件，不写 rebase_log.md。',
    ].join('\n');

    this.emit('scan-start', { role, whitelist });
    this._spawnAgent({ pending, prompt, isNew: true, phase: 'propose' });
  }

  /**
   * Pending exists — the message is a reply to the archive agent
   * (确认 / 调整 / 取消). Resume the same session, let the LLM decide.
   */
  _resume(pending, humanMessage) {
    const prompt = [
      '人类回复：',
      '',
      humanMessage,
      '',
      '按系统提示处理：确认执行 → 执行归档并在 spec/' + RESULT_FILENAME + ' 末尾追加 executed 记录；',
      '调整意见 → 更新提案文本回复，不改文件；取消 → 追加 cancelled 记录。',
    ].join('\n');

    this.emit('resume', { sessionId: pending.sessionId });
    this._spawnAgent({ pending, prompt, isNew: false, phase: 'resume' });
  }

  /**
   * Spawn the archive agent CLI (new session or resume) and handle exit.
   * Records the rebase log size before the run — only content appended
   * after this offset counts as this run's outcome.
   */
  _spawnAgent({ pending, prompt, isNew, phase }) {
    const logOffset = this._fileSize(this.logPath);
    const args = this.provider.buildArgs({
      prompt,
      sessionId: pending.sessionId,
      isNew,
      role: pending.role,
      workspaceDir: this.workspaceDir,
      systemPromptOverride: ARCHIVE_SYSTEM_PROMPT.replace(/\{cwd\}/g, this.workspaceDir),
    });

    const proc = this.spawnFn(this.provider.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: this.workspaceDir,
    });
    this._proc = proc;

    let stdout = '';
    let stderr = '';
    if (proc.stdout) {
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
    }
    if (proc.stderr) {
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
    }

    this._timeoutTimer = setTimeout(() => {
      this.emit('agent-timeout', { timeoutMs: this.rebaseTimeoutMs, phase });
      try { proc.kill('SIGTERM'); } catch (e) { /* gone */ }
      this._killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (e) { /* gone */ }
        this._killTimer = null;
      }, this.killGraceMs);
    }, this.rebaseTimeoutMs);

    proc.on('close', (code, signal) => {
      this._clearTimers();
      this._proc = null;
      const effectiveCode = (code === null && signal) ? 1 : code;
      this._onAgentExit({ pending, phase, effectiveCode, signal, stdout, stderr, logOffset });
    });

    proc.on('error', (err) => {
      this._clearTimers();
      this._proc = null;
      this._savePending(null);
      this._writeToHuman(`rebase 归档 Agent 启动失败：${err.message}，本次 rebase 已取消，请重发。`);
      this.emit('agent-failed', { error: err.message, phase });
    });
  }

  /**
   * Agent run finished. The newly appended rebase_log.md entry is the
   * ONLY execution signal: "| executed" / "| cancelled" header found →
   * finalize; nothing appended → still conversing, forward the reply.
   */
  _onAgentExit({ pending, phase, effectiveCode, signal, stdout, stderr, logOffset }) {
    if (effectiveCode !== 0) {
      if (phase === 'propose') {
        // First scan failed — nothing happened yet, drop the rebase
        this._savePending(null);
        this._writeToHuman(`rebase 归档扫描失败（exit ${effectiveCode}${signal ? `, ${signal}` : ''}），本次 rebase 已取消，请重发。${stderr ? ` stderr: ${stderr.substring(0, 200)}` : ''}`);
      } else {
        // Mid-conversation failure — keep pending, same session can recover
        this._writeToHuman(`rebase 归档 Agent 本轮执行失败（exit ${effectiveCode}${signal ? `, ${signal}` : ''}），rebase 仍在进行中，可发 [rebase: 继续] 重试，或 [rebase: 取消]。`);
      }
      this.emit('agent-failed', { exitCode: effectiveCode, signal, phase });
      return;
    }

    const entry = this._readNewLogEntry(logOffset);
    if (entry) {
      if (entry.status === 'executed') {
        this._finalizeExecuted(pending, entry);
      } else {
        this._savePending(null);
        this._writeToHuman(`rebase 已取消，session 保持不变。\n${entry.text.trim()}`);
        this.emit('cancelled', { pending, entry });
      }
      return;
    }

    // No new log entry — conversation continues, forward the agent's reply
    const replyText = this.provider.extractResult(stdout);
    if (!replyText) {
      this._writeToHuman('rebase 归档 Agent 没有产出回复，rebase 仍在进行中，可发 [rebase: 继续] 重试，或 [rebase: 取消]。');
      this.emit('agent-failed', { reason: 'no reply text', phase });
      return;
    }

    const hint = phase === 'propose'
      ? '\n\n——回复 [rebase: 确认] 执行归档，[rebase: 取消] 放弃，或 [rebase: ...] 直接说调整意见。'
      : '\n\n——继续用 [rebase: ...] 回复。';
    this._writeToHuman(replyText + hint);
    this.emit('awaiting-reply', { pending, phase });
  }

  /**
   * Archive executed — verify whitelist survived, clear the role session,
   * re-dispatch the original rebase message into a fresh session.
   */
  _finalizeExecuted(pending, entry) {
    // Whitelist files must still exist (daemon can at least check moves)
    const lost = (pending.whitelist || []).filter((f) => {
      return !fs.existsSync(path.resolve(this.workspaceDir, f));
    });
    // System files keep daemon alive — one going missing is a P0
    const systemLost = (pending.systemFiles || SYSTEM_FILES).filter((f) => {
      return !fs.existsSync(path.resolve(this.workspaceDir, f));
    });

    this._clearSession(pending.role);
    this._savePending(null);

    const lines = ['rebase 归档完成：', entry.text.trim()];
    if (lost.length > 0) {
      lines.push(`⚠️ 白名单文件缺失，请立即检查 archive/ 找回：${lost.join(', ')}`);
    }
    if (systemLost.length > 0) {
      lines.push(`🚨 系统文件被归档，daemon 会异常，请立即从 archive/ 移回：${systemLost.join(', ')}`);
    }
    lines.push(`${pending.role} session 已置空，重启消息已派发给 ${pending.role}。`);
    this._writeToHuman(lines.join('\n'));

    // Fresh session bootstrap: daemon speaks as itself. The original rebase
    // text is NOT replayed — the archive agent already executed it.
    this._appendAction({
      action: 'to_arch',
      from: 'T3',
      to: pending.role,
      ts: Math.floor(Date.now() / 1000),
      message: [
        '方向已调整（rebase），过期内容已归档处理完毕（结果见 spec/rebase_log.md）。',
        '请先重新建立项目全局认识：按「全局要求」顺序重读 spec/ 文件，以当前 spec/ 内容为唯一基准，不要引用任何已归档内容。',
      ].join('\n'),
    });

    this.emit('executed', { pending, entry, whitelistLost: lost });
  }

  // ---------- helpers ----------

  _targetRole() {
    // rebase 只对 arch 有意义：只有 arch 是长 session、背历史；
    // dev/uat 每任务天然新 session，方向变了由 arch 重新派发即可。
    return 'arch';
  }

  /**
   * Files listed in [reread: ...] are the new baseline — whitelist.
   */
  _extractWhitelist(message) {
    const match = (message || '').match(REREAD_REGEX);
    if (!match) return [];
    return match[1].split(',').map((f) => f.trim()).filter(Boolean);
  }

  _fileSize(filePath) {
    try {
      return fs.statSync(filePath).size;
    } catch (err) {
      return 0;
    }
  }

  /**
   * Read what this run appended to rebase_log.md (beyond logOffset).
   * Returns { status: 'executed'|'cancelled', text } or null if nothing
   * conclusive was appended.
   */
  _readNewLogEntry(logOffset) {
    const size = this._fileSize(this.logPath);
    if (size <= logOffset) return null;
    let text;
    try {
      const fd = fs.openSync(this.logPath, 'r');
      const buf = Buffer.alloc(size - logOffset);
      fs.readSync(fd, buf, 0, buf.length, logOffset);
      fs.closeSync(fd);
      text = buf.toString('utf-8');
    } catch (err) {
      return null;
    }
    const match = text.match(LOG_STATUS_RE);
    if (!match) return null;
    return { status: match[1], text };
  }

  /**
   * Archive the running session id and clear it. Next dispatch to this
   * role will generate a fresh session that only reads the new baseline.
   */
  _clearSession(role) {
    const projectJson = new ProjectJson(this.projectJsonPath);
    const data = projectJson.read();
    if (!data.partner) data.partner = {};
    const agentKey = `${role}_agent`;
    if (!data.partner[agentKey]) data.partner[agentKey] = {};
    if (!data.partner[agentKey].session) data.partner[agentKey].session = {};

    const session = data.partner[agentKey].session;
    if (session.runing) {
      if (!session.done) session.done = [];
      session.done.push(session.runing);
    }
    session.runing = '';
    if (role === 'arch') {
      session.bound_module = null;
    }
    projectJson.write(data);
    this.emit('session-cleared', { role });
  }

  _savePending(pending) {
    const projectJson = new ProjectJson(this.projectJsonPath);
    const data = projectJson.read();
    if (pending === null) {
      delete data.rebase;
    } else {
      data.rebase = pending;
    }
    projectJson.write(data);
  }

  _readPending() {
    try {
      const projectJson = new ProjectJson(this.projectJsonPath);
      const data = projectJson.read();
      return data.rebase || null;
    } catch (err) {
      return null;
    }
  }

  _writeToHuman(message) {
    this._appendAction({
      action: 'to_human',
      from: 'T3',
      to: 'human',
      ts: Math.floor(Date.now() / 1000),
      message,
    });
  }

  _appendAction(actionObj) {
    try {
      fs.appendFileSync(this.actionsFilePath, JSON.stringify(actionObj) + '\n');
    } catch (err) {
      this.emit('error', { error: err.message, context: 'rebase-append-action' });
    }
  }

  _clearTimers() {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
    if (this._killTimer) {
      clearTimeout(this._killTimer);
      this._killTimer = null;
    }
  }

  /**
   * Graceful shutdown — kill in-flight archive agent.
   */
  stop() {
    this._clearTimers();
    if (this._proc) {
      try { this._proc.kill('SIGTERM'); } catch (e) { /* gone */ }
      this._proc = null;
    }
  }
}

module.exports = RebaseHandler;
