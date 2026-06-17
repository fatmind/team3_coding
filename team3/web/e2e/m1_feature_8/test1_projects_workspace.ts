/**
 * Integration tests for Feature #8: Project list + workspace switching + dynamics filtering.
 *
 * Tests all 5 checkpoint steps (refactored for file-based registry):
 * Step 1: GET /api/projects reads from data/projects.json, returns project list
 * Step 2: POST /api/project/init creates new project and registers in data/projects.json
 * Step 3: / homepage shows project cards with create guidance
 * Step 4: Workspace page shows Page 1 layout with workspace param
 * Step 5: All existing APIs require workspace query param (400 without, 200 with)
 *
 * Requires: Next.js dev server running on port 3000
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";

const BASE_URL = "http://127.0.0.1:3000";
const API = (route: string) => `${BASE_URL}${route}`;

// We'll create a temp project dir for testing
const TEST_PROJECTS_DIR = path.join(process.cwd(), ".test-projects-e2e");
const TEST_PROJECT_NAME = "e2e-test-project";
const TEST_PROJECT_DIR = path.join(TEST_PROJECTS_DIR, TEST_PROJECT_NAME);

// Path to data/projects.json (the project registry)
const PROJECTS_JSON_PATH = path.join(process.cwd(), "data", "projects.json");

let browser: Browser;
let page: Page;
let originalProjectsJson: string | null = null;

// Helper to wait for server readiness
async function waitForServer(url: string, maxWaitMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server not ready at ${url} after ${maxWaitMs}ms`);
}

beforeAll(async () => {
  // Wait for dev server
  await waitForServer(`${BASE_URL}/health`);

  // Backup existing projects.json if it exists
  if (fs.existsSync(PROJECTS_JSON_PATH)) {
    originalProjectsJson = fs.readFileSync(PROJECTS_JSON_PATH, "utf-8");
  }

  // Start with a clean registry
  fs.mkdirSync(path.dirname(PROJECTS_JSON_PATH), { recursive: true });
  fs.writeFileSync(PROJECTS_JSON_PATH, "[]", "utf-8");

  // Create test project directory with spec files for API tests
  fs.mkdirSync(TEST_PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_PROJECT_DIR, "spec"), { recursive: true });

  // Write spec files needed by APIs
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, "spec", "actions.jsonl"),
    JSON.stringify({ action: "to_arch", from: "human", to: "arch", ts: 1000, message: "hello from e2e" }) + "\n",
    "utf-8"
  );
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, "spec", "app_design.md"),
    "# E2E Test App Design\n\nTest content.\n",
    "utf-8"
  );
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, "spec", "modules_progress.json"),
    JSON.stringify({
      modules: [{
        id: "module_1", name: "Test Module", cwd: "./", status: "in_progress",
        features: [{ id: 1, description: "Test Feature", status: "done" }]
      }],
      dependencies: []
    }),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, "spec", "module_1_feature_list.json"),
    JSON.stringify([{ id: 1, description: "Test Feature", checkpoint: ["Step 1: test"], passes: true }]),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, "spec", "module_1_progress.txt"),
    "## Current Feature\nfeature_id: 1\nstatus: done\n",
    "utf-8"
  );

  // Register this test project in data/projects.json
  fs.writeFileSync(
    PROJECTS_JSON_PATH,
    JSON.stringify([{ name: TEST_PROJECT_NAME, workspace: TEST_PROJECT_DIR, createdTime: "2026-05-28" }], null, 2),
    "utf-8"
  );

  // Launch browser
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
}, 30000);

afterAll(async () => {
  if (browser) await browser.close();
  // Clean up test project
  if (fs.existsSync(TEST_PROJECTS_DIR)) {
    fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });
  }
  // Restore original projects.json
  if (originalProjectsJson !== null) {
    fs.writeFileSync(PROJECTS_JSON_PATH, originalProjectsJson, "utf-8");
  } else if (fs.existsSync(PROJECTS_JSON_PATH)) {
    fs.unlinkSync(PROJECTS_JSON_PATH);
  }
});

describe("Feature #8: Project list + workspace switching + dynamics filtering", () => {
  /**
   * Step 1: GET /api/projects reads from data/projects.json (file-based registry, no scanning)
   */
  describe("Step 1: GET /api/projects", () => {
    it("returns project list from data/projects.json as JSON array", async () => {
      const res = await fetch(API("/api/projects"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    it("returns projects with name, workspace, createdTime fields", async () => {
      const res = await fetch(API("/api/projects"));
      const data = await res.json();
      expect(data.length).toBeGreaterThan(0);
      const first = data[0];
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("workspace");
      expect(first).toHaveProperty("createdTime");
    });

    it("does NOT include dynamics/ in the project list", async () => {
      const res = await fetch(API("/api/projects"));
      const data: Array<{ name: string; workspace: string }> = await res.json();
      for (const project of data) {
        expect(project.name).not.toBe("team3");
      }
    });
  });

  /**
   * Step 2: POST /api/project/init creates project and registers in data/projects.json
   */
  describe("Step 2: POST /api/project/init", () => {
    const INIT_PROJECT_NAME = "e2e-init-test";
    const initProjectDir = path.join(TEST_PROJECTS_DIR, INIT_PROJECT_NAME);

    afterAll(() => {
      if (fs.existsSync(initProjectDir)) {
        fs.rmSync(initProjectDir, { recursive: true, force: true });
      }
    });

    it("creates a new project with initWorkspace and registers in data/projects.json", async () => {
      const res = await fetch(API("/api/project/init"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: INIT_PROJECT_NAME, parentDir: TEST_PROJECTS_DIR }),
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspace).toBe(initProjectDir);
      expect(data.name).toBe(INIT_PROJECT_NAME);

      // Verify the project directory was created with spec/
      expect(fs.existsSync(path.join(initProjectDir, "spec"))).toBe(true);

      // Verify data/projects.json was updated with the new project
      const registry = JSON.parse(fs.readFileSync(PROJECTS_JSON_PATH, "utf-8"));
      const found = registry.find((p: { name: string }) => p.name === INIT_PROJECT_NAME);
      expect(found).toBeDefined();
      expect(found.workspace).toBe(initProjectDir);
      expect(found.createdTime).toBeDefined();
    });

    it("rejects duplicate project name (409)", async () => {
      const res = await fetch(API("/api/project/init"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: INIT_PROJECT_NAME, parentDir: TEST_PROJECTS_DIR }),
      });
      expect(res.status).toBe(409);
    });

    it("rejects invalid project name (400)", async () => {
      const res = await fetch(API("/api/project/init"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "bad name!", parentDir: TEST_PROJECTS_DIR }),
      });
      expect(res.status).toBe(400);
    });

    it("newly created project appears in GET /api/projects", async () => {
      const res = await fetch(API("/api/projects"));
      const data: Array<{ name: string }> = await res.json();
      const names = data.map((p) => p.name);
      expect(names).toContain(INIT_PROJECT_NAME);
    });
  });

  /**
   * Step 3: / homepage shows project cards or create guidance
   */
  describe("Step 3: Homepage project list", () => {
    it("renders the projects page with title", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='projects-page']", { timeout: 10000 });
      const title = await page.$eval(".projects-title", (el) => el.textContent);
      expect(title).toContain("Team3 Projects");
    });

    it("shows create project button", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='projects-page']", { timeout: 10000 });
      const hasCreateBtn = await page.$("[data-testid='create-project-btn']");
      const hasEmptyCreate = await page.$("[data-testid='empty-create-btn']");
      expect(hasCreateBtn || hasEmptyCreate).toBeTruthy();
    });
  });

  /**
   * Step 4: Workspace page shows Page 1 layout with workspace param
   */
  describe("Step 4: Workspace page", () => {
    it("shows chat and doc panels when workspace is provided", async () => {
      const wsUrl = `${BASE_URL}/workspace?path=${encodeURIComponent(TEST_PROJECT_DIR)}`;
      await page.goto(wsUrl, { waitUntil: "networkidle2" });

      await page.waitForSelector(".page-layout", { timeout: 10000 });

      const chatPanel = await page.$("[data-testid='chat-panel']");
      expect(chatPanel).toBeTruthy();

      const docPanel = await page.$("[data-testid='doc-panel']");
      expect(docPanel).toBeTruthy();
    });

    it("loads chat history from the specified workspace", async () => {
      const wsUrl = `${BASE_URL}/workspace?path=${encodeURIComponent(TEST_PROJECT_DIR)}`;
      await page.goto(wsUrl, { waitUntil: "networkidle2" });

      await page.waitForSelector("[data-testid='chat-panel']", { timeout: 10000 });
      await page.waitForFunction(
        () => {
          const msgs = document.querySelector("[data-testid='chat-messages']");
          return msgs && msgs.children.length > 1;
        },
        { timeout: 10000 }
      );

      const msgText = await page.$eval("[data-testid='chat-messages']", (el) => el.textContent);
      expect(msgText).toContain("hello from e2e");
    });

    it("shows no-project message when workspace param is missing", async () => {
      await page.goto(`${BASE_URL}/workspace`, { waitUntil: "networkidle2" });
      await page.waitForSelector(".workspace-no-project", { timeout: 10000 });
      const text = await page.$eval(".workspace-no-project", (el) => el.textContent);
      expect(text).toContain("No project selected");
    });
  });

  /**
   * Step 5: All existing APIs require workspace query param (mandatory, no fallback)
   */
  describe("Step 5: API workspace param mandatory", () => {
    // Tests: without workspace → 400
    it("GET /api/files/list without workspace returns 400", async () => {
      const res = await fetch(API("/api/files/list?path=spec"));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("workspace");
    });

    it("GET /api/files/content without workspace returns 400", async () => {
      const res = await fetch(API("/api/files/content?path=spec/app_design.md"));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("workspace");
    });

    it("GET /api/chat/history without workspace returns 400", async () => {
      const res = await fetch(API("/api/chat/history"));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("workspace");
    });

    it("GET /api/modules without workspace returns 400", async () => {
      const res = await fetch(API("/api/modules"));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("workspace");
    });

    it("GET /api/timeline without workspace returns 400", async () => {
      const res = await fetch(API("/api/timeline?mid=module_1"));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("workspace");
    });

    // Tests: with workspace → 200, correct data
    it("GET /api/files/list with workspace returns file listing", async () => {
      const res = await fetch(
        API(`/api/files/list?path=spec&workspace=${encodeURIComponent(TEST_PROJECT_DIR)}`)
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      const names = data.map((e: { name: string }) => e.name);
      expect(names).toContain("app_design.md");
    });

    it("GET /api/files/content with workspace returns file content", async () => {
      const res = await fetch(
        API(`/api/files/content?path=spec/app_design.md&workspace=${encodeURIComponent(TEST_PROJECT_DIR)}`)
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).toContain("E2E Test App Design");
      expect(data.mtime).toBeGreaterThan(0);
    });

    it("GET /api/chat/history with workspace returns messages", async () => {
      const res = await fetch(
        API(`/api/chat/history?workspace=${encodeURIComponent(TEST_PROJECT_DIR)}`)
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].message).toBe("hello from e2e");
    });

    it("POST /api/chat/send with workspace writes to correct project", async () => {
      const res = await fetch(
        API(`/api/chat/send?workspace=${encodeURIComponent(TEST_PROJECT_DIR)}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "to_arch", to: "arch", message: "e2e workspace test" }),
        }
      );
      expect(res.status).toBe(200);

      // Verify it was written to the test project's actions.jsonl
      const content = fs.readFileSync(
        path.join(TEST_PROJECT_DIR, "spec", "actions.jsonl"),
        "utf-8"
      );
      expect(content).toContain("e2e workspace test");
    });

    it("GET /api/modules with workspace returns module data", async () => {
      const res = await fetch(
        API(`/api/modules?workspace=${encodeURIComponent(TEST_PROJECT_DIR)}`)
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.modules).toBeDefined();
      expect(data.modules[0].name).toBe("Test Module");
    });

    it("GET /api/modules?mid with workspace returns feature list", async () => {
      const res = await fetch(
        API(`/api/modules?mid=module_1&workspace=${encodeURIComponent(TEST_PROJECT_DIR)}`)
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].description).toBe("Test Feature");
    });

    it("GET /api/timeline with workspace returns progress text", async () => {
      const res = await fetch(
        API(`/api/timeline?mid=module_1&workspace=${encodeURIComponent(TEST_PROJECT_DIR)}`)
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("feature_id: 1");
    });

    it("PUT /api/files/update with workspace writes to correct project", async () => {
      const testContent = "# Updated by e2e\n\nTest content updated.\n";
      const res = await fetch(
        API(`/api/files/update?workspace=${encodeURIComponent(TEST_PROJECT_DIR)}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "spec/app_design.md", content: testContent }),
        }
      );
      expect(res.status).toBe(200);

      // Verify file was written to the test project
      const actual = fs.readFileSync(
        path.join(TEST_PROJECT_DIR, "spec", "app_design.md"),
        "utf-8"
      );
      expect(actual).toBe(testContent);
    });
  });
});
