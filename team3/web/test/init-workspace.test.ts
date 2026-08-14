/**
 * Unit tests for initWorkspace.
 * All filesystem operations are mocked — tests are independent of real fs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Mock the entire fs module
vi.mock("node:fs");

// Import after mock setup
import { initWorkspace } from "../src/lib/init/init-workspace";

describe("initWorkspace", () => {
  const WORKSPACE = "/tmp/test-project";

  let writtenFiles: Map<string, string>;
  let createdDirs: Set<string>;
  let existingFiles: Set<string>;
  let cliContents: Map<string, string>;

  const CLI_FILES = [
    "simulate_human.mjs",
    "logger.mjs",
    "browser.mjs",
    "watchdog.mjs",
    "write-action.mjs",
    "validate-uat-evidence.mjs",
    "init-ui-rules.mjs",
    "init-ui-rules-core.mjs",
  ];

  beforeEach(() => {
    writtenFiles = new Map();
    createdDirs = new Set();
    existingFiles = new Set();
    cliContents = new Map();

    for (const f of CLI_FILES) {
      cliContents.set(f, `// CLI scaffold: ${f}\nmodule.exports = {};`);
    }

    vi.mocked(fs.mkdirSync).mockImplementation((dirPath) => {
      createdDirs.add(String(dirPath));
      return undefined;
    });

    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      const p = String(filePath);
      if (existingFiles.has(p)) return true;
      // CLI source files: only match source paths (not under workspace)
      if (!p.startsWith(WORKSPACE)) {
        for (const key of cliContents.keys()) {
          if (p.endsWith(`/cli/${key}`)) return true;
        }
      }
      return false;
    });

    vi.mocked(fs.readFileSync).mockImplementation((filePath, _options?) => {
      const p = String(filePath);
      if (!p.startsWith(WORKSPACE)) {
        for (const [key, content] of cliContents) {
          if (p.endsWith(`/cli/${key}`)) {
            return content;
          }
        }
      }
      return "";
    });

    vi.mocked(fs.writeFileSync).mockImplementation((filePath, data) => {
      writtenFiles.set(String(filePath), String(data));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates workspace root directory", () => {
    initWorkspace(WORKSPACE);
    expect(createdDirs.has(WORKSPACE)).toBe(true);
  });

  it("creates spec/ directory", () => {
    initWorkspace(WORKSPACE);
    expect(createdDirs.has(path.join(WORKSPACE, "spec"))).toBe(true);
  });

  it("creates cli/ directory", () => {
    initWorkspace(WORKSPACE);
    expect(createdDirs.has(path.join(WORKSPACE, "cli"))).toBe(true);
  });

  it("creates uat/ directory", () => {
    initWorkspace(WORKSPACE);
    expect(createdDirs.has(path.join(WORKSPACE, "uat"))).toBe(true);
  });

  it("creates logs/ directory", () => {
    initWorkspace(WORKSPACE);
    expect(createdDirs.has(path.join(WORKSPACE, "logs"))).toBe(true);
  });

  it("creates spec/app_design.md with template content", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "spec/app_design.md");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toContain("# App Design");
  });

  it("creates spec/actions.jsonl as empty file", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "spec/actions.jsonl");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toBe("");
  });

  it("creates spec/decisions.md", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "spec/decisions.md");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toContain("生效的人类决策");
  });

  it("creates spec/experience.md", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "spec/experience.md");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toContain("Agent 经验教训");
  });

  it("does NOT create spec/modules_progress.json", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "spec/modules_progress.json");
    expect(writtenFiles.has(filePath)).toBe(false);
  });

  it("creates .team3-project.json with correct schema", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, ".team3-project.json");
    expect(writtenFiles.has(filePath)).toBe(true);
    const content = JSON.parse(writtenFiles.get(filePath)!);

    expect(content.name).toBe("test-project");
    expect(content.createdTime).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(content.workspace).toBe(WORKSPACE);
    expect(content.init_workspace).toBe(true);
    expect(content.init_daemon).toBe("");
    expect(content.daemon_heart).toBe("");

    expect(content.partner).toHaveProperty("human");
    expect(content.partner).toHaveProperty("arch_agent");
    expect(content.partner).toHaveProperty("uat_agent");
    expect(content.partner).toHaveProperty("dev_agent");

    expect(content.partner.arch_agent.session).toHaveProperty("runing");
    expect(content.partner.dev_agent.session).toHaveProperty("done");
    expect(Array.isArray(content.partner.dev_agent.session.done)).toBe(true);
  });

  // --- CLI scaffold copy tests ---

  it("copies simulate_human.mjs to cli/simulate_human.mjs", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "cli/simulate_human.mjs");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toContain("CLI scaffold: simulate_human.mjs");
  });

  it("copies logger.mjs to cli/logger.mjs", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "cli/logger.mjs");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toContain("CLI scaffold: logger.mjs");
  });

  it("copies browser.mjs to cli/browser.mjs", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "cli/browser.mjs");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toContain("CLI scaffold: browser.mjs");
  });

  it("copies watchdog.mjs to cli/watchdog.mjs", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "cli/watchdog.mjs");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toContain("CLI scaffold: watchdog.mjs");
  });

  it("copies validate-uat-evidence.mjs to cli/validate-uat-evidence.mjs", () => {
    initWorkspace(WORKSPACE);
    const filePath = path.join(WORKSPACE, "cli/validate-uat-evidence.mjs");
    expect(writtenFiles.has(filePath)).toBe(true);
    expect(writtenFiles.get(filePath)).toContain("CLI scaffold: validate-uat-evidence.mjs");
  });

  // --- Idempotency tests ---

  it("does NOT overwrite existing cli/ scaffold files", () => {
    for (const f of CLI_FILES) {
      existingFiles.add(path.join(WORKSPACE, `cli/${f}`));
    }
    initWorkspace(WORKSPACE);
    for (const f of CLI_FILES) {
      expect(writtenFiles.has(path.join(WORKSPACE, `cli/${f}`))).toBe(false);
    }
  });

  it("does NOT overwrite existing spec/app_design.md", () => {
    existingFiles.add(path.join(WORKSPACE, "spec/app_design.md"));
    initWorkspace(WORKSPACE);
    expect(writtenFiles.has(path.join(WORKSPACE, "spec/app_design.md"))).toBe(false);
  });

  it("does NOT overwrite existing .team3-project.json", () => {
    existingFiles.add(path.join(WORKSPACE, ".team3-project.json"));
    initWorkspace(WORKSPACE);
    expect(writtenFiles.has(path.join(WORKSPACE, ".team3-project.json"))).toBe(false);
  });

  it("does NOT overwrite existing spec/actions.jsonl", () => {
    existingFiles.add(path.join(WORKSPACE, "spec/actions.jsonl"));
    initWorkspace(WORKSPACE);
    expect(writtenFiles.has(path.join(WORKSPACE, "spec/actions.jsonl"))).toBe(false);
  });

  it("does NOT overwrite existing spec/decisions.md", () => {
    existingFiles.add(path.join(WORKSPACE, "spec/decisions.md"));
    initWorkspace(WORKSPACE);
    expect(writtenFiles.has(path.join(WORKSPACE, "spec/decisions.md"))).toBe(false);
  });

  it("creates all skeleton + CLI scaffold files in one call", () => {
    initWorkspace(WORKSPACE);

    const expectedFiles = [
      path.join(WORKSPACE, "spec/app_design.md"),
      path.join(WORKSPACE, "spec/actions.jsonl"),
      path.join(WORKSPACE, "spec/decisions.md"),
      path.join(WORKSPACE, "spec/experience.md"),
      path.join(WORKSPACE, ".team3-project.json"),
      ...CLI_FILES.map((file) => path.join(WORKSPACE, `cli/${file}`)),
    ];

    for (const f of expectedFiles) {
      expect(writtenFiles.has(f)).toBe(true);
    }
  });

  it("handles relative path by resolving it", () => {
    initWorkspace("./relative-project");
    expect(createdDirs.size).toBeGreaterThan(0);
  });

  it("project name is derived from last path segment", () => {
    initWorkspace("/home/user/my-awesome-app");
    const filePath = path.join("/home/user/my-awesome-app", ".team3-project.json");
    expect(writtenFiles.has(filePath)).toBe(true);
    const content = JSON.parse(writtenFiles.get(filePath)!);
    expect(content.name).toBe("my-awesome-app");
  });
});
