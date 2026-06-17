/**
 * E2E test for Module 2 Feature #6:
 * Workspace page "Start Daemon" button + __dirname fix.
 *
 * Checkpoints:
 * Step 1: start-daemon.ts resolveDaemonEntry() and init-agents.ts resolveOrchestratorEntry()
 *         do NOT use __dirname, use process.cwd() instead
 * Step 2: POST /api/project/start returns { success, pid, port } and daemon entry path
 *         is resolved via process.cwd(), not __dirname
 * Step 3: (UI) Workspace page shows "启动 Daemon" button when disconnected — tested via
 *         Puppeteer in a separate test file if needed; here we verify API + source code
 * Step 4: POST /api/project/start → daemon actually starts → ws connects + receives connected msg
 * Step 5: POST /api/project/start with bad body returns proper error codes
 *
 * Requires: Next.js dev server running on port 3000
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import WebSocket from "ws";

const BASE_URL = "http://127.0.0.1:3000";
const API = (route: string) => `${BASE_URL}${route}`;

const TEST_PROJECTS_DIR = path.join(process.cwd(), ".test-start-daemon-e2e");
const TEST_PROJECT_NAME = "e2e-daemon-test";
const TEST_PROJECT_DIR = path.join(TEST_PROJECTS_DIR, TEST_PROJECT_NAME);

// Path to data/projects.json (the project registry)
const PROJECTS_JSON_PATH = path.join(process.cwd(), "data", "projects.json");
let originalProjectsJson: string | null = null;

// Track daemon PID for cleanup
let daemonPid: number | null = null;

async function waitForServer(url: string, maxWaitMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server not ready at ${url} after ${maxWaitMs}ms`);
}

function killProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process may already be dead
  }
}

beforeAll(async () => {
  await waitForServer(`${BASE_URL}/health`);

  // Backup existing projects.json
  if (fs.existsSync(PROJECTS_JSON_PATH)) {
    originalProjectsJson = fs.readFileSync(PROJECTS_JSON_PATH, "utf-8");
  }

  // Clean up any leftover test project
  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_PROJECTS_DIR, { recursive: true });

  // Create test project via real HTTP API (so .team3-project.json exists)
  const res = await fetch(API("/api/project/init"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: TEST_PROJECT_NAME,
      parentDir: TEST_PROJECTS_DIR,
    }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Failed to create test project: ${JSON.stringify(data)}`);
  }
}, 30000);

afterAll(async () => {
  // Kill daemon if we started one — must happen before removing files
  if (daemonPid) {
    killProcess(daemonPid);
    daemonPid = null;
    // Give the OS a moment to release file handles
    await new Promise((r) => setTimeout(r, 500));
  }

  // Clean up test project
  if (fs.existsSync(TEST_PROJECTS_DIR)) {
    fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });
  }

  // Restore original projects.json
  if (originalProjectsJson !== null) {
    fs.writeFileSync(PROJECTS_JSON_PATH, originalProjectsJson, "utf-8");
  } else if (fs.existsSync(PROJECTS_JSON_PATH)) {
    fs.unlinkSync(PROJECTS_JSON_PATH);
  }
});

describe("Feature #6: Start Daemon API + __dirname fix", () => {
  /**
   * Step 1: Source code check — resolveDaemonEntry and resolveOrchestratorEntry
   * must NOT use __dirname, must use process.cwd()
   */
  describe("Step 1: __dirname removed from resolve functions", () => {
    it("start-daemon.ts resolveDaemonEntry does NOT contain __dirname", () => {
      const srcPath = path.join(process.cwd(), "src", "lib", "init", "start-daemon.ts");
      const src = fs.readFileSync(srcPath, "utf-8");

      // Extract resolveDaemonEntry function body
      const fnMatch = src.match(/function resolveDaemonEntry\([^)]*\)[^{]*\{([^}]*)\}/);
      expect(fnMatch).not.toBeNull();
      const fnBody = fnMatch![1];

      // Must NOT use __dirname
      expect(fnBody).not.toContain("__dirname");
      // Must use process.cwd()
      expect(fnBody).toContain("process.cwd()");
    });

    it("init-agents.ts resolveOrchestratorEntry does NOT contain __dirname", () => {
      const srcPath = path.join(process.cwd(), "src", "lib", "init", "init-agents.ts");
      const src = fs.readFileSync(srcPath, "utf-8");

      // Extract resolveOrchestratorEntry function body
      const fnMatch = src.match(/function resolveOrchestratorEntry\([^)]*\)[^{]*\{([^}]*)\}/);
      expect(fnMatch).not.toBeNull();
      const fnBody = fnMatch![1];

      // Must NOT use __dirname
      expect(fnBody).not.toContain("__dirname");
      // Must use process.cwd()
      expect(fnBody).toContain("process.cwd()");
    });

    it("resolved paths point to daemon/src/ directory", () => {
      const srcDaemon = fs.readFileSync(
        path.join(process.cwd(), "src", "lib", "init", "start-daemon.ts"),
        "utf-8"
      );
      const srcAgents = fs.readFileSync(
        path.join(process.cwd(), "src", "lib", "init", "init-agents.ts"),
        "utf-8"
      );

      // Both should resolve to paths containing daemon/src/
      expect(srcDaemon).toContain('"daemon"');
      expect(srcDaemon).toContain('"daemon.js"');
      expect(srcAgents).toContain('"daemon"');
      expect(srcAgents).toContain('"orchestrator-entry.js"');
    });
  });

  /**
   * Step 2 + 5: POST /api/project/start error handling
   */
  describe("Step 2: POST /api/project/start validation", () => {
    it("returns 400 when workspace is missing", async () => {
      const res = await fetch(API("/api/project/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("workspace");
    });

    it("returns 400 when workspace is not absolute", async () => {
      const res = await fetch(API("/api/project/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: "relative/path" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("absolute path");
    });

    it("returns 404 when .team3-project.json does not exist", async () => {
      const res = await fetch(API("/api/project/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: "/tmp/nonexistent-project-xyz" }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain(".team3-project.json not found");
    });
  });

  /**
   * Step 4: POST /api/project/start → daemon actually starts → ws connects
   * This is the critical real integration test.
   */
  describe("Step 4: Start daemon via real HTTP API", () => {
    let startResult: { success: boolean; pid: number; port: number };

    it("POST /api/project/start returns success + pid + port", async () => {
      const res = await fetch(API("/api/project/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: TEST_PROJECT_DIR }),
      });

      expect(res.status).toBe(200);
      startResult = await res.json();
      expect(startResult.success).toBe(true);
      expect(typeof startResult.pid).toBe("number");
      expect(startResult.pid).toBeGreaterThan(0);
      expect(typeof startResult.port).toBe("number");
      expect(startResult.port).toBeGreaterThan(0);

      // Track for cleanup
      daemonPid = startResult.pid;
    }, 15000);

    it("daemon process is alive after start", () => {
      expect(daemonPid).not.toBeNull();
      // Sending signal 0 checks if process exists without killing it
      let alive = false;
      try {
        process.kill(daemonPid!, 0);
        alive = true;
      } catch {
        alive = false;
      }
      expect(alive).toBe(true);
    });

    it("WebSocket connects to daemon and receives 'connected' message", async () => {
      expect(startResult).toBeDefined();
      const port = startResult.port;

      const connected = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "connected") {
              clearTimeout(timeout);
              ws.close();
              resolve(true);
            }
          } catch { /* ignore */ }
        });

        ws.on("error", () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });

      expect(connected).toBe(true);
    }, 10000);

    it(".team3-project.json init_daemon field updated with daemon PID", () => {
      const projectJson = JSON.parse(
        fs.readFileSync(path.join(TEST_PROJECT_DIR, ".team3-project.json"), "utf-8")
      );
      expect(projectJson.init_daemon).toBe(String(daemonPid));
    });
  });
});
