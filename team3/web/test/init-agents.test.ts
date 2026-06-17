/**
 * Unit tests for Feature #4: initAgents
 *
 * All external dependencies are mocked:
 * - fs (file system operations)
 * - startDaemon (daemon startup)
 * - setTimeout/polling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Mock fs module
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

// Mock start-daemon module
vi.mock("../src/lib/init/start-daemon", () => ({
  startDaemon: vi.fn(),
}));

import { initAgents } from "../src/lib/init/init-agents";
import { startDaemon } from "../src/lib/init/start-daemon";

const WORKSPACE = "/test/workspace";
const PROJECT_JSON_PATH = path.join(WORKSPACE, ".team3-project.json");
const ACTIONS_PATH = path.join(WORKSPACE, "spec", "actions.jsonl");

describe("Feature #4: initAgents", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(startDaemon).mockResolvedValue({ pid: 12345, port: 3100 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("Input validation", () => {
    it("throws if .team3-project.json does not exist", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p) === PROJECT_JSON_PATH) return false;
        return true;
      });

      await expect(initAgents(WORKSPACE)).rejects.toThrow(
        ".team3-project.json not found"
      );
    });

    it("throws if orchestrator entry does not exist", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        if (s === PROJECT_JSON_PATH) return true;
        if (s.includes("orchestrator-entry")) return false;
        return true;
      });

      await expect(initAgents(WORKSPACE)).rejects.toThrow(
        "Orchestrator entry not found"
      );
    });
  });

  describe("Daemon startup", () => {
    it("starts DaemonOrchestrator via startDaemon", async () => {
      setupSuccessfulPolling();

      await initAgents(WORKSPACE, { port: 4000, timeoutMs: 2000 });

      expect(startDaemon).toHaveBeenCalledWith(
        WORKSPACE,
        expect.objectContaining({
          port: 4000,
          daemonEntryPath: expect.stringContaining("orchestrator-entry.js"),
        })
      );
    });

    it("throws with descriptive message if startDaemon fails", async () => {
      vi.mocked(startDaemon).mockRejectedValue(new Error("Port in use"));

      await expect(initAgents(WORKSPACE)).rejects.toThrow(
        "Failed to start DaemonOrchestrator: Port in use"
      );
    });
  });

  describe("Action writing", () => {
    it("writes to_arch action to actions.jsonl with init prompt", async () => {
      setupSuccessfulPolling();

      await initAgents(WORKSPACE, { timeoutMs: 2000 });

      const calls = vi.mocked(fs.appendFileSync).mock.calls;
      const archCall = calls.find(
        (c) => String(c[1]).includes("to_arch")
      );
      expect(archCall).toBeDefined();

      const archAction = JSON.parse(String(archCall![1]).trim());
      expect(archAction.action).toBe("to_arch");
      expect(archAction.from).toBe("system");
      expect(archAction.to).toBe("arch");
      expect(archAction.message).toContain("actions.jsonl");
      expect(archAction.message).toContain("已在线");
      expect(archAction.ts).toBeGreaterThan(0);
    });

    it("does not write uat action (UAT triggered later by human)", async () => {
      setupSuccessfulPolling();

      await initAgents(WORKSPACE, { timeoutMs: 2000 });

      const calls = vi.mocked(fs.appendFileSync).mock.calls;
      const uatCall = calls.find(
        (c) => String(c[1]).includes("uat")
      );
      expect(uatCall).toBeUndefined();
    });
  });

  describe("Polling for results", () => {
    it("resolves when arch session is valid UUID v4 and notification found", async () => {
      setupSuccessfulPolling();

      const result = await initAgents(WORKSPACE, { timeoutMs: 2000 });

      expect(result.arch.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(result.daemonPid).toBe(12345);
    });

    it("times out if session UUID never appears", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: "test" }));

      await expect(
        initAgents(WORKSPACE, { timeoutMs: 1000 })
      ).rejects.toThrow("Timed out waiting for arch session");
    });

    it("times out if arch notification never appears", async () => {
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        const s = String(p);
        if (s === PROJECT_JSON_PATH) {
          return JSON.stringify({
            partner: {
              arch_agent: { session: { runing: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" } },
            },
          });
        }
        if (s === ACTIONS_PATH) {
          return '{"action":"to_arch","from":"system","to":"arch","ts":1,"message":"init"}\n';
        }
        return "";
      });

      await expect(
        initAgents(WORKSPACE, { timeoutMs: 1000 })
      ).rejects.toThrow('Timed out waiting for arch "已在线" notification');
    });
  });

  describe("Return value", () => {
    it("returns { arch: { sessionId }, daemonPid }", async () => {
      setupSuccessfulPolling();

      const result = await initAgents(WORKSPACE, { timeoutMs: 2000 });

      expect(result).toHaveProperty("arch");
      expect(result).toHaveProperty("daemonPid");
      expect(result.arch).toHaveProperty("sessionId");
      expect(typeof result.arch.sessionId).toBe("string");
      expect(typeof result.daemonPid).toBe("number");
    });
  });
});

/**
 * Helper: set up mocks so that polling resolves successfully.
 */
function setupSuccessfulPolling() {
  const archUuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const s = String(p);
    if (s === PROJECT_JSON_PATH) {
      return JSON.stringify({
        partner: {
          arch_agent: { session: { runing: archUuid } },
        },
      });
    }
    if (s === ACTIONS_PATH) {
      return JSON.stringify({
        action: "to_human",
        from: "arch",
        to: "human",
        ts: 1716600000,
        message: "arch 已在线，我们开始讨论吧",
      }) + "\n";
    }
    return "";
  });
}
