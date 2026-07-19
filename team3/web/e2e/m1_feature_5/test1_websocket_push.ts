/**
 * E2E Integration Test for Module 1, Feature #5: 群聊实时推送（WebSocket 连接 daemon + 增量更新）
 *
 * Checkpoint verification (from spec/module_1_feature_list.json):
 *   Step 1: 页面加载时自动连接 daemon WebSocket（ws://127.0.0.1:3100）
 *   Step 2: 收到 daemon 推送的 agent.msg 事件后，解析 payload 并增量追加到对话区
 *   Step 3: WebSocket 断开后自动重连（指数退避），重连后拉取最新消息补齐
 *   Step 4: 人类发送的消息由 web 自己显示，不依赖 daemon 回推（避免重复）
 *   Step 5: daemon 连接状态指示器：在线显示绿点、断开显示红点
 *
 * Uses a mock WebSocket server (simulating daemon) + Puppeteer for real browser testing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { launchBrowser, type Browser, type Page } from "../_browser";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";

const WEB_DIR = path.resolve(__dirname, "../../");
const PORT = 3092;
const DAEMON_PORT = 3100; // Must match the default in useDaemonSocket
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = path.resolve(WEB_DIR, "..");

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;
let mockDaemon: WebSocketServer;
let daemonClients: Set<WsWebSocket>;

const ACTIONS_FILE = path.join(PROJECT_ROOT, "spec", "actions.jsonl");
let originalActionsContent: string | null = null;

// Seed data
const SEED_MESSAGES = [
  { action: "to_arch", from: "human", to: "arch", ts: 1700000000, message: "Initial message" },
];

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

function startMockDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    daemonClients = new Set();
    mockDaemon = new WebSocketServer({ port: DAEMON_PORT }, () => {
      resolve();
    });
    mockDaemon.on("error", reject);
    mockDaemon.on("connection", (ws) => {
      daemonClients.add(ws);
      // Send connected event like real daemon
      ws.send(JSON.stringify({
        type: "connected",
        clientId: `test_client_${Date.now()}`,
        daemonPid: process.pid,
        timestamp: new Date().toISOString(),
      }));
      ws.on("close", () => {
        daemonClients.delete(ws);
      });
    });
  });
}

function stopMockDaemon(): Promise<void> {
  return new Promise((resolve) => {
    if (mockDaemon) {
      for (const client of daemonClients) {
        client.terminate();
      }
      daemonClients.clear();
      mockDaemon.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function broadcastAgentMessage(msg: object) {
  const event = JSON.stringify({
    type: "agent.msg",
    payload: JSON.stringify(msg),
  });
  for (const client of daemonClients) {
    if (client.readyState === WsWebSocket.OPEN) {
      client.send(event);
    }
  }
}

describe("Module 1 Feature #5: 群聊实时推送", () => {
  beforeAll(async () => {
    // Backup actions.jsonl
    if (fs.existsSync(ACTIONS_FILE)) {
      originalActionsContent = fs.readFileSync(ACTIONS_FILE, "utf-8");
    }
    // Write seed
    fs.writeFileSync(ACTIONS_FILE, SEED_MESSAGES.map((m) => JSON.stringify(m)).join("\n") + "\n");

    // Start mock daemon first (so web can connect on page load)
    await startMockDaemon();

    // Start Next.js dev server
    serverProcess = spawn("npx", ["next", "dev", "--port", String(PORT)], {
      cwd: WEB_DIR,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    await waitForServer(`${BASE_URL}/health`);

    // Launch browser
    browser = await launchBrowser();
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
    await stopMockDaemon();

    // Restore actions.jsonl
    if (originalActionsContent !== null) {
      fs.writeFileSync(ACTIONS_FILE, originalActionsContent, "utf-8");
    } else if (fs.existsSync(ACTIONS_FILE)) {
      fs.unlinkSync(ACTIONS_FILE);
    }
  });

  describe("Step 1: 页面加载时自动连接 daemon WebSocket", () => {
    it("connects to daemon WebSocket on page load", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-panel']", { timeout: 10000 });

      // Wait for WebSocket connection to be established
      // The mock daemon should have received a client connection
      await new Promise((r) => setTimeout(r, 2000));
      expect(daemonClients.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Step 2: 收到 agent.msg 推送后增量追加到对话区", () => {
    it("displays agent message pushed via WebSocket in real-time", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-messages']", { timeout: 10000 });

      // Wait for WS connection
      await new Promise((r) => setTimeout(r, 2000));

      // Broadcast an agent message from mock daemon
      const agentMsg = {
        action: "to_human",
        from: "arch",
        to: "human",
        ts: Math.floor(Date.now() / 1000),
        message: `WS_PUSH_TEST_${Date.now()}`,
      };
      broadcastAgentMessage(agentMsg);

      // Wait for message to appear in the chat
      await page.waitForFunction(
        (msg: string) => {
          const texts = Array.from(document.querySelectorAll(".chat-bubble-text"));
          return texts.some((el) => el.textContent === msg);
        },
        { timeout: 5000 },
        agentMsg.message
      );

      // Verify it's rendered as an agent message (left-aligned)
      const allBubbles = await page.$$eval(".chat-bubble-text", (els) =>
        els.map((el) => el.textContent)
      );
      expect(allBubbles).toContain(agentMsg.message);
    });

    it("does not duplicate messages already in history", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-messages']", { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 2000));

      // Push a message that's identical to one already in history
      broadcastAgentMessage(SEED_MESSAGES[0]);
      await new Promise((r) => setTimeout(r, 1000));

      // Count occurrences of the seed message
      const count = await page.$$eval(
        ".chat-bubble-text",
        (els, msg) => els.filter((el) => el.textContent === msg).length,
        SEED_MESSAGES[0].message
      );
      // Should be exactly 1 (from history, not duplicated by WS push)
      expect(count).toBe(1);
    });
  });

  describe("Step 3: WebSocket 断开后自动重连 + 拉取最新消息", () => {
    it("reconnects after daemon disconnect and refetches history", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-messages']", { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 2000));

      // Verify initially connected
      const initialClients = daemonClients.size;
      expect(initialClients).toBeGreaterThanOrEqual(1);

      // Stop mock daemon to simulate disconnect
      await stopMockDaemon();

      // Wait for status to change to disconnected
      await page.waitForFunction(
        () => {
          const dot = document.querySelector("[data-testid='chat-status-dot']");
          return dot?.classList.contains("chat-status-offline");
        },
        { timeout: 5000 }
      );

      // While disconnected, add a new message to actions.jsonl
      const newMsg = {
        action: "to_human",
        from: "dev",
        to: "human",
        ts: Math.floor(Date.now() / 1000),
        message: `RECONNECT_MSG_${Date.now()}`,
      };
      fs.appendFileSync(ACTIONS_FILE, JSON.stringify(newMsg) + "\n");

      // Restart mock daemon
      await startMockDaemon();

      // Wait for reconnection (backoff starts at 1s)
      await new Promise((r) => setTimeout(r, 3000));

      // After reconnect, the component should refetch history
      // The new message should appear (from refetch, not WS push)
      await page.waitForFunction(
        (msg: string) => {
          const texts = Array.from(document.querySelectorAll(".chat-bubble-text"));
          return texts.some((el) => el.textContent === msg);
        },
        { timeout: 10000 },
        newMsg.message
      );
    });
  });

  describe("Step 4: 人类发送的消息不依赖 daemon 回推", () => {
    it("human messages appear immediately without daemon push", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-input']", { timeout: 10000 });

      const testMsg = `HUMAN_LOCAL_${Date.now()}`;
      await page.type("[data-testid='chat-input']", testMsg);
      await page.click("[data-testid='chat-send-btn']");

      // Message should appear immediately (optimistic, from Feature #4)
      await page.waitForFunction(
        (msg: string) => {
          const texts = Array.from(document.querySelectorAll(".chat-bubble-text"));
          return texts.some((el) => el.textContent === msg);
        },
        { timeout: 3000 },
        testMsg
      );

      // The daemon should NOT have pushed this message
      // (human messages are from=human, MessageRouter skips those)
      // Verify by checking message count — should be exactly 1 occurrence
      const count = await page.$$eval(
        ".chat-bubble-text",
        (els, msg) => els.filter((el) => el.textContent === msg).length,
        testMsg
      );
      expect(count).toBe(1);
    });
  });

  describe("Step 5: daemon 连接状态指示器", () => {
    it("shows green dot when connected to daemon", async () => {
      // Ensure daemon is running
      if (!mockDaemon) {
        await startMockDaemon();
      }

      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-status-bar']", { timeout: 10000 });

      // Wait for connection
      await page.waitForFunction(
        () => {
          const dot = document.querySelector("[data-testid='chat-status-dot']");
          return dot?.classList.contains("chat-status-online");
        },
        { timeout: 5000 }
      );

      // Verify green styling
      const dotClass = await page.$eval(
        "[data-testid='chat-status-dot']",
        (el) => el.className
      );
      expect(dotClass).toContain("chat-status-online");

      // Verify status text
      const statusText = await page.$eval(
        "[data-testid='chat-status-text']",
        (el) => el.textContent
      );
      expect(statusText).toBe("Daemon connected");
    });

    it("shows red dot when disconnected from daemon", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector("[data-testid='chat-status-bar']", { timeout: 10000 });

      // Wait for connection first
      await page.waitForFunction(
        () => {
          const dot = document.querySelector("[data-testid='chat-status-dot']");
          return dot?.classList.contains("chat-status-online");
        },
        { timeout: 5000 }
      );

      // Stop daemon to trigger disconnect
      await stopMockDaemon();

      // Wait for red dot
      await page.waitForFunction(
        () => {
          const dot = document.querySelector("[data-testid='chat-status-dot']");
          return dot?.classList.contains("chat-status-offline");
        },
        { timeout: 5000 }
      );

      // Verify red styling
      const dotClass = await page.$eval(
        "[data-testid='chat-status-dot']",
        (el) => el.className
      );
      expect(dotClass).toContain("chat-status-offline");

      // Verify status text
      const statusText = await page.$eval(
        "[data-testid='chat-status-text']",
        (el) => el.textContent
      );
      expect(statusText).toBe("Daemon offline");

      // Restart daemon for cleanup
      await startMockDaemon();
    });
  });
});
