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

  let provider;
  switch (codeCliConfig.type) {
    case 'claude-code':
      provider = claudeCode;
      break;
    case 'qoder-code':
      provider = qoderCode;
      break;
    case 'qodercli':
      provider = qoderCode;
      break;
    default:
      throw new Error(`Unknown codeCli type: "${codeCliConfig.type}". Supported: claude-code, qoder-code`);
  }

  // Honor an optional `command` override so callers can swap the underlying CLI
  // binary (e.g. qodercli intl vs qoderclicn CN) purely via ~/.team3/config.json,
  // without editing the provider module. Return a shallow clone to avoid mutating
  // the shared singleton (methods are copied by reference).
  if (codeCliConfig.command && codeCliConfig.command !== provider.command) {
    provider = { ...provider, command: codeCliConfig.command };
  }
  return provider;
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
