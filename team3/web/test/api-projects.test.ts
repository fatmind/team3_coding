/**
 * Unit tests for GET /api/projects and POST /api/project/init.
 * All fs and workspace operations are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock workspace
vi.mock("@/lib/workspace", () => ({
  loadProjects: vi.fn(),
  addProject: vi.fn(),
}));

// Mock init-workspace
vi.mock("@/lib/init/init-workspace", () => ({
  initWorkspace: vi.fn(),
}));

import * as fs from "node:fs";
import { loadProjects, addProject } from "@/lib/workspace";
import { initWorkspace } from "@/lib/init/init-workspace";
import { GET } from "@/app/api/projects/route";
import { POST } from "@/app/api/project/init/route";

function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options);
}

describe("GET /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns project list from data/projects.json", async () => {
    (loadProjects as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "my-app", workspace: "/projects/my-app", createdTime: "2026-05-28" },
    ]);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("my-app");
  });

  it("returns empty array when no projects", async () => {
    (loadProjects as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual([]);
  });

  it("returns 500 when loadProjects throws", async () => {
    (loadProjects as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("read failed");
    });

    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/project/init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (initWorkspace as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  });

  it("creates project and registers in data/projects.json", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new-project", parentDir: "/test/projects" }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.workspace).toBe("/test/projects/new-project");
    expect(initWorkspace).toHaveBeenCalledWith("/test/projects/new-project");
    expect(addProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "new-project", workspace: "/test/projects/new-project" })
    );
  });

  it("returns 400 for missing name", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid project name", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "bad name!", parentDir: "/test/projects" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when parentDir is missing", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "good-name" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("parentDir");
  });

  it("returns 400 when parentDir is not absolute", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "good-name", parentDir: "relative/path" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("absolute");
  });

  it("returns 409 when project dir already exists", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "existing", parentDir: "/test/projects" }),
      })
    );
    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when initWorkspace throws", async () => {
    (initWorkspace as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("fs error");
    });

    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "fail-project", parentDir: "/test/projects" }),
      })
    );
    expect(res.status).toBe(500);
  });

  it("creates project in specified parentDir", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "my-proj", parentDir: "/custom/dir" }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.workspace).toBe("/custom/dir/my-proj");
    expect(initWorkspace).toHaveBeenCalledWith("/custom/dir/my-proj");
  });
});
