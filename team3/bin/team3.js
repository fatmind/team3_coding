#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..');
const TEAM3_HOME = path.join(require('os').homedir(), '.team3');
const PID_FILE = path.join(TEAM3_HOME, 'web.pid');
const LOG_FILE = path.join(TEAM3_HOME, 'logs', 'web.log');
const DEFAULT_PORT = 3000;

function ensureDirs() {
  fs.mkdirSync(path.join(TEAM3_HOME, 'logs'), { recursive: true });
}

function readPid() {
  try {
    return parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function start(port, superman) {
  ensureDirs();

  const existingPid = readPid();
  if (existingPid && isAlive(existingPid)) {
    console.log(`team3 is already running (PID ${existingPid}). Use "team3 stop" first.`);
    process.exit(1);
  }

  const serverEntry = path.join(PKG_DIR, 'server', 'server.js');
  if (!fs.existsSync(serverEntry)) {
    console.error(`Server entry not found: ${serverEntry}`);
    console.error('Did you run "bash build/build.sh" first?');
    process.exit(1);
  }

  const logFd = fs.openSync(LOG_FILE, 'a');

  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: '0.0.0.0',
    TEAM3_PKG_DIR: PKG_DIR,
  };
  if (superman) env.TEAM3_SUPERMAN = '1';

  const child = spawn('node', [serverEntry], {
    cwd: path.dirname(serverEntry),
    env,
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });

  fs.closeSync(logFd);

  if (!child.pid) {
    console.error('Failed to start server process.');
    process.exit(1);
  }

  fs.writeFileSync(PID_FILE, String(child.pid), 'utf-8');
  child.unref();

  console.log(`team3 started (PID ${child.pid}) on port ${port}${superman ? ' [SUPERMAN]' : ''}`);
  console.log(`  URL:  http://localhost:${port}`);
  console.log(`  Log:  ${LOG_FILE}`);
  console.log(`  PID:  ${PID_FILE}`);
}

function stop() {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    console.log('team3 is not running.');
    try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
    return;
  }

  process.kill(pid, 'SIGTERM');
  console.log(`Sent SIGTERM to PID ${pid}.`);

  // Wait up to 5s for clean exit
  const deadline = Date.now() + 5000;
  const poll = setInterval(() => {
    if (!isAlive(pid)) {
      clearInterval(poll);
      try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
      console.log('team3 stopped.');
      return;
    }
    if (Date.now() > deadline) {
      clearInterval(poll);
      try { process.kill(pid, 'SIGKILL'); } catch { /* ok */ }
      try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
      console.log('team3 force-killed.');
    }
  }, 200);
}

function version() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8'));
    console.log(`team3 v${pkg.version}`);
  } catch {
    console.log('team3 (version unknown)');
  }
}

function usage() {
  console.log(`Usage: team3 <command> [options]

Commands:
  start [-p PORT] [--superman]   Start team3 web server (default port: ${DEFAULT_PORT})
  stop                           Stop the running server
  version                        Show version

Options:
  --superman   Agents run with --dangerously-skip-permissions
`);
}

// --- Parse args ---
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'start': {
    let port = DEFAULT_PORT;
    const pIdx = args.indexOf('-p');
    if (pIdx !== -1 && args[pIdx + 1]) {
      port = parseInt(args[pIdx + 1], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${args[pIdx + 1]}`);
        process.exit(1);
      }
    }
    const superman = args.includes('--superman');
    start(port, superman);
    break;
  }
  case 'stop':
    stop();
    break;
  case 'version':
  case '--version':
  case '-v':
    version();
    break;
  default:
    usage();
    break;
}
