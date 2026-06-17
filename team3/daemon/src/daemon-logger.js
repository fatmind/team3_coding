'use strict';

const fs = require('fs');
const path = require('path');

/**
 * DaemonLogger - Feature #18
 *
 * Structured event logging for daemon lifecycle.
 * Writes to <workspace>/logs/daemon.log with timestamped tagged lines.
 * Tags: [START] [STOP] [WATCH] [ROUTE] [DISPATCH] [DONE] [TIMEOUT] [RETRY] [DEAD_LETTER] [WS] [ERROR] [HEALTH]
 */
class DaemonLogger {
  constructor(options = {}) {
    this.logDir = options.logDir;
    this._stream = null;
  }

  _ensureStream() {
    if (this._stream) return;
    if (!this.logDir) return;
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    const logPath = path.join(this.logDir, 'daemon.log');
    this._stream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  _formatTs() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  _write(tag, msg) {
    const ts = this._formatTs();
    const line = `[${ts}] [${tag}] ${msg}\n`;
    process.stdout.write(line);
    this._ensureStream();
    if (this._stream) {
      this._stream.write(line);
    }
  }

  start(info) {
    this._write('START', `port=${info.port} workspace=${info.workspaceDir} pid=${process.pid}`);
  }

  stop() {
    this._write('STOP', `pid=${process.pid}`);
  }

  watch(action) {
    const preview = JSON.stringify(action).slice(0, 200);
    this._write('WATCH', `new_line=${preview}`);
  }

  route(action) {
    this._write('ROUTE', `from=${action.from} to=${action.to} action=${action.action}`);
  }

  dispatch(info) {
    const msgPreview = (info.prompt || '').slice(0, 80);
    this._write('DISPATCH', `role=${info.role} session=${info.sessionId || '?'} msg_preview="${msgPreview}"`);
  }

  done(info) {
    this._write('DONE', `role=${info.role} exit_code=${info.exitCode} timedOut=${info.timedOut || false}`);
  }

  timeout(info) {
    this._write('TIMEOUT', `role=${info.role} timeoutMs=${info.timeoutMs}`);
  }

  retry(info) {
    this._write('RETRY', `role=${info.role} attempt=${info.retryCount}/${info.maxRetries}`);
  }

  deadLetter(info) {
    this._write('DEAD_LETTER', `role=${info.role} reason=${info.reason} msg_preview="${(info.message || '').slice(0, 80)}"`);
  }

  ws(msg) {
    this._write('WS', msg);
  }

  error(msg) {
    this._write('ERROR', typeof msg === 'string' ? msg : msg.message || JSON.stringify(msg));
  }

  health(msg) {
    this._write('HEALTH', msg);
  }

  destroy() {
    if (this._stream) {
      this._stream.end();
      this._stream = null;
    }
  }
}

module.exports = DaemonLogger;
