/**
 * Unit tests for /api/chat/send, /api/modules, /api/timeline route handlers.
 * All fs operations and workspace resolution are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";

// Mock modules before importing handlers
vi.mock("node:fs");

vi.mock("@/lib/workspace", () => {
  return {
    resolveWorkspace: vi.fn((ws?: string | null) => ws || "/workspace"),
    resolveSafePath: vi.fn(),
  };
});

import { POST as chatSendPOST } from "../src/app/api/chat/send/route";
import { GET as modulesGET } from "../src/app/api/modules/route";
import { GET as timelineGET } from "../src/app/api/timeline/route";

function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options);
}

describe("POST /api/chat/send", () => {
  beforeEach(() => {
    vi.mocked(fs.mkdirSync).mockReset();
    vi.mocked(fs.appendFileSync).mockReset();
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = makeRequest("http://localhost:3000/api/chat/send", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await chatSendPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("JSON");
  });

  it("returns 400 when action field is missing", async () => {
    const req = makeRequest("http://localhost:3000/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ to: "arch", message: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await chatSendPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("action");
  });

  it("returns 400 for invalid action value", async () => {
    const req = makeRequest("http://localhost:3000/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ action: "invalid_action", to: "arch", message: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await chatSendPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid action");
  });

  it("returns 400 when to field is missing", async () => {
    const req = makeRequest("http://localhost:3000/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ action: "to_arch", message: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await chatSendPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("to");
  });

  it("returns 400 when message field is missing", async () => {
    const req = makeRequest("http://localhost:3000/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ action: "to_arch", to: "arch" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await chatSendPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("message");
  });

  it("appends valid JSON line to actions.jsonl and returns 200", async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined);

    const req = makeRequest("http://localhost:3000/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ action: "to_arch", to: "arch", message: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await chatSendPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.entry).toBeDefined();
    expect(body.entry.from).toBe("human");
    expect(body.entry.action).toBe("to_arch");
    expect(body.entry.to).toBe("arch");
    expect(body.entry.message).toBe("hello");
    expect(typeof body.entry.ts).toBe("number");
    // ts should be a recent unix timestamp (after 2024)
    expect(body.entry.ts).toBeGreaterThan(1704067200);

    // Verify appendFileSync was called with valid JSON line
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining("spec/actions.jsonl"),
      expect.stringMatching(/^\{.*\}\n$/),
      "utf-8"
    );

    // Parse the written line to verify it's valid JSON
    const writtenLine = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    expect(parsed.from).toBe("human");
    expect(parsed.action).toBe("to_arch");
    expect(parsed.to).toBe("arch");
    expect(parsed.message).toBe("hello");
    expect(parsed.from).not.toBe("daemon");
  });

  it("returns 500 when file write fails", async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.appendFileSync).mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const req = makeRequest("http://localhost:3000/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ action: "to_arch", to: "arch", message: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await chatSendPOST(req);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/modules", () => {
  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReset();
  });

  it("returns modules_progress.json content when no mid param", async () => {
    const mockData = {
      modules: [{ id: "module_1", name: "Test", status: "done", features: [] }],
      dependencies: [],
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

    const req = makeRequest("http://localhost:3000/api/modules");
    const res = await modulesGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockData);
  });

  it("returns 404 when modules_progress.json does not exist", async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      const err = new Error("ENOENT") as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    });

    const req = makeRequest("http://localhost:3000/api/modules");
    const res = await modulesGET(req);
    expect(res.status).toBe(404);
  });

  it("returns feature_list.json content when mid is provided", async () => {
    const mockFeatures = [
      { id: 1, description: "Feature 1", checkpoint: ["Step 1"], passes: true },
    ];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockFeatures));

    const req = makeRequest("http://localhost:3000/api/modules?mid=module_3");
    const res = await modulesGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockFeatures);

    // Verify correct file path was read
    expect(fs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("module_3_feature_list.json"),
      "utf-8"
    );
  });

  it("returns 404 for invalid mid format", async () => {
    const req = makeRequest("http://localhost:3000/api/modules?mid=invalid");
    const res = await modulesGET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Invalid module ID");
  });

  it("returns 404 when feature_list file does not exist", async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      const err = new Error("ENOENT") as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    });

    const req = makeRequest("http://localhost:3000/api/modules?mid=module_99");
    const res = await modulesGET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });
});

describe("GET /api/timeline", () => {
  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReset();
  });

  it("returns 400 when mid parameter is missing", async () => {
    const req = makeRequest("http://localhost:3000/api/timeline");
    const res = await timelineGET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("mid");
  });

  it("returns 404 for invalid mid format", async () => {
    const req = makeRequest("http://localhost:3000/api/timeline?mid=badformat");
    const res = await timelineGET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Invalid module ID");
  });

  it("returns progress.txt content as plain text", async () => {
    const progressContent = "## Current Feature\nfeature_id: 3\nstatus: in_progress\n";
    vi.mocked(fs.readFileSync).mockReturnValue(progressContent);

    const req = makeRequest("http://localhost:3000/api/timeline?mid=module_3");
    const res = await timelineGET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toBe(progressContent);

    // Verify correct file was read
    expect(fs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("module_3_progress.txt"),
      "utf-8"
    );
  });

  it("returns 404 when progress file does not exist", async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      const err = new Error("ENOENT") as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    });

    const req = makeRequest("http://localhost:3000/api/timeline?mid=module_99");
    const res = await timelineGET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });
});
