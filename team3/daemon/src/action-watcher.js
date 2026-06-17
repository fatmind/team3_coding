'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const EventEmitter = require('events');

/**
 * ActionWatcher - Feature #3 + Feature #12 (JSONL repair)
 *
 * Watches actions.jsonl for new lines using chokidar.
 * Tracks file offset to only read new content (incremental).
 * Emits 'action' event for each valid parsed action line.
 *
 * Feature #12 additions:
 * - Multi-line JSON buffer: when a line fails parse, buffer consecutive lines
 *   until buffer.join('') forms valid JSON → emit action + schedule repair
 * - _repairFile(): debounce 500ms, greedy merge consecutive non-parseable lines
 *   into single-line JSONL, only repairs content from _repairSafeOffset onward
 * - Anti-recursion: record _expectedSize before writing, skip change events matching it
 *
 * Required fields: action, from, to, ts, message
 */
class ActionWatcher extends EventEmitter {
  /**
   * @param {string} filePath - Path to actions.jsonl
   * @param {Object} [options]
   * @param {Function} [options.watcherFactory] - Override chokidar.watch (for testing)
   * @param {number} [options.initialOffset] - Start reading from this offset (for replay after restart)
   * @param {Function} [options.onOffsetUpdate] - Called with new offset after each line is dispatched
   */
  constructor(filePath, options = {}) {
    super();
    this.filePath = filePath;
    this.watcherFactory = options.watcherFactory || null;
    this._initialOffset = options.initialOffset ?? null;
    this._onOffsetUpdate = options.onOffsetUpdate || null;
    this.watcher = null;
    this.offset = 0;
    this.isWatching = false;
    this._buffer = ''; // Buffer for incomplete lines (no trailing newline yet)

    // Feature #12: Multi-line JSON repair
    this._multiLineBuffer = []; // Buffer for consecutive parse-failed lines
    this._repairTimer = null;   // Debounce timer for _repairFile
    this._expectedSize = null;  // Anti-recursion: expected file size after repair write
    this._repairSafeOffset = 0; // Byte offset below which we don't repair
  }

  /**
   * Start watching the file.
   * If initialOffset was provided and is valid, starts from there (replay mode).
   * Otherwise initializes offset to current file size (only watch new content).
   */
  start() {
    if (this.isWatching) return;

    let fileSize = 0;
    try {
      const stat = fs.statSync(this.filePath);
      fileSize = stat.size;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (this._initialOffset !== null && this._initialOffset <= fileSize) {
      this.offset = this._initialOffset;
    } else if (this._initialOffset !== null && this._initialOffset > fileSize) {
      // File truncated since last run — reset to 0
      this.offset = 0;
    } else {
      this.offset = fileSize;
    }

    // Record the safe offset for repair (don't touch content before this)
    this._repairSafeOffset = this.offset;

    // Watch the file for changes
    if (this.watcherFactory) {
      this.watcher = this.watcherFactory(this.filePath);
    } else {
      this.watcher = chokidar.watch(this.filePath, {
        persistent: true,
        usePolling: false,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      });
    }

    this.watcher.on('change', () => {
      this._onFileChange();
    });

    // Also handle 'add' for when file is created after watcher starts
    this.watcher.on('add', () => {
      // Reset offset if file was recreated
      try {
        const stat = fs.statSync(this.filePath);
        if (stat.size < this.offset) {
          // File was truncated/recreated
          this.offset = 0;
          this._repairSafeOffset = 0;
        }
      } catch (err) {
        // ignore
      }
      this._onFileChange();
    });

    this.isWatching = true;
    this.emit('started');

    // Replay: if offset < fileSize, read missed content immediately
    if (this.offset < fileSize) {
      this._readNewContent();
    }
  }

  /**
   * Stop watching the file.
   */
  async stop() {
    if (!this.isWatching) return;
    this.isWatching = false;

    // Cancel pending repair
    if (this._repairTimer) {
      clearTimeout(this._repairTimer);
      this._repairTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.emit('stopped');
  }

  /**
   * Handle file change event with anti-recursion check.
   * Feature #12: skip events triggered by our own repair writes.
   */
  _onFileChange() {
    if (this._expectedSize !== null) {
      try {
        const stat = fs.statSync(this.filePath);
        if (stat.size === this._expectedSize) {
          this._expectedSize = null;
          return; // Skip — this change was caused by our repair write
        }
      } catch (err) {
        // File gone or stat failed — clear and continue
      }
      this._expectedSize = null;
    }
    this._readNewContent();
  }

  /**
   * Read new content from file starting at tracked offset.
   * Parse each complete line as JSON action.
   *
   * Feature #12: When a line fails JSON.parse, buffer consecutive lines.
   * When buffer.join('') forms valid JSON, emit the action and schedule repair.
   */
  _readNewContent() {
    let stat;
    try {
      stat = fs.statSync(this.filePath);
    } catch (err) {
      return; // File gone, ignore
    }

    if (stat.size <= this.offset) {
      // File truncated or no new content
      if (stat.size < this.offset) {
        this.offset = stat.size;
      }
      return;
    }

    // Read only the new bytes
    const fd = fs.openSync(this.filePath, 'r');
    const bytesToRead = stat.size - this.offset;
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, this.offset);
    fs.closeSync(fd);

    this.offset = stat.size;

    // Process the new content line by line
    const newContent = this._buffer + buffer.toString('utf-8');
    const lines = newContent.split('\n');

    // Last element might be incomplete (no trailing newline yet)
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      this._processLine(trimmed);
    }

    // Persist offset = file end minus unprocessed buffer bytes.
    // On restart, we re-read from this position, re-processing the last
    // complete batch (at-least-once). Buffer content is also re-read.
    const processedOffset = this.offset - Buffer.byteLength(this._buffer, 'utf-8');
    if (this._onOffsetUpdate) {
      this._onOffsetUpdate(processedOffset);
    }
  }

