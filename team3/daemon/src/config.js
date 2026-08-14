'use strict';

const path = require('path');

/**
 * Daemon configuration
 * Port is configurable via DAEMON_PORT env var or defaults to 3100
 */
const config = {
  port: parseInt(process.env.DAEMON_PORT || '3100', 10),
  // Path to .team3-project.json (configurable for testing)
  // Default: project workspace root (daemon/ is at <workspace>/daemon/)
  projectJsonPath: process.env.TEAM3_PROJECT_JSON
    || path.resolve(__dirname, '../../.team3-project.json'),
  // Heartbeat interval in ms (default 10s)
  heartbeatInterval: parseInt(process.env.DAEMON_HEARTBEAT_INTERVAL || '10000', 10),
  // WebSocket ping interval in ms (default 30s)
  wsPingInterval: parseInt(process.env.DAEMON_WS_PING_INTERVAL || '30000', 10),

  // Feature #13: Claude process timeout + retry + dead letter
  // Per-role total timeout: arch=30min, dev/uat=60min
  // Role-specific env (CLAUDE_TIMEOUT_MS_DEV) takes priority over generic (CLAUDE_TIMEOUT_MS)
  claudeTimeoutMs: {
    arch: parseInt(process.env.CLAUDE_TIMEOUT_MS_ARCH || process.env.CLAUDE_TIMEOUT_MS || '1800000', 10),
    dev: parseInt(process.env.CLAUDE_TIMEOUT_MS_DEV || process.env.CLAUDE_TIMEOUT_MS || '3600000', 10),
    uat: parseInt(process.env.CLAUDE_TIMEOUT_MS_UAT || process.env.CLAUDE_TIMEOUT_MS || '3600000', 10),
  },
  // Grace period between SIGTERM and SIGKILL (default 5s)
  claudeKillGraceMs: parseInt(process.env.CLAUDE_KILL_GRACE_MS || '5000', 10),
  // Delay before retrying a failed execution (default 5s)
  claudeRetryDelayMs: parseInt(process.env.CLAUDE_RETRY_DELAY_MS || '5000', 10),
  // Maximum number of retries before dead letter (default 3)
  claudeMaxRetries: parseInt(process.env.CLAUDE_MAX_RETRIES || '3', 10),
  // Rebase archive-scan agent timeout (default 15min)
  rebaseTimeoutMs: parseInt(process.env.REBASE_TIMEOUT_MS || '900000', 10),
  // Feature #19: Per-role inactivity timeout: arch=5min, dev/uat=15min
  claudeInactivityTimeoutMs: {
    arch: parseInt(process.env.CLAUDE_INACTIVITY_TIMEOUT_MS_ARCH || process.env.CLAUDE_INACTIVITY_TIMEOUT_MS || '900000', 10),
    dev: parseInt(process.env.CLAUDE_INACTIVITY_TIMEOUT_MS_DEV || process.env.CLAUDE_INACTIVITY_TIMEOUT_MS || '900000', 10),
    uat: parseInt(process.env.CLAUDE_INACTIVITY_TIMEOUT_MS_UAT || process.env.CLAUDE_INACTIVITY_TIMEOUT_MS || '900000', 10),
  },
};

module.exports = config;
