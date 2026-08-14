'use strict';

const path = require('path');

/**
 * Resolve the {ref} directory — reference docs shipped inside the team3 package,
 * read by agents via the {ref} placeholder in system prompts (expanded at spawn).
 *
 * Packaged mode: $TEAM3_PKG_DIR/assets/ref
 * Dev mode: <repo>/human_coding
 */
function getRefDir() {
  if (process.env.TEAM3_PKG_DIR) {
    return path.join(process.env.TEAM3_PKG_DIR, 'assets', 'ref');
  }
  return path.resolve(__dirname, '..', '..', 'human_coding');
}

module.exports = { getRefDir };
