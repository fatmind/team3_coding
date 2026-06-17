/**
 * Unit tests for /api/files/* route handlers.
 * All fs operations and workspace resolution are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import path from "node:path";

// Mock modules before importing handlers
vi.mock("node:fs");

vi.mock("@/lib/workspace", () => {
  const _path = require("path");
  return {
    resolveWorkspace: vi.fn((ws?: string | null) => ws || "/workspace"),
    resolveSafePath: vi.fn((relativePath: string, root: string) => {
      const resolved = _path.resolve(root, relativePath);
      const normalizedRoot = _path.resolve(root) + _path.sep;
      if (resolved === _path.resolve(root) || resolved.startsWith(normalizedRoot)) {
        return resolved;
      }
      return null;
    }),
  };
});

import { GET as listGET } from "../src/app/api/files/list/route";
import { GET as contentGET } from "../src/app/api/files/content/route";
import { GET as rawGET } from "../src/app/api/files/raw/route";
import { PUT as updatePUT } from "../src/app/api/files/update/route";
import { resolveSafePath } from "@/lib/workspace";

function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options);
}

describe("GET /api/files/list", () => {
  beforeEach(() => {
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
  });

  it("returns 400 when path parameter is missing", async () => {
    const req = makeRequest("http://localhost:3000/api/files/list");
    const res = await listGET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("path");
  });

  it("returns 403 for path traversal attempt", async () => {
    const req = makeRequest("http://localhost:3000/api/files/list?path=../../etc");
    const res = await listGET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("traversal");
  });

  it("returns 404 for non-existent path", async () => {
    vi.mocked(fs.statSync).mockImplementation(() => {
      const err = new Error("ENOENT") as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    });

    const req = makeRequest("http://localhost:3000/api/files/list?path=nonexistent");
    const res = await listGET(req);
    expect(res.status).toBe(404);
  });

  it("returns 400 when path points to a file instead of directory", async () => {
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
    } as unknown as fs.Stats);

    const req = makeRequest("http://localhost:3000/api/files/list?path=README.md");
    const res = await listGET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not a directory");
  });

  it("returns directory listing with name and type", async () => {
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
    } as unknown as fs.Stats);

    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: "app_design.md", isDirectory: () => false },
      { name: "agents", isDirectory: () => true },
      { name: "actions.jsonl", isDirectory: () => false },
    ] as any);

    const req = makeRequest("http://localhost:3000/api/files/list?path=spec");
    const res = await listGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { name: "app_design.md", type: "file" },
      { name: "agents", type: "dir" },
      { name: "actions.jsonl", type: "file" },
    ]);
  });
});

describe("GET /api/files/content", () => {
  beforeEach(() => {
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it("returns 400 when path parameter is missing", async () => {
    const req = makeRequest("http://localhost:3000/api/files/content");
    const res = await contentGET(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 for path traversal attempt", async () => {
    const req = makeRequest("http://localhost:3000/api/files/content?path=../../../etc/passwd");
    const res = await contentGET(req);
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent file", async () => {
    vi.mocked(fs.statSync).mockImplementation(() => {
      const err = new Error("ENOENT") as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    });

    const req = makeRequest("http://localhost:3000/api/files/content?path=missing.md");
    const res = await contentGET(req);
    expect(res.status).toBe(404);
  });

  it("returns 400 when path points to a directory", async () => {
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => false,
      isDirectory: () => true,
    } as unknown as fs.Stats);

    const req = makeRequest("http://localhost:3000/api/files/content?path=spec");
    const res = await contentGET(req);
    expect(res.status).toBe(400);
  });

  it("returns file content and mtime", async () => {
    const content = "# Hello World\n\nTest content.";
    const mtimeMs = 1716652800000;

    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
      mtimeMs,
    } as unknown as fs.Stats);

    vi.mocked(fs.readFileSync).mockReturnValue(content);

    const req = makeRequest("http://localhost:3000/api/files/content?path=spec/app_design.md");
    const res = await contentGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("text");
    expect(body.content).toBe(content);
    expect(body.mtime).toBe(Math.floor(mtimeMs));
  });

  it("returns image metadata without reading binary as text", async () => {
    const mtimeMs = 1716652800000;

    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
      mtimeMs,
    } as unknown as fs.Stats);

    const req = makeRequest(
      "http://localhost:3000/api/files/content?path=spec/ux_badminton.png"
    );
    const res = await contentGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      kind: "image",
      mimeType: "image/png",
      mtime: Math.floor(mtimeMs),
    });
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});

describe("GET /api/files/raw", () => {
  beforeEach(() => {
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it("returns 400 for non-image files", async () => {
    const req = makeRequest("http://localhost:3000/api/files/raw?path=spec/app_design.md");
    const res = await rawGET(req);
    expect(res.status).toBe(400);
  });

  it("returns binary image with content-type header", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
    } as unknown as fs.Stats);
    vi.mocked(fs.readFileSync).mockReturnValue(pngBytes);

    const req = makeRequest("http://localhost:3000/api/files/raw?path=spec/ux.png");
    const res = await rawGET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(pngBytes)).toBe(true);
  });
});

describe("PUT /api/files/update", () => {
  beforeEach(() => {
    vi.mocked(fs.mkdirSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = makeRequest("http://localhost:3000/api/files/update", {
      method: "PUT",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await updatePUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("JSON");
  });

  it("returns 400 when path field is missing", async () => {
    const req = makeRequest("http://localhost:3000/api/files/update", {
      method: "PUT",
      body: JSON.stringify({ content: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await updatePUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("path");
  });

  it("returns 400 when content field is missing", async () => {
    const req = makeRequest("http://localhost:3000/api/files/update", {
      method: "PUT",
      body: JSON.stringify({ path: "test.md" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await updatePUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("content");
  });

  it("returns 403 for path traversal", async () => {
    const req = makeRequest("http://localhost:3000/api/files/update", {
      method: "PUT",
      body: JSON.stringify({ path: "../../etc/evil", content: "hack" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await updatePUT(req);
    expect(res.status).toBe(403);
  });

  it("writes file successfully and returns 200", async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const req = makeRequest("http://localhost:3000/api/files/update", {
      method: "PUT",
      body: JSON.stringify({ path: "spec/test.md", content: "# Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await updatePUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify fs.writeFileSync was called with correct content
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("spec/test.md"),
      "# Test",
      "utf-8"
    );
  });

  it("returns 500 when write fails", async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const req = makeRequest("http://localhost:3000/api/files/update", {
      method: "PUT",
      body: JSON.stringify({ path: "spec/test.md", content: "# Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await updatePUT(req);
    expect(res.status).toBe(500);
  });
});
