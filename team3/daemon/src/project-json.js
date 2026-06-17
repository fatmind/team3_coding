'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Reads and writes .team3-project.json
 * Handles atomic updates to avoid corruption
 */
class ProjectJson {
  constructor(filePath) {
    this.filePath = filePath;
  }

  /**
   * Read and parse the project json file
   * Creates the file with defaults if it doesn't exist
   */
  read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // File doesn't exist, create with defaults
        const defaults = {};
        this.write(defaults);
        return defaults;
      }
      throw err;
    }
  }

  /**
   * Write data back to project json file (atomic write via rename)
   */
  write(data) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  /**
   * Update specific fields in the project json
   */
  update(fields) {
    const data = this.read();
    Object.assign(data, fields);
    this.write(data);
    return data;
  }
}

module.exports = ProjectJson;
