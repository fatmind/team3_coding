'use strict';

const fs = require('fs');
const path = require('path');

/**
 * AgentLogger - Feature #7
 *
 * Manages per-agent, per-day log files for recording claude code's
 * stream-json raw stdout output.
 *
 * Responsibilities:
 * - Create log files on demand: logs/<role>_<YYYY-MM-DD>.log
 * - Detect date changes and roll to new file automatically
 * - Provide a writable stream pipe target for child process stdout
 * - Clean up file descriptors on stop
 *
 * Usage:
 *   const logger = new AgentLogger({ logDir: 'daemon/logs' });
 *   // When spawning a child process:
 *   const stream = logger.getStream('arch');
 *   childProcess.stdout.pipe(stream);
 *   // Later:
 *   logger.close('arch');
 */
class AgentLogger {
  /**
   * @param {Object} [options]
   * @param {string} [options.logDir] - Directory for log files (default: daemon/logs)
   * @param {Function} [options.dateProvider] - Override date for testing (returns 'YYYY-MM-DD')
   */
  constructor(options = {}) {
    this.logDir = options.logDir || path.resolve(__dirname, '../logs');
    this.dateProvider = options.dateProvider || (() => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    });

    // Track open streams per role: { role: { date, stream, fd } }
    this._streams = {};
  }

  /**
   * Get the current date string from the provider.
   * @returns {string} 'YYYY-MM-DD'
   */
  _getCurrentDate() {
    return this.dateProvider();
  }

  /**
   * Build the log file path for a given role and date.
   * @param {string} role - 'arch', 'dev', or 'uat'
   * @param {string} date - 'YYYY-MM-DD'
   * @returns {string} Full path like logs/arch_2026-05-25.log
   */
  getLogPath(role, date) {
    return path.join(this.logDir, `${role}_${date}.log`);
  }

  /**
   * Get a writable stream for a given agent role.
   * If the date has changed since the last call, rolls over to a new file.
   *
   * @param {string} role - 'arch', 'dev', or 'uat'
   * @returns {fs.WriteStream} A writable stream to pipe stdout into
   */
  getStream(role) {
    const currentDate = this._getCurrentDate();
    const existing = this._streams[role];

    // If we already have a stream for the same date, reuse it
    if (existing && existing.date === currentDate && !existing.stream.destroyed) {
      return existing.stream;
    }

    // Close old stream if date changed
    if (existing && existing.stream && !existing.stream.destroyed) {
      existing.stream.end();
    }

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Create new write stream (append mode)
    const logPath = this.getLogPath(role, currentDate);
    const stream = fs.createWriteStream(logPath, { flags: 'a' });

    this._streams[role] = { date: currentDate, stream, path: logPath };
    return stream;
  }

  /**
   * Write data to the agent's log stream.
   * Handles date rollover automatically.
   *
   * @param {string} role - 'arch', 'dev', or 'uat'
   * @param {string|Buffer} data - Data to write
   */
  write(role, data) {
    const stream = this.getStream(role);
    stream.write(data);
  }

  /**
   * Close the stream for a given role.
   * @param {string} role - 'arch', 'dev', or 'uat'
   */
  close(role) {
    const existing = this._streams[role];
    if (existing && existing.stream && !existing.stream.destroyed) {
      existing.stream.end();
    }
    delete this._streams[role];
  }

  /**
   * Close all open streams.
   */
  closeAll() {
    for (const role of Object.keys(this._streams)) {
      this.close(role);
    }
  }

  /**
   * Check if a role currently has an open stream.
   * @param {string} role
   * @returns {boolean}
   */
  hasStream(role) {
    const existing = this._streams[role];
    return !!(existing && existing.stream && !existing.stream.destroyed);
  }

  /**
   * Get info about current streams (for debugging/testing).
   * @returns {Object} Map of role → { date, path }
   */
  getInfo() {
    const info = {};
    for (const [role, entry] of Object.entries(this._streams)) {
      if (entry.stream && !entry.stream.destroyed) {
        info[role] = { date: entry.date, path: entry.path };
      }
    }
    return info;
  }
}

module.exports = AgentLogger;
