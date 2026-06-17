/**
 * Unit tests for POST /api/project/start.
 * startDaemon and fs are mocked — real integration is tested in e2e.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock start-daemon
vi.mock("@/lib/init/start-daemon", () => ({
  startDaemon: vi.fn(),
}));

// Mock web-logger
vi.mock("@/lib/web-logger", () => ({
  webLog: { api: vi.fn() },
}));

import * as fs from "node:fs";
import { startDaemon } from "@/lib/init/start-daemon";
import { POST } from "@/app/api/project/start/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/project/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/project/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when body is not valid JSON", async () => {
    const req = new Request("http://localhost:3000/api/project/start", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });

  it("returns 400 when workspace is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("workspace");
  });

  it("returns 400 when workspace is not a string", async () => {
    const res = await POST(makeRequest({ workspace: 123 }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("workspace");
  });

  it("returns 400 when workspace is not an absolute path", async () => {
    const res = await POST(makeRequest({ workspace: "relative/path" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("absolute path");
  });

  it("returns 404 when .team3-project.json does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const res = await POST(makeRequest({ workspace: "/tmp/nonexistent" }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain(".team3-project.json not found");
  });

  it("returns 200 with pid and port on success", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(startDaemon).mockResolvedValue({ pid: 42000, port: 3100 });

    const res = await POST(makeRequest({ workspace: "/tmp/my-project" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.pid).toBe(42000);
    expect(data.port).toBe(3100);
  });

  it("passes workspace to startDaemon without extra options", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(startDaemon).mockResolvedValue({ pid: 42000, port: 3100 });

    await POST(makeRequest({ workspace: "/tmp/my-project" }));

    expect(startDaemon).toHaveBeenCalledWith("/tmp/my-project");
  });

  it("returns 500 when startDaemon throws", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(startDaemon).mockRejectedValue(new Error("Port already in use"));

    const res = await POST(makeRequest({ workspace: "/tmp/my-project" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Port already in use");
  });

  it("calls startDaemon with the workspace from request body", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(startDaemon).mockResolvedValue({ pid: 99, port: 3100 });

    await POST(makeRequest({ workspace: "/Users/test/my-app" }));

    expect(startDaemon).toHaveBeenCalledWith("/Users/test/my-app");
  });
});
