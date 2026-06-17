/**
 * Unit tests for GET /api/chat/history
 * Tests reading actions.jsonl and returning parsed JSON array.
 * Supports optional workspace query param override.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock workspace
vi.mock("@/lib/workspace", () => ({
  resolveWorkspace: vi.fn((ws?: string | null) => ws || "/fake/workspace"),
}));

import * as fs from "node:fs";
import { GET } from "@/app/api/chat/history/route";

/** Build a minimal Request with URL */
function makeRequest(query = ""): Request {
  return new Request(`http://localhost/api/chat/history${query}`);
}

describe("GET /api/chat/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when actions.jsonl does not exist", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual([]);
  });

  it("returns parsed messages from valid JSONL", async () => {
    const lines = [
      JSON.stringify({ action: "to_arch", from: "human", to: "arch", ts: 1000, message: "hello" }),
      JSON.stringify({ action: "dev_do", from: "arch", to: "dev", ts: 1001, message: "task assigned" }),
    ].join("\n");

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(lines);

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0].from).toBe("human");
    expect(data[0].message).toBe("hello");
    expect(data[1].from).toBe("arch");
    expect(data[1].message).toBe("task assigned");
  });

  it("skips invalid JSON lines gracefully", async () => {
    const lines = [
      JSON.stringify({ action: "to_arch", from: "human", to: "arch", ts: 1000, message: "valid" }),
      "this is not json",
      JSON.stringify({ action: "to_human", from: "dev", to: "human", ts: 1002, message: "also valid" }),
    ].join("\n");

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(lines);

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0].message).toBe("valid");
    expect(data[1].message).toBe("also valid");
  });

  it("handles empty file content", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("");

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual([]);
  });

  it("handles file with only whitespace/newlines", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("\n\n  \n");

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual([]);
  });

  it("returns 500 on read error", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe("Failed to read chat history");
  });

  it("reads from correct path (workspace/spec/actions.jsonl)", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({ action: "to_arch", from: "human", to: "arch", ts: 1000, message: "x" })
    );

    await GET(makeRequest());

    expect(fs.existsSync).toHaveBeenCalledWith("/fake/workspace/spec/actions.jsonl");
    expect(fs.readFileSync).toHaveBeenCalledWith("/fake/workspace/spec/actions.jsonl", "utf-8");
  });

  it("preserves all fields from JSONL entries", async () => {
    const entry = { action: "dev_do", from: "arch", to: "dev", ts: 12345, message: "implement feature", extra: "field" };
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(entry));

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data[0]).toEqual(entry);
  });

  it("uses workspace query param when provided", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({ action: "to_arch", from: "human", to: "arch", ts: 1000, message: "x" })
    );

    await GET(makeRequest("?workspace=/custom/project"));

    expect(fs.existsSync).toHaveBeenCalledWith("/custom/project/spec/actions.jsonl");
  });
});
