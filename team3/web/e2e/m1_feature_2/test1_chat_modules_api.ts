/**
 * E2E Integration Test for Module 1, Feature #2: HTTP API — 群聊发送 + modules 数据
 *
 * Checkpoint verification (from spec/module_1_feature_list.json):
 *   Step 1: POST /api/chat/send body={action:'to_arch', to:'arch', message:'hello'} → 200,
 *           spec/actions.jsonl 末尾新增一行合法 JSON（含 from='human', ts 为当前时间戳）
 *   Step 2: GET /api/modules 返回 modules_progress.json 内容（modules 数组 + dependencies）
 *   Step 3: GET /api/modules?mid=module_3 返回对应 module_3_feature_list.json 内容
 *   Step 4: GET /api/timeline?mid=module_3 返回 module_3_progress.txt 文件纯文本内容
 *   Step 5: mid 参数不合法或文件不存在时返回 404 + 错误信息
 *
 * This test starts a real Next.js dev server and hits it with HTTP requests.
 * No mocking — validates the full stack.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const WEB_DIR = path.resolve(__dirname, "../../");
const PORT = 3089; // Unique port to avoid conflicts
const BASE_URL = `http://127.0.0.1:${PORT}`;

// The workspace root is the project directory containing .team3-project.json
const PROJECT_ROOT = path.resolve(WEB_DIR, "..");

let serverProcess: ChildProcess;

/**
 * Wait for the server to be ready by polling the health endpoint.
 */
async function waitForServer(
  url: string,
  timeoutMs = 30000,
  intervalMs = 500
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe("Module 1 Feature #2: HTTP API — 群聊发送 + modules 数据", () => {
  beforeAll(async () => {
    // Start Next.js dev server on a custom port
    serverProcess = spawn("npx", ["next", "dev", "--port", String(PORT)], {
      cwd: WEB_DIR,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    serverProcess.stderr?.on("data", (data) => {
      const msg = data.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        console.error("[next dev stderr]", msg);
      }
    });

    await waitForServer(`${BASE_URL}/health`);
  }, 60000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill("SIGKILL");
        }
      }, 3000);
    }
  });

  describe("Step 1: POST /api/chat/send appends to actions.jsonl", () => {
    it("sends a message and verifies it was appended to actions.jsonl", async () => {
      // Read the current file to know its state before
      const actionsFile = path.join(PROJECT_ROOT, "spec", "actions.jsonl");
      const contentBefore = fs.readFileSync(actionsFile, "utf-8");
      const lineCountBefore = contentBefore.trim().split("\n").length;

      // Send the message
      const res = await fetch(`${BASE_URL}/api/chat/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "to_arch",
          to: "arch",
          message: "hello from e2e test",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.entry.from).toBe("human");
      expect(body.entry.ts).toBeGreaterThan(1704067200); // After 2024

      // Verify the file was actually updated
      const contentAfter = fs.readFileSync(actionsFile, "utf-8");
      const lines = contentAfter.trim().split("\n");
      expect(lines.length).toBe(lineCountBefore + 1);

      // Parse the last line
      const lastLine = JSON.parse(lines[lines.length - 1]);
      expect(lastLine.action).toBe("to_arch");
      expect(lastLine.from).toBe("human");
      expect(lastLine.to).toBe("arch");
      expect(lastLine.message).toBe("hello from e2e test");
      expect(typeof lastLine.ts).toBe("number");

      // Clean up: remove the test line we just added
      const originalLines = contentBefore.trimEnd();
      fs.writeFileSync(actionsFile, originalLines + "\n", "utf-8");
    });
  });

  describe("Step 2: GET /api/modules returns modules_progress.json content", () => {
    it("returns modules array and dependencies", async () => {
      const res = await fetch(`${BASE_URL}/api/modules`);
      expect(res.status).toBe(200);
      const body = await res.json();

      // Should have modules array and dependencies
      expect(body).toHaveProperty("modules");
      expect(body).toHaveProperty("dependencies");
      expect(Array.isArray(body.modules)).toBe(true);
      expect(Array.isArray(body.dependencies)).toBe(true);

      // Verify structure matches what's on disk
      const diskContent = fs.readFileSync(
        path.join(PROJECT_ROOT, "spec", "modules_progress.json"),
        "utf-8"
      );
      const diskData = JSON.parse(diskContent);
      expect(body).toEqual(diskData);
    });
  });

  describe("Step 3: GET /api/modules?mid=module_3 returns feature_list content", () => {
    it("returns module_3_feature_list.json content", async () => {
      const res = await fetch(`${BASE_URL}/api/modules?mid=module_3`);
      expect(res.status).toBe(200);
      const body = await res.json();

      // Should be an array of features
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Each feature should have id, description, checkpoint, passes
      for (const feature of body) {
        expect(feature).toHaveProperty("id");
        expect(feature).toHaveProperty("description");
        expect(feature).toHaveProperty("checkpoint");
        expect(feature).toHaveProperty("passes");
      }

      // Verify matches disk content
      const diskContent = fs.readFileSync(
        path.join(PROJECT_ROOT, "spec", "module_3_feature_list.json"),
        "utf-8"
      );
      const diskData = JSON.parse(diskContent);
      expect(body).toEqual(diskData);
    });
  });

  describe("Step 4: GET /api/timeline?mid=module_3 returns progress.txt content", () => {
    it("returns plain text content of module_3_progress.txt", async () => {
      const res = await fetch(`${BASE_URL}/api/timeline?mid=module_3`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");

      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);

      // Verify matches disk content
      const diskContent = fs.readFileSync(
        path.join(PROJECT_ROOT, "spec", "module_3_progress.txt"),
        "utf-8"
      );
      expect(text).toBe(diskContent);
    });
  });

  describe("Step 5: invalid mid or missing file returns 404", () => {
    it("GET /api/modules?mid=invalid returns 404", async () => {
      const res = await fetch(`${BASE_URL}/api/modules?mid=invalid`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("GET /api/modules?mid=module_999 (non-existent) returns 404", async () => {
      const res = await fetch(`${BASE_URL}/api/modules?mid=module_999`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("GET /api/timeline?mid=invalid returns 404", async () => {
      const res = await fetch(`${BASE_URL}/api/timeline?mid=invalid`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("GET /api/timeline?mid=module_999 (non-existent) returns 404", async () => {
      const res = await fetch(`${BASE_URL}/api/timeline?mid=module_999`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("GET /api/timeline without mid returns 400", async () => {
      const res = await fetch(`${BASE_URL}/api/timeline`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("mid");
    });
  });
});
