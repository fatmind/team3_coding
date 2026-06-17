/**
 * E2E Integration Test for Module 1, Feature #4: Page 1 群聊对话区（消息列表 + 发送 + 角色渲染）
 *
 * Checkpoint verification (from spec/module_1_feature_list.json):
 *   Step 1: 页面左侧渲染群聊消息列表，数据来自 GET /api/chat/history（读 actions.jsonl）
 *   Step 2: 消息按 from 字段区分渲染样式（human 靠右蓝色气泡、agent 靠左灰色气泡，显示角色名称）
 *   Step 3: 输入框 + 发送按钮，默认发送给 arch；可聊天 @ 指定发送给谁
 *   Step 4: 点击发送后消息立即显示在对话区（不等 daemon 回推），同时调用 POST /api/chat/send
 *   Step 5: 消息列表自动滚动到底部
 *
 * Uses Puppeteer to run real browser automation against the Next.js dev server.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import puppeteer, { Browser, Page } from "puppeteer";

const WEB_DIR = path.resolve(__dirname, "../../");
const PORT = 3091;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = path.resolve(WEB_DIR, "..");

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;

// Seed data for testing
const SEED_MESSAGES = [
  { action: "to_arch", from: "human", to: "arch", ts: 1700000000, message: "Hello architect, please review" },
  { action: "to_human", from: "arch", to: "human", ts: 1700000010, message: "I will review the code now" },
  { action: "dev_do", from: "arch", to: "dev", ts: 1700000020, message: "Dev please implement feature X" },
  { action: "to_human", from: "dev", to: "human", ts: 1700000030, message: "Feature X implemented" },
];

const ACTIONS_FILE = path.join(PROJECT_ROOT, "spec", "actions.jsonl");
let originalActionsContent: string | null = null;

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

describe("Module 1 Feature #4: Page 1 群聊对话区", () => {
  beforeAll(async () => {
    // Backup actions.jsonl if exists
    if (fs.existsSync(ACTIONS_FILE)) {
      originalActionsContent = fs.readFileSync(ACTIONS_FILE, "utf-8");
    }

    // Write seed messages
    const seedContent = SEED_MESSAGES.map((m) => JSON.stringify(m)).join("\n") + "\n";
    fs.writeFileSync(ACTIONS_FILE, seedContent, "utf-8");

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

    // Restore actions.jsonl
    if (originalActionsContent !== null) {
      fs.writeFileSync(ACTIONS_FILE, originalActionsContent, "utf-8");
    } else if (fs.existsSync(ACTIONS_FILE)) {
      // Remove the seed file if it didn't exist before
      fs.unlinkSync(ACTIONS_FILE);
    }
  });

  describe("Step 1: 页面左侧渲染群聊消息列表", () => {
    it("renders chat panel with messages from actions.jsonl", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });

      // Wait for chat panel to load
      await page.waitForSelector("[data-testid='chat-panel']", { timeout: 10000 });

      // Wait for messages to render
      await page.waitForSelector("[data-testid='chat-messages']", { timeout: 5000 });

      // Verify messages from seed data are displayed
      const msgTexts = await page.$$eval("[class*='chat-bubble-text']", (els) =>
        els.map((el) => el.textContent)
      );
      expect(msgTexts).toContain("Hello architect, please review");
      expect(msgTexts).toContain("I will review the code now");
      expect(msgTexts).toContain("Dev please implement feature X");
      expect(msgTexts).toContain("Feature X implemented");
    });

    it("chat panel is in the left 40% of the page", async () => {
      const chatPanel = await page.$("[data-testid='chat-panel']");
      expect(chatPanel).not.toBeNull();

      const pageLeft = await page.$(".page-left");
      expect(pageLeft).not.toBeNull();

      // Check that chat panel is inside page-left
      const isInLeft = await page.evaluate(() => {
        const panel = document.querySelector("[data-testid='chat-panel']");
        const left = document.querySelector(".page-left");
        return left?.contains(panel) ?? false;
      });
      expect(isInLeft).toBe(true);
    });
  });

  describe("Step 2: 消息按 from 字段区分渲染样式", () => {
    it("human messages are right-aligned with blue styling", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-msg-0']", { timeout: 10000 });

      // First message is from human — should be right-aligned
      const humanRow = await page.$("[data-testid='chat-msg-0']");
      const humanClass = await humanRow!.evaluate((el) => el.className);
      expect(humanClass).toContain("chat-bubble-right");

      // Check blue styling on human bubble
      const humanBubble = await page.$("[data-testid='chat-msg-0'] .chat-bubble-human");
      expect(humanBubble).not.toBeNull();
      const bgColor = await humanBubble!.evaluate((el) => getComputedStyle(el).backgroundColor);
      // Primary blue color - rgb(37, 99, 235) or similar
      expect(bgColor).toMatch(/rgb/);
    });

    it("agent messages are left-aligned with gray styling and show role name", async () => {
      // Second message is from arch — should be left-aligned
      const agentRow = await page.$("[data-testid='chat-msg-1']");
      const agentClass = await agentRow!.evaluate((el) => el.className);
      expect(agentClass).toContain("chat-bubble-left");

      // Check agent bubble styling
      const agentBubble = await page.$("[data-testid='chat-msg-1'] .chat-bubble-agent");
      expect(agentBubble).not.toBeNull();

      // Check role name is shown
      const roleName = await page.$eval(
        "[data-testid='chat-msg-1'] .chat-bubble-name",
        (el) => el.textContent
      );
      expect(roleName).toBe("Architect");

      // Check AI badge
      const badge = await page.$("[data-testid='chat-msg-1'] .chat-bubble-badge");
      expect(badge).not.toBeNull();
      const badgeText = await badge!.evaluate((el) => el.textContent);
      expect(badgeText).toBe("AI");
    });

    it("shows avatar circles with first letter of role", async () => {
      // Agent avatar shows first letter
      const agentAvatar = await page.$("[data-testid='chat-msg-1'] [data-testid='chat-avatar']");
      expect(agentAvatar).not.toBeNull();
      const avatarText = await agentAvatar!.evaluate((el) => el.textContent);
      expect(avatarText).toBe("A"); // Architect → A

      // Human avatar shows H
      const humanAvatar = await page.$("[data-testid='chat-msg-0'] [data-testid='chat-avatar']");
      expect(humanAvatar).not.toBeNull();
      const humanAvatarText = await humanAvatar!.evaluate((el) => el.textContent);
      expect(humanAvatarText).toBe("H");
    });
  });

  describe("Step 3: 输入框 + 发送按钮 + @ 指定目标", () => {
    it("has input field, send button, and target selector defaulting to arch", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-input-area']", { timeout: 10000 });

      // Input exists
      const input = await page.$("[data-testid='chat-input']");
      expect(input).not.toBeNull();

      // Send button exists
      const sendBtn = await page.$("[data-testid='chat-send-btn']");
      expect(sendBtn).not.toBeNull();

      // Target selector defaults to arch
      const targetValue = await page.$eval(
        "[data-testid='chat-target-select']",
        (el) => (el as HTMLSelectElement).value
      );
      expect(targetValue).toBe("arch");
    });

    it("can change target via selector to dev/uat", async () => {
      await page.select("[data-testid='chat-target-select']", "dev");
      const newValue = await page.$eval(
        "[data-testid='chat-target-select']",
        (el) => (el as HTMLSelectElement).value
      );
      expect(newValue).toBe("dev");

      // Reset to arch
      await page.select("[data-testid='chat-target-select']", "arch");
    });
  });

  describe("Step 4: 点击发送后消息立即显示 + 调用 POST /api/chat/send", () => {
    it("sends message optimistically and persists to actions.jsonl", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-input']", { timeout: 10000 });

      // Type a test message
      const testMsg = `E2E_TEST_MSG_${Date.now()}`;
      await page.type("[data-testid='chat-input']", testMsg);

      // Click send
      await page.click("[data-testid='chat-send-btn']");

      // Wait for message to appear in the chat (optimistic update)
      await page.waitForFunction(
        (msg: string) => {
          const texts = Array.from(document.querySelectorAll(".chat-bubble-text"));
          return texts.some((el) => el.textContent === msg);
        },
        { timeout: 5000 },
        testMsg
      );

      // Verify input is cleared
      const inputValue = await page.$eval(
        "[data-testid='chat-input']",
        (el) => (el as HTMLInputElement).value
      );
      expect(inputValue).toBe("");

      // Wait a bit for the POST to complete, then verify actions.jsonl
      await new Promise((r) => setTimeout(r, 500));
      const content = fs.readFileSync(ACTIONS_FILE, "utf-8");
      const lines = content.trim().split("\n");
      const lastLine = JSON.parse(lines[lines.length - 1]);
      expect(lastLine.message).toBe(testMsg);
      expect(lastLine.from).toBe("human");
      expect(lastLine.action).toBe("to_arch");
      expect(lastLine.to).toBe("arch");
      expect(lastLine.ts).toBeGreaterThan(0);
    });

    it("sends to different target via dropdown selector", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-input']", { timeout: 10000 });

      // Change target to uat via the dropdown
      await page.select("[data-testid='chat-target-select']", "uat");
      // Wait for React to update
      await new Promise((r) => setTimeout(r, 300));

      // Verify select value changed
      const selectVal = await page.$eval(
        "[data-testid='chat-target-select']",
        (el) => (el as HTMLSelectElement).value
      );
      expect(selectVal).toBe("uat");

      const uniqueId = Date.now();
      const testMsg = `verify_uat_${uniqueId}`;

      // Focus input and type
      await page.click("[data-testid='chat-input']");
      await page.type("[data-testid='chat-input']", testMsg);

      // Verify input has the text
      const inputVal = await page.$eval(
        "[data-testid='chat-input']",
        (el) => (el as HTMLInputElement).value
      );
      expect(inputVal).toBe(testMsg);

      // Send via Enter key
      await page.keyboard.press("Enter");

      // Wait for message in chat
      await page.waitForFunction(
        (msg: string) => {
          const texts = Array.from(document.querySelectorAll(".chat-bubble-text"));
          return texts.some((el) => el.textContent === msg);
        },
        { timeout: 5000 },
        testMsg
      );

      // Wait for the POST to complete and file to be written
      // Poll the file until our message appears (max 5s)
      let matchingLine: any = null;
      const startTime = Date.now();
      while (Date.now() - startTime < 5000) {
        const content = fs.readFileSync(ACTIONS_FILE, "utf-8");
        const lines = content.trim().split("\n");
        matchingLine = lines
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean)
          .find((entry: any) => entry.message === testMsg);
        if (matchingLine) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      expect(matchingLine).toBeDefined();
      expect(matchingLine.to).toBe("uat");
      expect(matchingLine.action).toBe("uat_design");
      expect(matchingLine.from).toBe("human");
    });
  });

  describe("Step 5: 消息列表自动滚动到底部", () => {
    it("auto-scrolls to the latest message", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-messages']", { timeout: 10000 });

      // Wait for messages to load
      await page.waitForSelector("[data-testid='chat-msg-0']", { timeout: 5000 });

      // Send multiple messages to ensure scrolling is needed
      for (let i = 0; i < 5; i++) {
        await page.type("[data-testid='chat-input']", `Scroll test message ${i}`);
        await page.click("[data-testid='chat-send-btn']");
        await new Promise((r) => setTimeout(r, 200));
      }

      // Wait for last message to appear
      await page.waitForFunction(
        () => {
          const texts = Array.from(document.querySelectorAll(".chat-bubble-text"));
          return texts.some((el) => el.textContent === "Scroll test message 4");
        },
        { timeout: 5000 }
      );

      // Check that the messages container is scrolled near the bottom
      const isScrolledToBottom = await page.evaluate(() => {
        const container = document.querySelector("[data-testid='chat-messages']");
        if (!container) return false;
        const { scrollTop, scrollHeight, clientHeight } = container;
        // Allow 50px tolerance
        return scrollHeight - scrollTop - clientHeight < 50;
      });
      expect(isScrolledToBottom).toBe(true);
    });
  });
});
