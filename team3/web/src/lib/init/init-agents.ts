/**
 * initAgents - Initialize arch agent through DaemonOrchestrator.
 *
 * Flow:
 * 1. Start DaemonOrchestrator (full pipeline: WS + ActionWatcher + AgentScheduler)
 * 2. Write init action to spec/actions.jsonl (triggers AgentScheduler dispatch)
 * 3. AgentScheduler creates session UUID, writes to .team3-project.json, spawns claude
 * 4. Arch claude writes "已在线" notification back to actions.jsonl
 * 5. Poll for completion: session UUID in .team3-project.json + arch online notification
 * 6. Return { arch: { sessionId } }
 *
 * Note: UAT agent is not initialized here. UAT is triggered later by arch
 * sending uat_design after all modules are done and regression passes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { startDaemon, StartDaemonResult } from "./start-daemon";

/** UUID v4 validation regex */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Default polling interval (ms) */
const POLL_INTERVAL_MS = 300;

/** Default timeout for waiting agents to initialize (ms) */
const DEFAULT_TIMEOUT_MS = 30000;

/** Default daemon port for orchestrator */
const DEFAULT_PORT = 3100;

export interface InitAgentsOptions {
  /** Port for the daemon WebSocket server (default 3100) */
  port?: number;
  /** Path to orchestrator entry script */
  orchestratorEntryPath?: string;
  /** Timeout for agent initialization (default 30000ms) */
  timeoutMs?: number;
  /** Timeout for daemon startup (default 10000ms) */
  daemonTimeoutMs?: number;
}

export interface AgentSession {
  sessionId: string;
}

export interface InitAgentsResult {
  arch: AgentSession;
  daemonPid: number;
}

/**
 * Resolve the orchestrator entry path.
 * Packaged mode: $TEAM3_PKG_DIR/daemon.min.js
 * Dev mode: ../daemon/src/orchestrator-entry.js (sibling of web/)
 */
function resolveOrchestratorEntry(): string {
  if (process.env.TEAM3_PKG_DIR) {
    return path.join(process.env.TEAM3_PKG_DIR, "daemon.min.js");
  }
  return path.join(/* turbopackIgnore: true */ process.cwd(), "..", "daemon", "src", "orchestrator-entry.js");
}

/**
 * Get the arch init prompt (same as daemon/src/init-agent.js getArchInitPrompt).
 */
function getArchInitPrompt(): string {
  return '请在 spec/actions.jsonl 文件末尾追加一行 JSON：{"action":"to_human","from":"arch","to":"human","ts":<当前unix秒级时间戳>,"message":"arch 已在线，我们开始讨论吧"}。只做这一件事，完成后退出。';
}

/**
 * Write an action to spec/actions.jsonl.
 */
function writeAction(
  actionsPath: string,
  action: Record<string, unknown>
): void {
  fs.appendFileSync(actionsPath, JSON.stringify(action) + "\n", "utf-8");
}

/**
 * Poll until a condition is met or timeout.
 */
async function pollUntil(
  check: () => boolean,
  timeoutMs: number,
  intervalMs: number = POLL_INTERVAL_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Polling timed out after ${timeoutMs}ms`);
}

/**
 * Read arch session UUID from .team3-project.json.
 */
function readArchSessionId(projectJsonPath: string): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
    return data?.partner?.arch_agent?.session?.runing || null;
  } catch {
    return null;
  }
}

/**
 * Check if arch "已在线" notification exists in actions.jsonl.
 */
function hasArchOnlineNotification(actionsPath: string): boolean {
  try {
    const content = fs.readFileSync(actionsPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (
          parsed.action === "to_human" &&
          parsed.from === "arch" &&
          typeof parsed.message === "string" &&
          parsed.message.includes("已在线")
        ) {
          return true;
        }
      } catch {
        // Skip invalid lines
      }
    }
  } catch {
    // File doesn't exist yet
  }
  return false;
}

/**
 * Initialize arch agent through the DaemonOrchestrator pipeline.
 *
 * @param workspacePath - Absolute path to the target project workspace.
 * @param options - Optional configuration.
 * @returns Promise resolving with arch session info when agent is ready.
 */
export async function initAgents(
  workspacePath: string,
  options: InitAgentsOptions = {}
): Promise<InitAgentsResult> {
  const port = options.port || DEFAULT_PORT;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const daemonTimeoutMs = options.daemonTimeoutMs || 10000;
  const orchestratorEntry =
    options.orchestratorEntryPath || resolveOrchestratorEntry();

  const absWorkspace = path.resolve(workspacePath);
  const actionsPath = path.join(absWorkspace, "spec", "actions.jsonl");
  const projectJsonPath = path.join(absWorkspace, ".team3-project.json");

  // Verify workspace exists
  if (!fs.existsSync(projectJsonPath)) {
    throw new Error(
      `.team3-project.json not found at ${projectJsonPath}. Run initWorkspace first.`
    );
  }

  // Verify orchestrator entry exists
  if (!fs.existsSync(orchestratorEntry)) {
    throw new Error(`Orchestrator entry not found: ${orchestratorEntry}`);
  }

  // 1. Start DaemonOrchestrator
  let daemonResult: StartDaemonResult;
  try {
    daemonResult = await startDaemon(absWorkspace, {
      daemonEntryPath: orchestratorEntry,
      port,
      timeoutMs: daemonTimeoutMs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to start DaemonOrchestrator: ${msg}`);
  }

  // 2. Write init action to actions.jsonl
  //    This triggers AgentScheduler to create session and spawn claude
  const now = Math.floor(Date.now() / 1000);

  writeAction(actionsPath, {
    action: "to_arch",
    from: "system",
    to: "arch",
    ts: now,
    message: getArchInitPrompt(),
  });

  // 3. Poll for arch session UUID in .team3-project.json
  let archSessionId = "";

  try {
    await pollUntil(() => {
      const id = readArchSessionId(projectJsonPath);
      if (id && UUID_V4_REGEX.test(id)) {
        archSessionId = id;
        return true;
      }
      return false;
    }, timeoutMs);
  } catch {
    const id = readArchSessionId(projectJsonPath);
    throw new Error(
      `Timed out waiting for arch session. Got: ${id}`
    );
  }

  // 4. Poll for arch "已在线" notification in actions.jsonl
  try {
    await pollUntil(() => hasArchOnlineNotification(actionsPath), timeoutMs);
  } catch {
    throw new Error(
      'Timed out waiting for arch "已在线" notification in actions.jsonl'
    );
  }

  // 5. Return result
  return {
    arch: { sessionId: archSessionId },
    daemonPid: daemonResult.pid,
  };
}
