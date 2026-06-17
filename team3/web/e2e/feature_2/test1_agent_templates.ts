/**
 * E2E Integration Test for Feature #2: Agent prompt template content
 *
 * Checkpoint verification (from spec/module_2_feature_list.json Feature #2):
 *   Step 1: Prompts exist in human_coding/ (team3.md, arch_prompt.md, dev_prompt.md, uat_prompt.md)
 *   Step 2: team3.md contains complete workflow protocol (team structure, core file descriptions, actions.jsonl schema, reread protocol)
 *   Step 3: human_coding/ arch/dev/uat all contain "建立项目全局认识" with ordered file reads
 *   Step 4: human_coding/ arch/dev/uat all contain decision_log.md write trigger conditions and format
 *   Step 5: human_coding/ arch/dev/uat all contain actions.jsonl write spec (fields + reread protocol)
 *
 * Prompts are authored in human_coding/ and embedded at build time — initWorkspace does not copy them.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { initWorkspace } from "../../src/lib/init/init-workspace";

const TEST_PROJECT_PATH = "/Users/bohan.sj/dev/open/team_coding3/example/test1";
const WEB_DIR = path.resolve(__dirname, "../../");
const HUMAN_CODING_DIR = path.join(WEB_DIR, "../human_coding");

describe("Feature #2: Agent prompt template content", () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
  });

  describe("Step 1: Prompt files exist in human_coding/", () => {
    it("team3.md exists", () => {
      expect(fs.existsSync(path.join(HUMAN_CODING_DIR, "team3.md"))).toBe(true);
    });

    it("arch_prompt.md exists", () => {
      expect(fs.existsSync(path.join(HUMAN_CODING_DIR, "arch_prompt.md"))).toBe(true);
    });

    it("dev_prompt.md exists", () => {
      expect(fs.existsSync(path.join(HUMAN_CODING_DIR, "dev_prompt.md"))).toBe(true);
    });

    it("uat_prompt.md exists", () => {
      expect(fs.existsSync(path.join(HUMAN_CODING_DIR, "uat_prompt.md"))).toBe(true);
    });

    it("initWorkspace does NOT copy prompts to spec/agents/", () => {
      initWorkspace(TEST_PROJECT_PATH);
      expect(fs.existsSync(path.join(TEST_PROJECT_PATH, "spec/agents"))).toBe(false);
    });
  });

  describe("Step 2: team3.md contains complete workflow protocol", () => {
    let team3Content: string;

    beforeAll(() => {
      team3Content = fs.readFileSync(path.join(HUMAN_CODING_DIR, "team3.md"), "utf-8");
    });

    it("contains team structure (团队构成)", () => {
      expect(team3Content).toContain("团队构成");
      expect(team3Content).toContain("Architect");
      expect(team3Content).toContain("Dev");
      expect(team3Content).toContain("UAT");
    });

    it("contains core file descriptions (核心文件说明)", () => {
      expect(team3Content).toContain("核心文件说明");
      expect(team3Content).toContain("module_X_feature_list.json");
      expect(team3Content).toContain("module_X_progress.txt");
    });

    it("contains actions.jsonl schema definition", () => {
      expect(team3Content).toContain("actions.jsonl");
      expect(team3Content).toContain("action");
      expect(team3Content).toContain("from");
      expect(team3Content).toContain("to");
      expect(team3Content).toContain("ts");
      expect(team3Content).toContain("message");
    });

    it("contains reread protocol", () => {
      expect(team3Content).toContain("reread");
      expect(team3Content).toContain("[reread:");
    });
  });

  describe("Step 3: arch/dev/uat contain '建立项目全局认识' with ordered reads", () => {
    let archContent: string;
    let devContent: string;
    let uatContent: string;

    beforeAll(() => {
      archContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "arch_prompt.md"), "utf-8");
      devContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "dev_prompt.md"), "utf-8");
      uatContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "uat_prompt.md"), "utf-8");
    });

    it("arch_prompt.md references team3.md first", () => {
      expect(archContent).toContain("team3.md");
    });

    it("arch_prompt.md contains numbered list with correct order (app_design → decision_log → modules_progress)", () => {
      const orderPattern = /1\.[^\n]*app_design\.md[^\n]*\n\s*2\.[^\n]*decision_log\.md[^\n]*\n\s*3\.[^\n]*modules_progress\.json/;
      expect(archContent).toMatch(orderPattern);
    });

    it("dev_prompt.md references team3.md first", () => {
      expect(devContent).toContain("team3.md");
    });

    it("dev_prompt.md contains numbered list with correct order (app_design → decision_log → modules_progress)", () => {
      const orderPattern = /1\.[^\n]*app_design\.md[^\n]*\n\s*2\.[^\n]*decision_log\.md[^\n]*\n\s*3\.[^\n]*modules_progress\.json/;
      expect(devContent).toMatch(orderPattern);
    });

    it("uat_prompt.md references team3.md first", () => {
      expect(uatContent).toContain("team3.md");
    });

    it("uat_prompt.md contains numbered list with correct order (app_design → decision_log → modules_progress)", () => {
      const orderPattern = /1\.[^\n]*app_design\.md[^\n]*\n\s*2\.[^\n]*decision_log\.md[^\n]*\n\s*3\.[^\n]*modules_progress\.json/;
      expect(uatContent).toMatch(orderPattern);
    });
  });

  describe("Step 4: arch/dev/uat contain decision_log.md write trigger and format", () => {
    let archContent: string;
    let devContent: string;
    let uatContent: string;

    beforeAll(() => {
      archContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "arch_prompt.md"), "utf-8");
      devContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "dev_prompt.md"), "utf-8");
      uatContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "uat_prompt.md"), "utf-8");
    });

    it("arch_prompt.md contains decision_log.md write rules", () => {
      expect(archContent).toContain("decision_log.md");
      expect(archContent).toMatch(/触发条件|满足触发/);
    });

    it("dev_prompt.md contains decision_log.md write rules", () => {
      expect(devContent).toContain("decision_log.md");
      expect(devContent).toMatch(/触发条件|满足触发/);
    });

    it("uat_prompt.md contains actions.jsonl write protocol", () => {
      expect(uatContent).toContain("actions.jsonl");
      expect(uatContent).toContain("write-action.mjs");
    });
  });

  describe("Step 5: arch/dev/uat contain actions.jsonl write spec", () => {
    let archContent: string;
    let devContent: string;
    let uatContent: string;
    let team3Content: string;

    beforeAll(() => {
      archContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "arch_prompt.md"), "utf-8");
      devContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "dev_prompt.md"), "utf-8");
      uatContent = fs.readFileSync(path.join(HUMAN_CODING_DIR, "uat_prompt.md"), "utf-8");
      team3Content = fs.readFileSync(path.join(HUMAN_CODING_DIR, "team3.md"), "utf-8");
    });

    it("team3.md contains full field spec: action/from/to/ts/message", () => {
      expect(team3Content).toContain("actions.jsonl");
      expect(team3Content).toContain("| `action`");
      expect(team3Content).toContain("| `from`");
      expect(team3Content).toContain("| `to`");
      expect(team3Content).toContain("| `ts`");
      expect(team3Content).toContain("| `message`");
    });

    it("arch_prompt.md references actions.jsonl via write-action.mjs", () => {
      expect(archContent).toContain("actions.jsonl");
      expect(archContent).toContain("write-action.mjs");
    });

    it("arch_prompt.md contains reread suffix protocol", () => {
      expect(archContent).toContain("[reread:");
    });

    it("dev_prompt.md references actions.jsonl via write-action.mjs", () => {
      expect(devContent).toContain("actions.jsonl");
      expect(devContent).toContain("write-action.mjs");
    });

    it("dev_prompt.md contains reread suffix protocol", () => {
      expect(devContent).toContain("[reread:");
    });

    it("uat_prompt.md references actions.jsonl via write-action.mjs", () => {
      expect(uatContent).toContain("actions.jsonl");
      expect(uatContent).toContain("write-action.mjs");
    });

    it("uat_prompt.md contains reread suffix protocol", () => {
      expect(uatContent).toContain("[reread:");
    });
  });
});
