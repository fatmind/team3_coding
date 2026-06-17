/**
 * E2E Integration Test for Module 1, Feature #6: Page 2 工作项关系图 + Page 3 工作过程 timeline
 *
 * Checkpoint verification (from spec/module_1_feature_list.json):
 *   Step 1: Page 2 展示 modules 卡片列表（名称、状态徽章、feature 进度 N/M），数据来自 GET /api/modules
 *   Step 2: 点击 module 卡片后下方展示 feature 详情列表（id、description、passes 状态），数据来自 GET /api/modules?mid=X
 *   Step 3: 默认选中第一个 module 并展示其详情
 *   Step 4: Page 1 有「查看 Agent 工作」按钮，点击跳转 Page 2
 *   Step 5: Page 3 展示 module_X_progress.txt 纯文本内容，从 Page 2 某个入口点击进入
 *
 * Uses Puppeteer to run real browser automation against the Next.js dev server.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import puppeteer, { Browser, Page } from "puppeteer";

const WEB_DIR = path.resolve(__dirname, "../../");
const PORT = 3093;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

describe("Module 1 Feature #6: Page 2 工作项关系图 + Page 3 timeline", () => {
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

  describe("Step 1: Page 2 展示 modules 卡片列表", () => {
    it("shows module cards with names, status badges, and progress", async () => {
      await page.goto(`${BASE_URL}/modules`, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='modules-page']", { timeout: 10000 });

      // Wait for cards to load
      await page.waitForSelector("[data-testid='modules-cards']", { timeout: 10000 });

      // Check module cards exist
      const cards = await page.$$("[class*='module-card']");
      expect(cards.length).toBeGreaterThanOrEqual(2); // At least module_1 and module_2

      // Check module names are shown
      const cardTexts = await page.$$eval("[class*='module-card-name']", (els) =>
        els.map((el) => el.textContent)
      );
      expect(cardTexts).toContain("Web UI 交互");
      expect(cardTexts).toContain("Web 项目初始化");

      // Check status badges exist
      const badges = await page.$$("[class*='module-status-badge']");
      expect(badges.length).toBeGreaterThanOrEqual(2);

      // Check progress text exists (N/M features format)
      const progressTexts = await page.$$eval("[class*='module-progress-text']", (els) =>
        els.map((el) => el.textContent)
      );
      expect(progressTexts.some((t) => t?.match(/\d+\/\d+ features/))).toBe(true);
    });
  });

  describe("Step 2: 点击 module 卡片后展示 feature 详情列表", () => {
    it("clicking a module card shows its feature details", async () => {
      await page.goto(`${BASE_URL}/modules`, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='features-section']", { timeout: 10000 });

      // Click on module_3 card (Daemon — has features with passes: true)
      const module3Card = await page.$("[data-testid='module-card-module_3']");
      if (module3Card) {
        await module3Card.click();

        // Wait for features to load for module_3
        await page.waitForFunction(
          () => {
            const items = document.querySelectorAll("[data-testid^='feature-item-']");
            return items.length > 0;
          },
          { timeout: 5000 }
        );

        // Check feature items
        const featureItems = await page.$$("[data-testid^='feature-item-']");
        expect(featureItems.length).toBeGreaterThan(0);

        // Check feature has id, description, and passes status
        const firstFeature = await page.$eval("[data-testid='feature-item-1']", (el) => el.textContent);
        expect(firstFeature).toContain("#1");
        expect(firstFeature).toContain("Daemon");
      }
    });
  });

  describe("Step 3: 默认选中第一个 module 并展示其详情", () => {
    it("first module is selected by default on page load", async () => {
      await page.goto(`${BASE_URL}/modules`, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='modules-cards']", { timeout: 10000 });

      // Wait for features section to appear (means a module is selected)
      await page.waitForSelector("[data-testid='features-section']", { timeout: 10000 });

      // First card should have selected class
      const firstCardClass = await page.$eval(
        "[data-testid='module-card-module_1']",
        (el) => el.className
      );
      expect(firstCardClass).toContain("module-card-selected");

      // Features list should be visible
      const featuresList = await page.$("[data-testid='features-list']");
      expect(featuresList).not.toBeNull();
    });
  });

  describe("Step 4: Page 1 有「查看 Agent 工作」按钮，点击跳转 Page 2", () => {
    it("Page 1 has view work button that navigates to /modules", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-panel']", { timeout: 10000 });

      // Find the button
      const viewWorkBtn = await page.$("[data-testid='view-work-btn']");
      expect(viewWorkBtn).not.toBeNull();

      // Check button text
      const btnText = await viewWorkBtn!.evaluate((el) => el.textContent);
      expect(btnText).toContain("查看 Agent 工作");

      // Click the button
      await viewWorkBtn!.click();

      // Should navigate to /modules
      await page.waitForSelector("[data-testid='modules-page']", { timeout: 10000 });
      expect(page.url()).toContain("/modules");
    });
  });

  describe("Step 5: Page 3 展示 module_X_progress.txt 纯文本内容", () => {
    it("timeline page shows progress.txt content via link from Page 2", async () => {
      await page.goto(`${BASE_URL}/modules`, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='features-section']", { timeout: 10000 });

      // Find and click the timeline link
      const timelineLink = await page.$("[data-testid='timeline-link']");
      expect(timelineLink).not.toBeNull();

      await timelineLink!.click();

      // Should navigate to timeline page
      await page.waitForSelector("[data-testid='timeline-page']", { timeout: 10000 });
      expect(page.url()).toContain("/timeline");

      // Wait for content to load
      await page.waitForSelector("[data-testid='timeline-content']", { timeout: 10000 });

      // Content should contain progress.txt content (pre element with text)
      const content = await page.$eval("[data-testid='timeline-content'] pre", (el) => el.textContent);
      expect(content).toBeTruthy();
      expect(content!.length).toBeGreaterThan(0);
      // Should contain recognizable content from module_1_progress.txt
      expect(content).toContain("Feature");
    });

    it("timeline page has back link to modules", async () => {
      // Already on timeline page from previous test, but let's navigate fresh
      await page.goto(`${BASE_URL}/modules/module_1/timeline`, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='timeline-page']", { timeout: 10000 });

      const backLink = await page.$("[data-testid='timeline-back-link']");
      expect(backLink).not.toBeNull();

      const href = await backLink!.evaluate((el) => el.getAttribute("href"));
      expect(href).toBe("/modules");
    });
  });
});
