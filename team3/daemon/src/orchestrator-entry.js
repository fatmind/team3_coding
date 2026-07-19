#!/usr/bin/env node
'use strict';

/**
 * orchestrator-entry.js - Standalone entry point for DaemonOrchestrator
 *
 * Starts the full daemon pipeline:
 *   Daemon (WS server) + ActionWatcher + AgentScheduler + MessageRouter
 *
 * Environment variables:
 *   DAEMON_PORT           - WebSocket port (default 3100)
 *   TEAM3_PROJECT_JSON    - Path to .team3-project.json
 *   STUB_CLAUDE_PATH      - If set, use this script instead of real 'claude' CLI
 *   TEAM3_ACTIONS_PATH    - Path to actions.jsonl (default: derived from TEAM3_PROJECT_JSON)
 *   TEAM3_SPEC_DIR        - Path to spec/ directory (default: derived from TEAM3_PROJECT_JSON)
 *
 * Note: TEAM3_ACTIONS_PATH and TEAM3_SPEC_DIR default to sibling paths of TEAM3_PROJECT_JSON:
 *   projectJsonPath = /some/path/.team3-project.json
 *   actionsFilePath = /some/path/spec/actions.jsonl
 *   specDir         = /some/path/spec/
 */

const path = require('path');
const { spawn } = require('child_process');
const DaemonOrchestrator = require('./daemon-orchestrator');
const config = require('./config');
const { loadCodeCliConfig, loadProvider } = require('./code-cli');

// Resolve paths
const projectJsonPath = process.env.TEAM3_PROJECT_JSON || config.projectJsonPath;
const workspaceDir = path.dirname(projectJsonPath);
const actionsFilePath = process.env.TEAM3_ACTIONS_PATH || path.join(workspaceDir, 'spec', 'actions.jsonl');
const specDir = process.env.TEAM3_SPEC_DIR || path.join(workspaceDir, 'spec');
const modulesProgressPath = path.join(specDir, 'modules_progress.json');

// Load CodeCli provider from ~/.team3/config.json
let provider;
try {
  const codeCliConfig = loadCodeCliConfig();
  provider = loadProvider(codeCliConfig);
  console.log(`[Orchestrator] CodeCli provider: ${provider.name} (${provider.command})`);
} catch (err) {
  console.error(`[Orchestrator] Failed to load CodeCli config: ${err.message}`);
  console.error('[Orchestrator] Falling back to claude-code provider');
  provider = require('./code-cli/claude-code');
}

// Build spawnFn if STUB_CLAUDE_PATH is set
let spawnFn;
if (process.env.STUB_CLAUDE_PATH) {
  const stubPath = process.env.STUB_CLAUDE_PATH;
  spawnFn = (cmd, args, opts) => {
    return spawn('node', [stubPath, ...args], {
      ...opts,
      env: {
        ...opts.env,
        STUB_CLAUDE_ACTIONS_PATH: actionsFilePath,
      },
    });
  };
}

// Create and start orchestrator
const orchestrator = new DaemonOrchestrator({
  port: config.port,
  projectJsonPath,
  workspaceDir,
  actionsFilePath,
  specDir,
  modulesProgressPath,
  spawnFn,
  provider,
});

orchestrator.start().then(() => {
  console.log(`[Orchestrator] Started on port ${config.port} (PID: ${process.pid})`);
  console.log(`[Orchestrator] Watching: ${actionsFilePath}`);
  console.log(`[Orchestrator] Spec dir: ${specDir}`);
  if (process.env.STUB_CLAUDE_PATH) {
    console.log(`[Orchestrator] Using stub: ${process.env.STUB_CLAUDE_PATH}`);
  }
}).catch((err) => {
  console.error(`[Orchestrator] Failed to start: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown with reentrancy guard
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  orchestrator.stop().then(() => {
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Crash handlers — save state before dying
process.on('uncaughtException', (err) => {
  try {
    orchestrator.logger.error(`FATAL uncaughtException: ${err.message}`);
    orchestrator.statePersistence.saveSync();
  } catch (e) { /* best effort */ }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  try {
    orchestrator.logger.error(`FATAL unhandledRejection: ${reason}`);
    orchestrator.statePersistence.saveSync();
  } catch (e) { /* best effort */ }
  process.exit(1);
});

// Orphan detection — if parent (web) dies, ppid changes to 1 (launchd/init)
const parentPid = process.ppid;
const orphanCheck = setInterval(() => {
  if (process.ppid !== parentPid) {
    console.log('[Orchestrator] Parent process died, shutting down');
    shutdown();
  }
}, 5000);
orphanCheck.unref();
