/**
 * E2E Integration Test for Module 1, Feature #3: Page 1 文档展示区（文件树 + preview/edit + mtime 重载）
 *
 * Checkpoint verification (from spec/module_1_feature_list.json):
 *   Step 1: 页面右侧渲染 spec/ 文件树，点击文件名加载内容
 *   Step 2: 默认展示 spec/app_design.md 的 markdown preview（渲染为 HTML）
 *   Step 3: 切换 edit 模式，显示 textarea 可编辑；点保存后调用 PUT /api/files/update，本地文件更新
 *   Step 4: 保存后自动切回 preview 展示最新内容
 *   Step 5: 视图获焦时对比 mtime，若文件被外部修改则自动重载内容
 *
 * Uses Puppeteer to run real browser automation against the Next.js dev server.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import puppeteer, { Browser, Page } from "puppeteer";

const WEB_DIR = path.resolve(__dirname, "../../");
const PORT = 3090;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = path.resolve(WEB_DIR, "..");

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;

async function waitForServer(url: string, timeoutMs = 40000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not ready
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe("Module 1 Feature #3: Page 1 文档展示区", () => {
  beforeAll(async () => {
    // Start Next.js dev server
    serverProcess = spawn("npx", ["next", "dev", "--port", String(PORT)], {
      cwd: WEB_DIR,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    await waitForServer(`${BASE_URL}/health`);

    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    page = await browser.newPage();
  }, 60000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      setTimeout(() => {
        if (!serverProcess.killed) serverProcess.kill("SIGKILL");
      }, 3000);
    }
  });

  describe("Step 1: 页面右侧渲染 spec/ 文件树，点击文件名加载内容", () => {
    it("renders file tree with spec/ entries", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });

      // Wait for file tree to load
      await page.waitForSelector("[data-testid='file-tree']", { timeout: 10000 });

      // Check that file tree items exist
      const items = await page.$$("[class*='file-tree-item']");
      expect(items.length).toBeGreaterThan(0);

      // Check app_design.md is in the tree
      const text = await page.$eval("[data-testid='file-tree']", (el) => el.textContent);
      expect(text).toContain("app_design.md");
    });

    it("clicking a file loads its content", async () => {
      // Find and click on decision_log.md (if present)
      const items = await page.$$("[class*='file-tree-item']");
      let clicked = false;
      for (const item of items) {
        const name = await item.evaluate((el) => el.textContent);
        if (name?.includes("decision_log.md")) {
          await item.click();
          clicked = true;
          break;
        }
      }

      if (clicked) {
        // Wait for content to update
        await page.waitForFunction(
          () => {
            const pathEl = document.querySelector("[data-testid='doc-viewer-path']");
            return pathEl && pathEl.textContent?.includes("decision_log");
          },
          { timeout: 5000 }
        );

        const pathText = await page.$eval(
          "[data-testid='doc-viewer-path']",
          (el) => el.textContent
        );
        expect(pathText).toContain("decision_log");
      }
    });
  });

  describe("Step 2: 默认展示 spec/app_design.md 的 markdown preview", () => {
    it("shows app_design.md content rendered as HTML by default", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });

      // Wait for preview to load
      await page.waitForSelector("[data-testid='doc-preview']", { timeout: 10000 });

      // Check that the path shows app_design.md
      const pathText = await page.$eval(
        "[data-testid='doc-viewer-path']",
        (el) => el.textContent
      );
      expect(pathText).toBe("spec/app_design.md");

      // Check that content is rendered as HTML (not raw markdown)
      const previewHtml = await page.$eval(
        "[data-testid='doc-preview']",
        (el) => el.innerHTML
      );
      // Should contain HTML elements (h1, p, etc.), not raw # markers
      expect(previewHtml).toContain("<h1");
      expect(previewHtml).toContain("</h1>");
    });
  });

  describe("Step 3: 切换 edit 模式，保存后本地文件更新", () => {
    const TEST_FILE = "spec/_e2e_test_edit.tmp.md";
    const INITIAL_CONTENT = "# Test File\n\nOriginal content for e2e test.";

    beforeAll(() => {
      // Create a test file
      fs.writeFileSync(path.join(PROJECT_ROOT, TEST_FILE), INITIAL_CONTENT, "utf-8");
    });

    afterAll(() => {
      // Clean up
      const p = path.join(PROJECT_ROOT, TEST_FILE);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });

    it("edit mode shows textarea, save writes to disk", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='file-tree']", { timeout: 10000 });

      // Click on the test file in the tree
      // First find it - it should be listed as _e2e_test_edit.tmp.md
      await page.waitForFunction(
        () => {
          const items = document.querySelectorAll("[class*='file-tree-item']");
          for (const item of items) {
            if (item.textContent?.includes("_e2e_test_edit.tmp.md")) return true;
          }
          return false;
        },
        { timeout: 5000 }
      );

      // Click it
      const items = await page.$$("[class*='file-tree-item']");
      for (const item of items) {
        const name = await item.evaluate((el) => el.textContent);
        if (name?.includes("_e2e_test_edit.tmp.md")) {
          await item.click();
          break;
        }
      }

      // Wait for file to load
      await page.waitForFunction(
        () => {
          const pathEl = document.querySelector("[data-testid='doc-viewer-path']");
          return pathEl?.textContent?.includes("_e2e_test_edit.tmp.md");
        },
        { timeout: 5000 }
      );

      // Click Edit button
      await page.waitForSelector("[data-testid='btn-edit']", { timeout: 5000 });
      await page.click("[data-testid='btn-edit']");

      // Wait for editor (textarea) to appear
      await page.waitForSelector("[data-testid='doc-editor']", { timeout: 5000 });

      // Verify textarea contains original content
      const textareaValue = await page.$eval(
        "[data-testid='doc-editor']",
        (el) => (el as HTMLTextAreaElement).value
      );
      expect(textareaValue).toBe(INITIAL_CONTENT);

      // Clear and type new content using Puppeteer's keyboard methods
      const UPDATED_CONTENT = "# Updated\n\nEdited via browser e2e test.";

      // Use evaluate to clear the textarea value via React-compatible approach
      await page.$eval("[data-testid='doc-editor']", (el) => {
        const textarea = el as HTMLTextAreaElement;
        // Use native setter + React synthetic event dispatch
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, "value"
        )!.set!;
        nativeSetter.call(textarea, "");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });

      // Now type the new content
      const textarea = await page.$("[data-testid='doc-editor']");
      await textarea!.type(UPDATED_CONTENT, { delay: 0 });

      // Click Save
      await page.click("[data-testid='btn-save']");

      // Wait for save to complete (switches back to preview)
      await page.waitForSelector("[data-testid='doc-preview']", { timeout: 10000 });

      // Verify the file on disk was updated
      const diskContent = fs.readFileSync(path.join(PROJECT_ROOT, TEST_FILE), "utf-8");
      expect(diskContent).toBe(UPDATED_CONTENT);
    });
  });

  describe("Step 4: 保存后自动切回 preview 展示最新内容", () => {
    it("after save, preview mode shows updated content", async () => {
      // After the previous test's save, we should be in preview mode
      // showing the updated content
      const preview = await page.waitForSelector("[data-testid='doc-preview']", { timeout: 5000 });
      expect(preview).not.toBeNull();

      // The preview should contain our updated content rendered as HTML
      const previewText = await page.$eval(
        "[data-testid='doc-preview']",
        (el) => el.textContent
      );
      expect(previewText).toContain("Updated");
      expect(previewText).toContain("Edited via browser e2e test");
    });
  });

  describe("Step 5: 视图获焦时对比 mtime，若文件被外部修改则自动重载内容", () => {
    it("reloads content when file is modified externally", async () => {
      // Navigate fresh to load app_design.md
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='doc-preview']", { timeout: 10000 });

      // Read current content on screen
      const originalText = await page.$eval(
        "[data-testid='doc-preview']",
        (el) => el.textContent
      );

      // Modify the file externally (append a marker line)
      const filePath = path.join(PROJECT_ROOT, "spec/app_design.md");
      const originalContent = fs.readFileSync(filePath, "utf-8");
      const marker = "\n\n<!-- e2e-mtime-test-marker -->";
      fs.writeFileSync(filePath, originalContent + marker, "utf-8");

      // Simulate window focus event (triggers mtime check)
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
      });

      // Wait a bit for the reload to happen
      await new Promise((r) => setTimeout(r, 1500));

      // Check that the GET /api/files/content was called (mtime check)
      // The content should now include the marker (or at least the mtime comparison triggered a reload)
      // Since the marker is an HTML comment, it won't show in rendered text
      // but we can verify via API that the component fetched the new content
      // Let's check the raw content by switching to edit mode
      await page.click("[data-testid='btn-edit']");
      await page.waitForSelector("[data-testid='doc-editor']", { timeout: 5000 });

      const editorValue = await page.$eval(
        "[data-testid='doc-editor']",
        (el) => (el as HTMLTextAreaElement).value
      );
      expect(editorValue).toContain("e2e-mtime-test-marker");

      // Restore original content
      fs.writeFileSync(filePath, originalContent, "utf-8");
    });
  });
});
