/**
 * Unit tests for startDaemon.
 * External dependencies (child_process, ws, fs) are mocked.
 * Real integration is tested in e2e/feature_3/.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";

// Mock fs and child_process
vi.mock("node:fs");
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock ws
vi.mock("ws", () => {
  return {
    default: vi.fn(),
  };
});

import { startDaemon } from "../src/lib/init/start-daemon";
import { spawn } from "node:child_process";
import WebSocket from "ws";

describe("startDaemon", () => {
  const WORKSPACE = "/tmp/test-workspace";
  const DAEMON_ENTRY = "/fake/daemon/src/daemon.js";
  let mockChild: EventEmitter & { pid?: number; unref: () => void };

  beforeEach(() => {
    // Create mock child process
    mockChild = Object.assign(new EventEmitter(), {
      pid: 12345,
      unref: vi.fn(),
    });

    // Mock spawn
    vi.mocked(spawn).mockReturnValue(mockChild as any);

    // Mock fs.existsSync
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Mock fs.readFileSync for .team3-project.json
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ name: "test", init_daemon: "" })
    );

    // Mock fs.writeFileSync
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    // Mock WebSocket class to simulate successful connection
    vi.mocked(WebSocket).mockImplementation(function (this: any) {
      const emitter = new EventEmitter();
      setTimeout(() => {
        emitter.emit("open");
        setTimeout(() => {
          emitter.emit("message", JSON.stringify({ type: "connected", clientId: "test" }));
        }, 10);
      }, 10);
      (emitter as any).close = vi.fn();
      (emitter as any).terminate = vi.fn();
      return emitter as any;
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects when daemon entry file does not exist", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (String(p) === DAEMON_ENTRY) return false;
      return true;
    });

    await expect(
      startDaemon(WORKSPACE, { daemonEntryPath: DAEMON_ENTRY })
    ).rejects.toThrow("Daemon entry not found");
  });

  it("spawns daemon with correct env vars", async () => {
    await startDaemon(WORKSPACE, { daemonEntryPath: DAEMON_ENTRY, port: 4200 });

    expect(spawn).toHaveBeenCalledWith("node", [DAEMON_ENTRY], expect.objectContaining({
      env: expect.objectContaining({
        DAEMON_PORT: "4200",
        TEAM3_PROJECT_JSON: path.join(path.resolve(WORKSPACE), ".team3-project.json"),
      }),
    }));
  });

  it("rejects when spawn emits error", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        pid: undefined,
        unref: vi.fn(),
      });
      setTimeout(() => child.emit("error", new Error("ENOENT")), 10);
      return child as any;
    });

    await expect(
      startDaemon(WORKSPACE, { daemonEntryPath: DAEMON_ENTRY })
    ).rejects.toThrow("Failed to spawn daemon");
  });

  it("resolves with pid and port on success", async () => {
    const result = await startDaemon(WORKSPACE, {
      daemonEntryPath: DAEMON_ENTRY,
      port: 3200,
    });

    expect(result.pid).toBe(12345);
    expect(result.port).toBe(3200);
  });

  it("writes PID to .team3-project.json", async () => {
    await startDaemon(WORKSPACE, { daemonEntryPath: DAEMON_ENTRY });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(path.resolve(WORKSPACE), ".team3-project.json"),
      expect.stringContaining('"init_daemon": "12345"'),
      "utf-8"
    );
  });

  it("unrefs child process after success", async () => {
    await startDaemon(WORKSPACE, { daemonEntryPath: DAEMON_ENTRY });
    expect(mockChild.unref).toHaveBeenCalled();
  });

  it("uses default port 3100 when not specified", async () => {
    await startDaemon(WORKSPACE, { daemonEntryPath: DAEMON_ENTRY });

    expect(spawn).toHaveBeenCalledWith("node", [DAEMON_ENTRY], expect.objectContaining({
      env: expect.objectContaining({
        DAEMON_PORT: "3100",
      }),
    }));
  });
});
