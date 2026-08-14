/**
 * startDaemon - Start the Team3 daemon process and wait for WebSocket readiness.
 *
 * Co-exit design: daemon lives and dies with the web process.
 * - Web normal exit → SIGTERM all daemons via cleanup hook
 * - Web crash → daemon detects ppid change → self-exits
 * - Web restart → cleanup stale daemon via PID file before spawning new one
 *
 * Port allocation: each project gets a unique port derived from workspace path hash.
 */

import { spawn, ChildProcess, execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import WebSocket from "ws";

/** Default daemon port base */
const DEFAULT_PORT_BASE = 3100;

/** Port range for allocation (3100-3999) */
const PORT_RANGE = 900;

/** Timeout for waiting daemon to be ready (ms) */
const STARTUP_TIMEOUT_MS = 10000;

/** Retry interval for WebSocket connection (ms) */
const WS_RETRY_INTERVAL_MS = 200;

/** Max time to wait for old daemon to exit (ms) */
const CLEANUP_WAIT_MS = 3000;

/** Daemon registry — survives Next.js hot reload via globalThis */
const activeDaemons: Map<string, { pid: number; child: ChildProcess }> =
  ((globalThis as Record<string, unknown>).__team3_daemons as Map<string, { pid: number; child: ChildProcess }>) ??
  (() => {
    const m = new Map<string, { pid: number; child: ChildProcess }>();
    (globalThis as Record<string, unknown>).__team3_daemons = m;
    return m;
  })();

// Cleanup all daemons when web process exits
function cleanupAllDaemons() {
  for (const [, { pid }] of activeDaemons) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  }
}

let cleanupRegistered = false;
function ensureCleanupRegistered() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.on("exit", cleanupAllDaemons);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

export interface StartDaemonOptions {
  port?: number;
  daemonEntryPath?: string;
  timeoutMs?: number;
}

export interface StartDaemonResult {
  pid: number;
  port: number;
}

// Daemon relative path — JSON.parse is opaque to Turbopack static analysis
const _DAEMON_REL: string[] = JSON.parse('["..","daemon","src","orchestrator-entry.js"]');

function resolveDaemonEntry(): string {
  const pkgDir = process.env.TEAM3_PKG_DIR;
  if (pkgDir) {
    return path.join(pkgDir, "daemon.min.js");
  }
  return path.resolve(process.cwd(), ..._DAEMON_REL);
}

/**
 * Allocate a stable port for a workspace, derived from path hash.
 */
function allocatePort(workspacePath: string): number {
  const hash = crypto.createHash("md5").update(workspacePath).digest();
  return DEFAULT_PORT_BASE + (hash.readUInt16BE(0) % PORT_RANGE);
}

/**
 * Read daemon port from .team3-project.json, or allocate and save one.
 */
function getOrAllocatePort(projectJsonPath: string, workspacePath: string): number {
  try {
    const data = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
    if (data.daemon_port && typeof data.daemon_port === "number") {
      return data.daemon_port;
    }
    const port = allocatePort(workspacePath);
    data.daemon_port = port;
    fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    return port;
  } catch {
    return allocatePort(workspacePath);
  }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Kill a stale daemon process from a previous run.
 */
async function cleanupStaleDaemon(projectJsonPath: string): Promise<void> {
  try {
    const data = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
    const oldPid = parseInt(data.init_daemon, 10);
    if (!oldPid || !isAlive(oldPid)) return;

    process.kill(oldPid, "SIGTERM");
    const deadline = Date.now() + CLEANUP_WAIT_MS;
    while (Date.now() < deadline && isAlive(oldPid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (isAlive(oldPid)) {
      try { process.kill(oldPid, "SIGKILL"); } catch { /* gone */ }
    }
  } catch {
    // project json doesn't exist or parse error — nothing to clean
  }
}

/**
 * Wait for the daemon WebSocket to become ready.
 */
function waitForWsReady(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let resolved = false;

    function tryConnect() {
      if (resolved) return;
      if (Date.now() > deadline) {
        resolved = true;
        reject(new Error(`Daemon WebSocket not ready after ${timeoutMs}ms (port ${port})`));
        return;
      }

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      ws.on("message", (data) => {
        if (resolved) { ws.close(); return; }
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "connected") {
            resolved = true;
            ws.close();
            resolve();
          }
        } catch { /* ignore non-JSON */ }
      });

      ws.on("error", () => {
        ws.terminate();
        if (!resolved) setTimeout(tryConnect, WS_RETRY_INTERVAL_MS);
      });

      ws.on("close", () => {
        if (!resolved && Date.now() < deadline) {
          setTimeout(tryConnect, WS_RETRY_INTERVAL_MS);
        }
      });
    }

    tryConnect();
  });
}

