/**
 * E2E Integration Test for Feature #3: startDaemon
 *
 * IMPORTANT: No mocks allowed - this test truly starts the daemon process.
 *
 * Checkpoint verification:
 *   Step 1: startDaemon starts daemon via child_process (daemon/src/daemon.js)
 *   Step 2: After startup, .team3-project.json init_daemon = daemon PID
 *   Step 3: Function waits for WebSocket ready (connected message) before resolve
 *   Step 4: Daemon startup failure → reject with error info
 *
 * Test project path: /Users/bohan.sj/dev/open/team_coding3/example/test1/
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import WebSocket from "ws";
import { initWorkspace } from "../../src/lib/init/init-workspace";
import { startDaemon } from "../../src/lib/init/start-daemon";

const TEST_PROJECT_PATH = "/Users/bohan.sj/dev/open/team_coding3/example/test1";
const DAEMON_ENTRY = path.resolve(__dirname, "../../../daemon/src/daemon.js");
// Use a non-default port to avoid conflicts
const TEST_PORT = 3199;

// Track PIDs to clean up
let daemonPid: number | null = null;

function killDaemon(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process may already be dead
  }
}

describe("Feature #3: startDaemon", () => {
  beforeAll(() => {
    // Clean and set up test workspace
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
    initWorkspace(TEST_PROJECT_PATH);
  });

  afterEach(() => {
    // Kill daemon after each test that starts one
    if (daemonPid) {
      killDaemon(daemonPid);
      daemonPid = null;
      // Give it a moment to release the port
    }
  });

  afterAll(async () => {
    // Ensure daemon is killed
    if (daemonPid) {
      killDaemon(daemonPid);
      daemonPid = null;
    }
    // Wait for port release
    await new Promise((r) => setTimeout(r, 500));
    // Clean up
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
  });

  describe("Step 1: startDaemon starts daemon via child_process", () => {
    it("starts daemon process and returns valid PID", async () => {
      const result = await startDaemon(TEST_PROJECT_PATH, {
        daemonEntryPath: DAEMON_ENTRY,
        port: TEST_PORT,
        timeoutMs: 8000,
      });

      daemonPid = result.pid;

      expect(result.pid).toBeGreaterThan(0);
      expect(result.port).toBe(TEST_PORT);

      // Verify the process is actually running
      let isRunning = false;
      try {
        // kill with signal 0 tests if process exists (doesn't actually kill)
        process.kill(result.pid, 0);
        isRunning = true;
      } catch {
        isRunning = false;
      }
      expect(isRunning).toBe(true);
    }, 10000);
  });

  describe("Step 2: .team3-project.json init_daemon = PID", () => {
    it("writes daemon PID to init_daemon field", async () => {
      const result = await startDaemon(TEST_PROJECT_PATH, {
        daemonEntryPath: DAEMON_ENTRY,
        port: TEST_PORT + 1,
        timeoutMs: 8000,
      });

      daemonPid = result.pid;

      const projectJsonPath = path.join(TEST_PROJECT_PATH, ".team3-project.json");
      const data = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));

      expect(data.init_daemon).toBe(String(result.pid));
    }, 10000);
  });

  describe("Step 3: Waits for WebSocket ready (connected message)", () => {
    it("can connect to daemon WebSocket after startDaemon resolves", async () => {
      const port = TEST_PORT + 2;
      const result = await startDaemon(TEST_PROJECT_PATH, {
        daemonEntryPath: DAEMON_ENTRY,
        port,
        timeoutMs: 8000,
      });

      daemonPid = result.pid;

      // If startDaemon resolved, WebSocket should already be ready
      // Verify by connecting again
      const connected = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const timeout = setTimeout(() => {
          ws.terminate();
          resolve(false);
        }, 3000);

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
    }, 12000);
  });

  describe("Step 4: Daemon startup failure rejects with error", () => {
    it("rejects when daemon entry path does not exist", async () => {
      await expect(
        startDaemon(TEST_PROJECT_PATH, {
          daemonEntryPath: "/nonexistent/path/daemon.js",
          port: TEST_PORT + 3,
          timeoutMs: 3000,
        })
      ).rejects.toThrow("Daemon entry not found");
    });

    it("rejects with timeout when daemon cannot start on occupied port", async () => {
      // Start a daemon on a port first
      const port = TEST_PORT + 4;
      const result1 = await startDaemon(TEST_PROJECT_PATH, {
        daemonEntryPath: DAEMON_ENTRY,
        port,
        timeoutMs: 8000,
      });
      daemonPid = result1.pid;

      // Try to start another daemon on the same port - should fail
      await expect(
        startDaemon(TEST_PROJECT_PATH, {
          daemonEntryPath: DAEMON_ENTRY,
          port,
          timeoutMs: 3000,
        })
      ).rejects.toThrow();

      // Clean up the first daemon
      killDaemon(result1.pid);
      daemonPid = null;
      await new Promise((r) => setTimeout(r, 300));
    }, 15000);
  });
});
