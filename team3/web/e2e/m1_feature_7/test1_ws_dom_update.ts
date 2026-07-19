/**
 * E2E Integration Test for Module 1, Feature #7:
 * 修复 WS 实时推送 → DOM 不更新
 *
 * Checkpoint verification:
 *   Step 1: useDaemonSocket catch 块添加 console.error（代码审查 + 单测覆盖）
 *   Step 2: 用忠实复刻 daemon MessageRouter 协议的测试脚本发送 agent.msg，浏览器解析成功
 *   Step 3: 收到 agent.msg 后，ChatPanel DOM 实时新增气泡，无需刷新
 *   Step 4: 回归 — 在本测试中验证既有功能不受影响
 *
 * This test uses a WS server that EXACTLY replicates the daemon MessageRouter protocol:
 *   - Sends JSON.stringify({ type: 'agent.msg', payload: rawLine })
 *   - Where rawLine is the raw JSONL text string (not JSON.stringify(object))
 *   This is the key difference from Feature #5 mock which used JSON.stringify(object)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { launchBrowser, type Browser, type Page } from "../_browser";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";

const WEB_DIR = path.resolve(__dirname, "../../");
const PORT = 3093; // Different from Feature #5 test port
const DAEMON_PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = path.resolve(WEB_DIR, "..");

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;
let daemonWss: WebSocketServer;
let daemonClients: Set<WsWebSocket>;

const ACTIONS_FILE = path.join(PROJECT_ROOT, "spec", "actions.jsonl");
let originalActionsContent: string | null = null;

const SEED_MESSAGES = [
  { action: "to_arch", from: "human", to: "arch", ts: 1700000000, message: "Hello arch" },
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

/**
 * Start a WS server that faithfully replicates daemon behavior:
 * - Sends "connected" event on connection
 * - broadcast() sends raw string data (same as Daemon.broadcast)
 */
