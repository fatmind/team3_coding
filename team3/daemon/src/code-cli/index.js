'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const claudeCode = require('./claude-code');
const qoderCode = require('./qoder-code');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.team3', 'config.json');

/**
 * Load provider based on config type.
 * @param {Object} codeCliConfig - { type, command? }
 * @returns {Object} provider with { name, command, buildArgs, parseStdoutLine, extractResult, isMissingSessionError }
 */
function loadProvider(codeCliConfig) {
  if (!codeCliConfig || !codeCliConfig.type) {
    throw new Error('codeCli config missing or missing "type" field');
  }

  switch (codeCliConfig.type) {
    case 'claude-code':
      return claudeCode;
    case 'qoder-code':
      return qoderCode;
    case 'qodercli':
      return qoderCode;
    default:
      throw new Error(`Unknown codeCli type: "${codeCliConfig.type}". Supported: claude-code, qoder-code`);
  }
}

/**
 * Read ~/.team3/config.json and return codeCli config section.
 * @returns {Object} codeCli config
 */
function loadCodeCliConfig(configPath) {
  const filePath = configPath || GLOBAL_CONFIG_PATH;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Global config not found: ${filePath}. Run team3 init to create it.`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const config = JSON.parse(raw);
  if (!config.codeCli) {
    throw new Error(`"codeCli" section missing in ${filePath}`);
  }
  return config.codeCli;
}

module.exports = { loadProvider, loadCodeCliConfig, GLOBAL_CONFIG_PATH };
