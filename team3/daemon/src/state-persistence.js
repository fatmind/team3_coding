'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE = {
  lastProcessingOffset: 0,
  lastUpdated: null,
};

class StatePersistence {
  /**
   * @param {string} filePath - Path to .daemon-state.json
   * @param {Object} [options]
   * @param {number} [options.debounceMs] - Debounce interval for writes (default 200ms)
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.debounceMs = options.debounceMs ?? 200;
    this._state = { ...DEFAULT_STATE };
    this._timer = null;
    this._dirty = false;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this._state = {
        lastProcessingOffset: parsed.lastProcessingOffset ?? 0,
        lastUpdated: parsed.lastUpdated ?? null,
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Corrupted file — reset to defaults
      }
      this._state = { ...DEFAULT_STATE };
    }
    return this._state;
  }

  get state() {
    return this._state;
  }

  get lastProcessingOffset() {
    return this._state.lastProcessingOffset;
  }

  updateOffset(offset) {
    this._state.lastProcessingOffset = offset;
    this._scheduleSave();
  }

  _scheduleSave() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flush();
    }, this.debounceMs);
  }

  _flush() {
    if (!this._dirty) return;
    this._dirty = false;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    this._state.lastUpdated = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this._state, null, 2) + '\n');
    } catch (err) {
      // Best-effort — don't crash daemon for state persistence failure
    }
  }

  saveSync() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._dirty = true;
    this._flush();
  }

  destroy() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

module.exports = StatePersistence;
