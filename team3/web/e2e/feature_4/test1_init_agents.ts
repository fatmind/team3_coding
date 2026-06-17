/**
 * E2E Integration Test for Feature #4: initAgents
 *
 * IMPORTANT: No mocks allowed - uses real DaemonOrchestrator with stub-claude.
 *
 * Checkpoint verification:
 *   Step 1: web/src/lib/init/init-agents.ts exports initAgents(workspacePath)
 *   Step 2: initAgents writes to actions.jsonl triggering daemon dispatch (role=arch)
 *   Step 3: .team3-project.json partner.arch_agent.session.runing is valid UUID v4
 *   Step 4: spec/actions.jsonl contains arch online notification (action=to_human, from=arch, message contains "已在线")
 *   Step 5: Function returns { arch: { sessionId } }
 *
 * Test project path: /Users/bohan.sj/dev/open/team_coding3/example/test1/
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { initWorkspace } from "../../src/lib/init/init-workspace";
import { initAgents } from "../../src/lib/init/init-agents";

const TEST_PROJECT_PATH = "/Users/bohan.sj/dev/open/team_coding3/example/test1";
const ORCHESTRATOR_ENTRY = path.resolve(__dirname, "../../../daemon/src/orchestrator-entry.js");
const STUB_CLAUDE_PATH = path.resolve(__dirname, "../../../daemon/e2e/stub-claude.js");
// Use a unique port to avoid conflicts with other tests
const TEST_PORT = 3210;

// Track daemon PID for cleanup
let daemonPid: number | null = null;

function killDaemon(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process may already be dead
  }
}

describe("Feature #4: initAgents", () => {
  beforeAll(() => {
    // Clean and set up test workspace
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
    initWorkspace(TEST_PROJECT_PATH);

    // Set env vars for stub-claude (propagated via process.env spread in startDaemon)
    process.env.STUB_CLAUDE_PATH = STUB_CLAUDE_PATH;
  });

  afterAll(async () => {
    // Kill daemon
    if (daemonPid) {
      killDaemon(daemonPid);
      daemonPid = null;
    }
    // Wait for port release
    await new Promise((r) => setTimeout(r, 500));
    // Clean up env
    delete process.env.STUB_CLAUDE_PATH;
    // Clean up test directory
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
  });

  describe("Step 1: initAgents exported and callable", () => {
    it("initAgents is a function exported from init-agents module", () => {
      expect(typeof initAgents).toBe("function");
    });
  });

  describe("Step 2-5: Full init flow", () => {
    let result: Awaited<ReturnType<typeof initAgents>>;

    it("initAgents starts orchestrator, dispatches arch agent, returns session", async () => {
      result = await initAgents(TEST_PROJECT_PATH, {
        orchestratorEntryPath: ORCHESTRATOR_ENTRY,
        port: TEST_PORT,
        timeoutMs: 20000,
        daemonTimeoutMs: 10000,
      });

      daemonPid = result.daemonPid;

      // Basic result structure
      expect(result).toHaveProperty("arch");
      expect(result).toHaveProperty("daemonPid");
      expect(result.daemonPid).toBeGreaterThan(0);
    }, 30000);

    it("Step 3: arch_agent.session.runing is valid UUID v4", () => {
      const projectJsonPath = path.join(TEST_PROJECT_PATH, ".team3-project.json");
      const data = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));

      const archRuning = data.partner?.arch_agent?.session?.runing;
      expect(archRuning).toBeDefined();
      expect(archRuning).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it("Step 4: actions.jsonl contains arch online notification", () => {
      const actionsPath = path.join(TEST_PROJECT_PATH, "spec", "actions.jsonl");
      const content = fs.readFileSync(actionsPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      // Find arch notification
      const archNotification = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .find(
          (parsed) =>
            parsed &&
            parsed.action === "to_human" &&
            parsed.from === "arch" &&
            typeof parsed.message === "string" &&
            parsed.message.includes("已在线")
        );

      expect(archNotification).toBeDefined();
      expect(archNotification.to).toBe("human");
      expect(archNotification.ts).toBeGreaterThan(0);
    });

    it("Step 5: returns { arch: { sessionId } }", () => {
      expect(result.arch).toHaveProperty("sessionId");
      expect(result.arch.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it("Step 5: returned sessionId matches .team3-project.json", () => {
      const projectJsonPath = path.join(TEST_PROJECT_PATH, ".team3-project.json");
      const data = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));

      expect(result.arch.sessionId).toBe(data.partner.arch_agent.session.runing);
    });
  });
});