  /**
   * Process a single line with multi-line JSON buffering.
   * Feature #12: buffer consecutive parse-failed lines, try join(''),
   * emit when valid JSON formed.
   *
   * @param {string} trimmedLine - The trimmed line content
   */
  _processLine(trimmedLine) {
    // Try to parse this line as standalone JSON
    let standaloneValid = false;
    try {
      JSON.parse(trimmedLine);
      standaloneValid = true;
    } catch {
      // Not valid standalone
    }

    if (standaloneValid) {
      // This line is valid JSON on its own
      if (this._multiLineBuffer.length > 0) {
        // Flush orphaned buffer lines as parse errors
        for (const orphan of this._multiLineBuffer) {
          this.emit('parse-error', { line: orphan, error: 'Orphaned line (next valid line arrived before multi-line JSON completed)' });
        }
        this._multiLineBuffer = [];
      }
      // Process normally
      this._parseLine(trimmedLine);
    } else {
      // Line fails parse — add to multi-line buffer
      this._multiLineBuffer.push(trimmedLine);
      const joined = this._multiLineBuffer.join('');
      try {
        JSON.parse(joined);
        // Success! Multi-line JSON forms valid object
        this._multiLineBuffer = [];
        this._parseLine(joined);
        this._scheduleRepair();
      } catch {
        // Not yet complete, continue accumulating
      }
    }
  }

  /**
   * Parse a single line and emit 'action' event if valid.
   * Emits 'action' with (parsedObject, rawLineString) so consumers
   * can access the original JSONL text without re-serializing.
   */
  _parseLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      this.emit('parse-error', { line, error: err.message });
      return;
    }

    // Validate required fields
    const required = ['action', 'from', 'to', 'ts', 'message'];
    const missing = required.filter(f => parsed[f] === undefined || parsed[f] === null);

    if (missing.length > 0) {
      this.emit('validation-error', { parsed, missing });
      return;
    }

    this.emit('action', parsed, line);
  }

  /**
   * Schedule a file repair with 500ms debounce.
   * Feature #12: merge multi-line JSON back into single-line JSONL.
   */
  _scheduleRepair() {
    if (this._repairTimer) {
      clearTimeout(this._repairTimer);
    }
    this._repairTimer = setTimeout(() => {
      this._repairTimer = null;
      this._repairFile();
    }, 500);
    this.emit('repair-scheduled');
  }

  /**
   * Repair the file by greedy-merging consecutive non-parseable lines.
   * Feature #12:
   * - Only repairs content from _repairSafeOffset onward (preserves history)
   * - Records _expectedSize to prevent anti-recursion on change event
   * - Ensures file ends with newline
   */
  _repairFile() {
    try {
      const buf = fs.readFileSync(this.filePath);
      const prefix = buf.slice(0, this._repairSafeOffset);
      const suffix = buf.slice(this._repairSafeOffset).toString('utf-8');

      if (!suffix) return;

      const lines = suffix.split('\n');
      const repairedLines = [];
      let mergeBuffer = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          // Empty line: keep if no merge in progress
          if (mergeBuffer.length === 0) {
            repairedLines.push('');
          }
          continue;
        }

        // Try standalone parse
        let valid = false;
        try {
          JSON.parse(trimmed);
          valid = true;
        } catch {
          // Not valid standalone
        }

        if (valid) {
          // Flush orphaned merge buffer as-is
          if (mergeBuffer.length > 0) {
            repairedLines.push(...mergeBuffer);
            mergeBuffer = [];
          }
          repairedLines.push(trimmed);
        } else {
          // Accumulate in merge buffer
          mergeBuffer.push(trimmed);
          const joined = mergeBuffer.join('');
          try {
            JSON.parse(joined);
            // Success — merge into single line
            repairedLines.push(joined);
            mergeBuffer = [];
          } catch {
            // Not yet complete, continue accumulating
          }
        }
      }

      // Flush remaining merge buffer as-is
      if (mergeBuffer.length > 0) {
        repairedLines.push(...mergeBuffer);
        mergeBuffer = [];
      }

      let repairedSuffix = repairedLines.join('\n');
      // Ensure trailing newline
      if (repairedSuffix && !repairedSuffix.endsWith('\n')) {
        repairedSuffix += '\n';
      }

      const newBuf = Buffer.concat([prefix, Buffer.from(repairedSuffix, 'utf-8')]);

      // Only write if content actually changed
      if (!buf.equals(newBuf)) {
        this._expectedSize = newBuf.length;
        fs.writeFileSync(this.filePath, newBuf);
        // Update offset to new file size (file may be shorter after repair)
        this.offset = newBuf.length;
        this.emit('repaired', { oldSize: buf.length, newSize: newBuf.length });
      }
    } catch (err) {
      // Best-effort repair — don't crash if file is locked or gone
      this.emit('repair-error', { error: err.message });
    }
  }

  /**
   * Get current offset (for testing/debugging)
   */
  get currentOffset() {
    return this.offset;
  }
}

module.exports = ActionWatcher;