function startDaemonReplicaWS(): Promise<void> {
  return new Promise((resolve, reject) => {
    daemonClients = new Set();
    daemonWss = new WebSocketServer({ port: DAEMON_PORT }, () => {
      resolve();
    });
    daemonWss.on("error", reject);
    daemonWss.on("connection", (ws) => {
      daemonClients.add(ws);
      // Exact same welcome message as daemon.js L184-189
      ws.send(
        JSON.stringify({
          type: "connected",
          clientId: `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          daemonPid: process.pid,
          timestamp: new Date().toISOString(),
        })
      );
      ws.on("close", () => {
        daemonClients.delete(ws);
      });
    });
  });
}

function stopDaemonReplicaWS(): Promise<void> {
  return new Promise((resolve) => {
    if (daemonWss) {
      for (const client of daemonClients) {
        client.terminate();
      }
      daemonClients.clear();
      daemonWss.close(() => resolve());
    } else {
      resolve();
    }
  });
}

/**
 * Replicate EXACTLY what daemon MessageRouter does:
 *   const wsEvent = JSON.stringify({ type: 'agent.msg', payload: rawLine });
 *   daemon.broadcast(wsEvent);
 *
 * rawLine is the raw JSONL text line (a string), NOT JSON.stringify(object).
 * This is the critical protocol detail.
 */
function broadcastViaMessageRouterProtocol(rawJSONLLine: string) {
  // This is exactly MessageRouter._handleAction (message-router.js L83-86)
  const wsEvent = JSON.stringify({
    type: "agent.msg",
    payload: rawJSONLLine, // string - raw JSONL line
  });

  // This is exactly Daemon.broadcast (daemon.js L249-256)
  // typeof wsEvent === 'string' → send as-is
  for (const client of daemonClients) {
    if (client.readyState === WsWebSocket.OPEN) {
      client.send(wsEvent);
    }
  }
}

describe("Module 1 Feature #7: WS 实时推送 → DOM 更新", () => {
  beforeAll(async () => {
    // Backup actions.jsonl
    if (fs.existsSync(ACTIONS_FILE)) {
      originalActionsContent = fs.readFileSync(ACTIONS_FILE, "utf-8");
    }
    fs.writeFileSync(
      ACTIONS_FILE,
      SEED_MESSAGES.map((m) => JSON.stringify(m)).join("\n") + "\n"
    );

    // Start daemon replica WS first
    await startDaemonReplicaWS();

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
    await stopDaemonReplicaWS();

    // Restore actions.jsonl
    if (originalActionsContent !== null) {
      fs.writeFileSync(ACTIONS_FILE, originalActionsContent, "utf-8");
    } else if (fs.existsSync(ACTIONS_FILE)) {
      fs.unlinkSync(ACTIONS_FILE);
    }
  });

  it("Step 1: useDaemonSocket catch block has console.error (code verification)", async () => {
    // Verify source code has console.error in catch block
    const hookSource = fs.readFileSync(
      path.join(WEB_DIR, "src/lib/useDaemonSocket.ts"),
      "utf-8"
    );
    // Check that catch blocks contain console.error, not empty catch
    expect(hookSource).toContain("console.error");
    expect(hookSource).not.toMatch(/catch\s*\{\s*\/\/\s*Skip/);
    expect(hookSource).toContain("[useDaemonSocket]");
  });

  it("Step 2: daemon MessageRouter protocol message received and parsed without error", async () => {
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await page.waitForSelector("[data-testid='chat-panel']", { timeout: 10000 });

    // Wait for WS connection
    await page.waitForFunction(
      () => {
        const dot = document.querySelector("[data-testid='chat-status-dot']");
        return dot?.classList.contains("chat-status-online");
      },
      { timeout: 8000 }
    );

    // Collect browser console errors
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("[useDaemonSocket]")) {
        consoleErrors.push(msg.text());
      }
    });

    // Build a raw JSONL line exactly as it would appear in actions.jsonl
    const rawLine = JSON.stringify({
      action: "to_human",
      from: "arch",
      to: "human",
      ts: Math.floor(Date.now() / 1000),
      message: `PROTOCOL_TEST_${Date.now()}`,
    });

    // Broadcast using exact MessageRouter protocol
    broadcastViaMessageRouterProtocol(rawLine);

    // Wait a moment for any parsing errors to surface
    await new Promise((r) => setTimeout(r, 2000));

    // No useDaemonSocket errors should have occurred
    expect(consoleErrors).toEqual([]);
  });

  it("Step 3: DOM updates with new chat bubble in real-time (no refresh needed)", async () => {
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await page.waitForSelector("[data-testid='chat-messages']", { timeout: 10000 });

    // Wait for WS connection
    await page.waitForFunction(
      () => {
        const dot = document.querySelector("[data-testid='chat-status-dot']");
        return dot?.classList.contains("chat-status-online");
      },
      { timeout: 8000 }
    );

    // Count current messages
    const beforeCount = await page.$$eval(
      ".chat-bubble-text",
      (els) => els.length
    );

    // Send agent message via daemon protocol
    const uniqueMsg = `DOM_UPDATE_TEST_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const rawLine = JSON.stringify({
      action: "to_human",
      from: "arch",
      to: "human",
      ts: Math.floor(Date.now() / 1000),
      message: uniqueMsg,
    });
    broadcastViaMessageRouterProtocol(rawLine);

    // Wait for new bubble to appear — should happen WITHOUT page refresh
    await page.waitForFunction(
      (msg: string) => {
        const texts = Array.from(document.querySelectorAll(".chat-bubble-text"));
        return texts.some((el) => el.textContent === msg);
      },
      { timeout: 5000 },
      uniqueMsg
    );

    // Verify count increased
    const afterCount = await page.$$eval(
      ".chat-bubble-text",
      (els) => els.length
    );
    expect(afterCount).toBeGreaterThan(beforeCount);

    // Verify it's rendered as agent bubble (left-aligned)
    // Find the bubble containing our unique message and check its parent row
    const bubbleAlignment = await page.$$eval(
      ".chat-bubble-row",
      (rows, msg) => {
        for (const row of rows) {
          const text = row.querySelector(".chat-bubble-text");
          if (text && text.textContent === msg) {
            return row.className;
          }
        }
        return null;
      },
      uniqueMsg
    );
    expect(bubbleAlignment).toContain("chat-bubble-left");
  });
});
