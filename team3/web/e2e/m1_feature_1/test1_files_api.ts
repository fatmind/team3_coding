/**
 * E2E Integration Test for Module 1, Feature #1: HTTP API — 文件读写 + 健康检查
 *
 * Checkpoint verification (from spec/module_1_feature_list.json):
 *   Step 1: GET /health 返回 200 + JSON {status:'ok'}
 *   Step 2: GET /api/files/list?path=spec 返回 spec/ 目录下文件列表（数组，含文件名和类型 file/dir）
 *   Step 3: GET /api/files/content?path=spec/app_design.md 返回 {content: string, mtime: number}
 *   Step 4: PUT /api/files/update body={path:'spec/app_design.md', content:'...'} 写入成功返回 200，本地文件内容一致
 *   Step 5: 路径越界访问（如 path=../../etc/passwd）返回 403
 *
 * This test starts a real Next.js dev server and hits it with HTTP requests.
 * No mocking — validates the full stack.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const WEB_DIR = path.resolve(__dirname, "../../");
const PORT = 3088; // Use a non-standard port to avoid conflicts
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

describe("Module 1 Feature #1: HTTP API — 文件读写 + 健康检查", () => {
  beforeAll(async () => {
    // Start Next.js dev server on a custom port
    serverProcess = spawn("npx", ["next", "dev", "--port", String(PORT)], {
      cwd: WEB_DIR,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Collect stderr for debugging if needed
    serverProcess.stderr?.on("data", (data) => {
      const msg = data.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        console.error("[next dev stderr]", msg);
      }
    });

    // Wait for server to respond
    await waitForServer(`${BASE_URL}/health`);
  }, 60000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      // Give it a moment to clean up
      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill("SIGKILL");
        }
      }, 3000);
    }
  });

  describe("Step 1: GET /health 返回 200 + JSON {status:'ok'}", () => {
    it("returns 200 with status ok", async () => {
      const res = await fetch(`${BASE_URL}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok" });
    });
  });

  describe("Step 2: GET /api/files/list?path=spec returns directory listing", () => {
    it("returns array with file names and types", async () => {
      const res = await fetch(`${BASE_URL}/api/files/list?path=spec`);
      expect(res.status).toBe(200);
      const body = await res.json();

      // Should be an array
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Each entry should have name and type
      for (const entry of body) {
        expect(entry).toHaveProperty("name");
        expect(entry).toHaveProperty("type");
        expect(["file", "dir"]).toContain(entry.type);
      }

      // We know spec/ contains app_design.md and agents/ directory
      const names = body.map((e: { name: string }) => e.name);
      expect(names).toContain("app_design.md");
      expect(names).toContain("agents");

      // Verify type correctness
      const appDesign = body.find((e: { name: string }) => e.name === "app_design.md");
      expect(appDesign.type).toBe("file");

      const agents = body.find((e: { name: string }) => e.name === "agents");
      expect(agents.type).toBe("dir");
    });
  });

  describe("Step 3: GET /api/files/content?path=spec/app_design.md returns content + mtime", () => {
    it("returns content string and mtime number", async () => {
      const res = await fetch(
        `${BASE_URL}/api/files/content?path=spec/app_design.md`
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body).toHaveProperty("content");
      expect(body).toHaveProperty("mtime");
      expect(typeof body.content).toBe("string");
      expect(typeof body.mtime).toBe("number");

      // The content should match the actual file
      const actualContent = fs.readFileSync(
        path.join(PROJECT_ROOT, "spec/app_design.md"),
        "utf-8"
      );
      expect(body.content).toBe(actualContent);

      // mtime should be a reasonable timestamp (after 2020)
      expect(body.mtime).toBeGreaterThan(1577836800000);
    });
  });

  describe("Step 4: PUT /api/files/update writes file successfully", () => {
    const TEST_FILE = "spec/_e2e_test_write.tmp";
    const TEST_CONTENT = "# E2E Test\n\nWritten by integration test at " + Date.now();

    afterAll(() => {
      // Clean up the test file
      const filePath = path.join(PROJECT_ROOT, TEST_FILE);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    it("writes file and returns 200, content matches on disk", async () => {
      const res = await fetch(`${BASE_URL}/api/files/update`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: TEST_FILE, content: TEST_CONTENT }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify the file was actually written to disk
      const filePath = path.join(PROJECT_ROOT, TEST_FILE);
      expect(fs.existsSync(filePath)).toBe(true);
      const diskContent = fs.readFileSync(filePath, "utf-8");
      expect(diskContent).toBe(TEST_CONTENT);
    });
  });

  describe("Step 5: 路径越界访问返回 403", () => {
    it("GET /api/files/list with ../../etc returns 403", async () => {
      const res = await fetch(
        `${BASE_URL}/api/files/list?path=../../etc`
      );
      expect(res.status).toBe(403);
    });

    it("GET /api/files/content with ../../etc/passwd returns 403", async () => {
      const res = await fetch(
        `${BASE_URL}/api/files/content?path=../../etc/passwd`
      );
      expect(res.status).toBe(403);
    });

    it("PUT /api/files/update with traversal path returns 403", async () => {
      const res = await fetch(`${BASE_URL}/api/files/update`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "../../../tmp/evil_file",
          content: "should not be written",
        }),
      });
      expect(res.status).toBe(403);
    });

    it("path with encoded dots (%2e%2e) is handled safely", async () => {
      // URL-encoded: the browser/fetch will decode %2e%2e to .. before the server sees it
      const res = await fetch(
        `${BASE_URL}/api/files/content?path=..%2F..%2Fetc%2Fpasswd`
      );
      expect(res.status).toBe(403);
    });
  });
});