function writePidToProjectJson(workspacePath: string, pid: number): void {
  const projectJsonPath = path.join(workspacePath, ".team3-project.json");
  if (!fs.existsSync(projectJsonPath)) {
    throw new Error(`.team3-project.json not found at ${projectJsonPath}`);
  }
  const data = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
  data.init_daemon = String(pid);
  fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Start the Team3 daemon process.
 */
export async function startDaemon(
  workspacePath: string,
  options: StartDaemonOptions = {}
): Promise<StartDaemonResult> {
  const daemonEntry = options.daemonEntryPath || resolveDaemonEntry();
  if (!fs.existsSync(daemonEntry)) {
    throw new Error(`Daemon entry not found: ${daemonEntry}`);
  }

  const absWorkspace = path.resolve(workspacePath);
  const projectJsonPath = path.join(absWorkspace, ".team3-project.json");
  const port = options.port || getOrAllocatePort(projectJsonPath, absWorkspace);
  const timeoutMs = options.timeoutMs || STARTUP_TIMEOUT_MS;

  ensureCleanupRegistered();

  // Clean up stale daemon from previous run (prevents port conflict)
  await cleanupStaleDaemon(projectJsonPath);

  // Ensure logs directory exists
  const logsDir = path.join(absWorkspace, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  // Redirect daemon stdout/stderr to log file (not pipe — prevents EPIPE on web exit)
  // Dated like other logs (daemon_/arch_ etc.); fd is fixed at spawn, so the date
  // reflects daemon start time — each restart opens/append the current day's file
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
  const logPath = path.join(logsDir, `daemon-stdout_${dateStr}.log`);
  const logFd = fs.openSync(logPath, "a");

  const child: ChildProcess = spawn(process.execPath, [daemonEntry], {
    env: {
      ...process.env,
      DAEMON_PORT: String(port),
      TEAM3_PROJECT_JSON: projectJsonPath,
    },
    stdio: ["ignore", logFd, logFd],
  });

  fs.closeSync(logFd);

  // Register in daemon registry
  if (child.pid) {
    activeDaemons.set(absWorkspace, { pid: child.pid, child });
  }

  child.on("exit", () => {
    activeDaemons.delete(absWorkspace);
  });

  // Reject if spawn fails immediately
  const spawnError = await new Promise<Error | null>((resolve) => {
    child.on("error", (err) => resolve(err));
    setTimeout(() => resolve(null), 300);
  });

  if (spawnError) {
    throw new Error(`Failed to spawn daemon: ${spawnError.message}`);
  }

  if (!child.pid) {
    throw new Error("Daemon process started but no PID assigned");
  }

  const pid = child.pid;

  // Wait for WebSocket to become ready
  let childExited = false;
  child.on("exit", () => { childExited = true; });

  try {
    await Promise.race([
      waitForWsReady(port, timeoutMs),
      new Promise<never>((_, reject) => {
        if (childExited) {
          reject(new Error("Daemon process exited before becoming ready"));
          return;
        }
        child.on("exit", (code) => {
          reject(new Error(`Daemon exited with code ${code} before ready`));
        });
      }),
    ]);
  } catch (err) {
    try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
    throw err;
  }

  writePidToProjectJson(absWorkspace, pid);

  return { pid, port };
}
