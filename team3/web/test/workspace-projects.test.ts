/**
 * Unit tests for workspace.ts functions:
 * - resolveWorkspace()
 * - loadProjects() / saveProjects() / addProject()
 * - getProjectsDir()
 *
 * All fs operations are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";

// Mock node:fs before importing
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from "node:fs";
import { resolveWorkspace, loadProjects, saveProjects, addProject, getProjectsDir } from "@/lib/workspace";

describe("resolveWorkspace", () => {
  it("returns provided workspace path when given", () => {
    const result = resolveWorkspace("/my/project");
    expect(result).toBe("/my/project");
  });

  it("returns absolute path for relative input", () => {
    const result = resolveWorkspace("relative/path");
    expect(result).not.toBeNull();
    expect(path.isAbsolute(result!)).toBe(true);
  });

  it("returns null when null is passed", () => {
    expect(resolveWorkspace(null)).toBeNull();
  });

  it("returns null when undefined is passed", () => {
    expect(resolveWorkspace(undefined)).toBeNull();
  });

  it("returns null when empty string is passed", () => {
    expect(resolveWorkspace("")).toBeNull();
  });
});

describe("getProjectsDir", () => {
  const originalEnv = process.env.TEAM3_PROJECTS_DIR;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TEAM3_PROJECTS_DIR = originalEnv;
    } else {
      delete process.env.TEAM3_PROJECTS_DIR;
    }
  });

  it("returns TEAM3_PROJECTS_DIR env when set", () => {
    process.env.TEAM3_PROJECTS_DIR = "/custom/projects";
    expect(getProjectsDir()).toBe("/custom/projects");
  });

  it("returns default (parent of team3/) when env not set", () => {
    delete process.env.TEAM3_PROJECTS_DIR;
    const result = getProjectsDir();
    expect(path.isAbsolute(result)).toBe(true);
  });
});

describe("loadProjects", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns empty array when file does not exist", () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(loadProjects()).toEqual([]);
  });

  it("returns parsed array from valid JSON", () => {
    const data = [{ name: "a", workspace: "/a", createdTime: "2026-01-01" }];
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(data));
    expect(loadProjects()).toEqual(data);
  });

  it("returns empty array for invalid JSON", () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("not json");
    expect(loadProjects()).toEqual([]);
  });

  it("returns empty array when JSON is not an array", () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({ x: 1 }));
    expect(loadProjects()).toEqual([]);
  });
});

describe("saveProjects", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("writes JSON to data/projects.json", () => {
    const projects = [{ name: "p", workspace: "/p", createdTime: "2026-01-01" }];
    saveProjects(projects);
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("projects.json"),
      expect.stringContaining('"name": "p"'),
      "utf-8"
    );
  });
});

describe("addProject", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("adds project when list is empty", () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    addProject({ name: "new", workspace: "/new", createdTime: "2026-05-28" });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("projects.json"),
      expect.stringContaining('"name": "new"'),
      "utf-8"
    );
  });

  it("skips duplicate workspace", () => {
    const existing = [{ name: "old", workspace: "/existing", createdTime: "2026-01-01" }];
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(existing));
    addProject({ name: "dup", workspace: "/existing", createdTime: "2026-05-28" });
    // Should not write since workspace already exists
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("appends to existing list", () => {
    const existing = [{ name: "old", workspace: "/old", createdTime: "2026-01-01" }];
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(existing));
    addProject({ name: "new", workspace: "/new", createdTime: "2026-05-28" });
    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].name).toBe("new");
  });
});
