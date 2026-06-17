/**
 * E2E Integration Test for Feature #1: initWorkspace
 *
 * Checkpoint verification (from spec/module_2_feature_list.json):
 *   Step 1: web/ is a valid Next.js project (package.json has next dep, tsconfig.json exists, src/ exists)
 *   Step 2: After calling initWorkspace, target path has spec/app_design.md, spec/actions.jsonl,
 *           spec/decision_log.md, cli/, uat/, logs/, .team3-project.json
 *   Step 3: .team3-project.json matches schema (name, createdTime, workspace, init_workspace=true, partner structure)
 *   Step 4: Repeated initWorkspace calls are idempotent (don't overwrite existing files)
 *
 * Test project path: /Users/bohan.sj/dev/open/team_coding3/example/test1/
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { initWorkspace, Team3ProjectJson } from "../../src/lib/init/init-workspace";

const TEST_PROJECT_PATH = "/Users/bohan.sj/dev/open/team_coding3/example/test1";
const WEB_DIR = path.resolve(__dirname, "../../");

describe("Feature #1: Web Engineering Init + initWorkspace", () => {
  // Clean up test directory before and after
  beforeAll(() => {
    // Remove test directory if it exists from a previous run
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Clean up after tests
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
  });

  describe("Step 1: web/ is a valid Next.js project", () => {
    it("package.json exists and contains next dependency", () => {
      const pkgPath = path.join(WEB_DIR, "package.json");
      expect(fs.existsSync(pkgPath)).toBe(true);

      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      expect(pkg.dependencies).toHaveProperty("next");
    });

    it("tsconfig.json exists", () => {
      const tsconfigPath = path.join(WEB_DIR, "tsconfig.json");
      expect(fs.existsSync(tsconfigPath)).toBe(true);
    });

    it("src/ directory exists", () => {
      const srcPath = path.join(WEB_DIR, "src");
      expect(fs.existsSync(srcPath)).toBe(true);
      expect(fs.statSync(srcPath).isDirectory()).toBe(true);
    });
  });

  describe("Step 2: initWorkspace generates skeleton files", () => {
    beforeAll(() => {
      initWorkspace(TEST_PROJECT_PATH);
    });

    it("spec/app_design.md exists", () => {
      const filePath = path.join(TEST_PROJECT_PATH, "spec/app_design.md");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    });

    it("cli/ directory exists with scaffold files copied from team3/cli/", () => {
      const cliDir = path.join(TEST_PROJECT_PATH, "cli");
      const cliSourceDir = path.join(WEB_DIR, "../cli");
      expect(fs.existsSync(cliDir)).toBe(true);
      expect(fs.statSync(cliDir).isDirectory()).toBe(true);

      const sourceFiles = fs.readdirSync(cliSourceDir).filter((f) => f.endsWith(".mjs"));
      expect(sourceFiles.length).toBeGreaterThan(0);

      for (const f of sourceFiles) {
        const filePath = path.join(cliDir, f);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8")).toBe(
          fs.readFileSync(path.join(cliSourceDir, f), "utf-8")
        );
      }
    });

    it("uat/ and logs/ directories exist", () => {
      expect(fs.statSync(path.join(TEST_PROJECT_PATH, "uat")).isDirectory()).toBe(true);
      expect(fs.statSync(path.join(TEST_PROJECT_PATH, "logs")).isDirectory()).toBe(true);
    });

    it("does NOT create spec/agents/ (prompts are embedded, not copied)", () => {
      expect(fs.existsSync(path.join(TEST_PROJECT_PATH, "spec/agents"))).toBe(false);
    });

    it("does NOT create spec/modules_progress.json at init", () => {
      expect(fs.existsSync(path.join(TEST_PROJECT_PATH, "spec/modules_progress.json"))).toBe(false);
    });

    it("spec/actions.jsonl exists", () => {
      const filePath = path.join(TEST_PROJECT_PATH, "spec/actions.jsonl");
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("spec/decision_log.md exists", () => {
      const filePath = path.join(TEST_PROJECT_PATH, "spec/decision_log.md");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("Decision Log");
    });

    it(".team3-project.json exists", () => {
      const filePath = path.join(TEST_PROJECT_PATH, ".team3-project.json");
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("Step 3: .team3-project.json matches schema", () => {
    let projectJson: Team3ProjectJson;

    beforeAll(() => {
      const filePath = path.join(TEST_PROJECT_PATH, ".team3-project.json");
      projectJson = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    });

    it("has name field (string, derived from path)", () => {
      expect(typeof projectJson.name).toBe("string");
      expect(projectJson.name).toBe("test1");
    });

    it("has createdTime in yyyy-MM-dd format", () => {
      expect(projectJson.createdTime).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("has workspace field matching the provided path", () => {
      expect(projectJson.workspace).toBe(TEST_PROJECT_PATH);
    });

    it("has init_workspace = true", () => {
      expect(projectJson.init_workspace).toBe(true);
    });

    it("has partner.human structure", () => {
      expect(projectJson.partner).toHaveProperty("human");
      expect(projectJson.partner.human).toHaveProperty("name");
      expect(projectJson.partner.human).toHaveProperty("avatar");
    });

    it("has partner.arch_agent with session.runing", () => {
      expect(projectJson.partner).toHaveProperty("arch_agent");
      expect(projectJson.partner.arch_agent).toHaveProperty("session");
      expect(projectJson.partner.arch_agent.session).toHaveProperty("runing");
    });

    it("has partner.uat_agent with session.runing", () => {
      expect(projectJson.partner).toHaveProperty("uat_agent");
      expect(projectJson.partner.uat_agent).toHaveProperty("session");
      expect(projectJson.partner.uat_agent.session).toHaveProperty("runing");
    });

    it("has partner.dev_agent with session.runing and done[]", () => {
      expect(projectJson.partner).toHaveProperty("dev_agent");
      expect(projectJson.partner.dev_agent).toHaveProperty("session");
      expect(projectJson.partner.dev_agent.session).toHaveProperty("runing");
      expect(projectJson.partner.dev_agent.session).toHaveProperty("done");
      expect(Array.isArray(projectJson.partner.dev_agent.session.done)).toBe(true);
    });
  });

  describe("Step 4: Repeated calls are idempotent", () => {
    const MARKER_CONTENT = "# Custom App Design - DO NOT OVERWRITE\n";

    beforeAll(() => {
      // Modify an existing file to verify it's not overwritten
      const appDesignPath = path.join(TEST_PROJECT_PATH, "spec/app_design.md");
      fs.writeFileSync(appDesignPath, MARKER_CONTENT, "utf-8");

      // Modify .team3-project.json to verify it's not overwritten
      const projectJsonPath = path.join(TEST_PROJECT_PATH, ".team3-project.json");
      const existing = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
      existing.name = "custom-name-do-not-overwrite";
      fs.writeFileSync(projectJsonPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");

      // Call initWorkspace again
      initWorkspace(TEST_PROJECT_PATH);
    });

    it("does not overwrite spec/app_design.md", () => {
      const filePath = path.join(TEST_PROJECT_PATH, "spec/app_design.md");
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe(MARKER_CONTENT);
    });

    it("does not overwrite .team3-project.json", () => {
      const filePath = path.join(TEST_PROJECT_PATH, ".team3-project.json");
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content.name).toBe("custom-name-do-not-overwrite");
    });

    it("does not overwrite spec/actions.jsonl after content added", () => {
      const filePath = path.join(TEST_PROJECT_PATH, "spec/actions.jsonl");
      // Write some content
      fs.writeFileSync(filePath, '{"action":"test"}\n', "utf-8");
      // Call again
      initWorkspace(TEST_PROJECT_PATH);
      // Content should be preserved
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe('{"action":"test"}\n');
    });

    it("does not overwrite spec/decision_log.md after content added", () => {
      const filePath = path.join(TEST_PROJECT_PATH, "spec/decision_log.md");
      const custom = "# Decision Log\n\n## Custom entry\n";
      fs.writeFileSync(filePath, custom, "utf-8");
      initWorkspace(TEST_PROJECT_PATH);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe(custom);
    });

    it("does not overwrite cli/ scaffold after content added", () => {
      const filePath = path.join(TEST_PROJECT_PATH, "cli/logger.mjs");
      const custom = "// custom logger - do not overwrite\n";
      fs.writeFileSync(filePath, custom, "utf-8");
      initWorkspace(TEST_PROJECT_PATH);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe(custom);
    });
  });
});
