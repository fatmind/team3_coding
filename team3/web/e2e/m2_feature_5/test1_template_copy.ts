/**
 * E2E test for Module 2 Feature #5:
 * Post-packaging initWorkspace — cli scaffold copy via real HTTP API.
 *
 * Prompts live in human_coding/ and are embedded at build time (not copied to user projects).
 *
 * CRITICAL: Steps 3-5 go through the real Next.js HTTP API (POST /api/project/init),
 * NOT a direct vitest import of initWorkspace.
 *
 * Checkpoints:
 * Step 1: human_coding/ has 4 prompt files; team3/cli/ has scaffold files
 * Step 2: getCliSourceDir() uses process.cwd() (not __dirname-based)
 * Step 3: POST /api/project/init → cli/ has scaffold files, all non-empty
 * Step 4: POST /api/project/init → spec/agents/ is NOT created
 * Step 5: Skeleton files verified via real Next.js HTTP API call
 *
 * Requires: Next.js dev server running on port 3000
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = "http://127.0.0.1:3000";
const API = (route: string) => `${BASE_URL}${route}`;

const TEAM3_DIR = path.join(process.cwd(), "..");
const HUMAN_CODING_DIR = path.join(TEAM3_DIR, "human_coding");
const CLI_SOURCE_DIR = path.join(TEAM3_DIR, "cli");

const TEST_PROJECTS_DIR = path.join(process.cwd(), ".test-template-e2e");
const TEST_PROJECT_NAME = "e2e-template-test";
const TEST_PROJECT_DIR = path.join(TEST_PROJECTS_DIR, TEST_PROJECT_NAME);

const PROJECTS_JSON_PATH = path.join(process.cwd(), "data", "projects.json");
let originalProjectsJson: string | null = null;

const PROMPT_FILES = ["team3.md", "arch_prompt.md", "dev_prompt.md", "uat_prompt.md"];
function listCliSourceFiles(): string[] {
  return fs.readdirSync(CLI_SOURCE_DIR).filter((f) => f.endsWith(".mjs"));
}

async function waitForServer(url: string, maxWaitMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server not ready at ${url} after ${maxWaitMs}ms`);
}

beforeAll(async () => {
  await waitForServer(`${BASE_URL}/health`);

  if (fs.existsSync(PROJECTS_JSON_PATH)) {
    originalProjectsJson = fs.readFileSync(PROJECTS_JSON_PATH, "utf-8");
  }

  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_PROJECTS_DIR, { recursive: true });
}, 30000);

afterAll(() => {
  if (fs.existsSync(TEST_PROJECTS_DIR)) {
    fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });
  }
  if (originalProjectsJson !== null) {
    fs.writeFileSync(PROJECTS_JSON_PATH, originalProjectsJson, "utf-8");
  } else if (fs.existsSync(PROJECTS_JSON_PATH)) {
    fs.unlinkSync(PROJECTS_JSON_PATH);
  }
});

describe("Feature #5: initWorkspace cli copy via real HTTP API", () => {
  describe("Step 1: source directories", () => {
    it("human_coding/ exists with 4 prompt files", () => {
      expect(fs.existsSync(HUMAN_CODING_DIR)).toBe(true);
      for (const f of PROMPT_FILES) {
        const filePath = path.join(HUMAN_CODING_DIR, f);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8").length).toBeGreaterThan(100);
      }
    });

    it("team3/cli/ exists with scaffold files", () => {
      expect(fs.existsSync(CLI_SOURCE_DIR)).toBe(true);
      const cliFiles = listCliSourceFiles();
      expect(cliFiles.length).toBeGreaterThan(0);
      for (const f of cliFiles) {
        const filePath = path.join(CLI_SOURCE_DIR, f);
        expect(fs.readFileSync(filePath, "utf-8").length).toBeGreaterThan(0);
      }
    });
  });

  describe("Step 2: getCliSourceDir uses process.cwd()", () => {
    it("init-workspace.ts does NOT use __dirname in getCliSourceDir", () => {
      const srcPath = path.join(process.cwd(), "src", "lib", "init", "init-workspace.ts");
      const src = fs.readFileSync(srcPath, "utf-8");

      const fnMatch = src.match(/function getCliSourceDir\(\)[^{]*\{([^}]*)\}/);
      expect(fnMatch).not.toBeNull();
      const fnBody = fnMatch![1];

      expect(fnBody).not.toContain("__dirname");
      expect(fnBody).toContain("process.cwd()");
    });
  });

  describe("Steps 3-5: POST /api/project/init via HTTP", () => {
    it("creates project via POST /api/project/init (real Next.js HTTP API)", async () => {
      const res = await fetch(API("/api/project/init"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: TEST_PROJECT_NAME,
          parentDir: TEST_PROJECTS_DIR,
        }),
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspace).toBe(TEST_PROJECT_DIR);
    });

    it("cli/ scaffold files exist and are non-empty", () => {
      for (const f of listCliSourceFiles()) {
        const filePath = path.join(TEST_PROJECT_DIR, "cli", f);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8").length).toBeGreaterThan(0);
      }
    });

    it("cli/logger.mjs content matches team3/cli/ source", () => {
      const src = fs.readFileSync(path.join(CLI_SOURCE_DIR, "logger.mjs"), "utf-8");
      const dest = fs.readFileSync(path.join(TEST_PROJECT_DIR, "cli", "logger.mjs"), "utf-8");
      expect(dest).toBe(src);
    });

    it("spec/agents/ is NOT created (prompts are embedded)", () => {
      expect(fs.existsSync(path.join(TEST_PROJECT_DIR, "spec", "agents"))).toBe(false);
    });

    it("spec/app_design.md and .team3-project.json exist", () => {
      expect(fs.existsSync(path.join(TEST_PROJECT_DIR, "spec", "app_design.md"))).toBe(true);
      expect(fs.existsSync(path.join(TEST_PROJECT_DIR, ".team3-project.json"))).toBe(true);

      const proj = JSON.parse(
        fs.readFileSync(path.join(TEST_PROJECT_DIR, ".team3-project.json"), "utf-8")
      );
      expect(proj.name).toBe(TEST_PROJECT_NAME);
      expect(proj.init_workspace).toBe(true);
    });
  });
});
