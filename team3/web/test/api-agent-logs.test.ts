import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { formatLogTime } from "@/lib/stdout-parser";
import { listAgentLogFiles, resolveLatestAgentLogFile } from "@/lib/agent-log-files";

function assistantTextLine(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

describe("GET /api/project/agent-logs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-logs-test-"));
    fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function callAPI(params: Record<string, string>) {
    const url = new URL("http://localhost/api/project/agent-logs");
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    // Dynamic import to avoid module caching issues
    const mod = await import("@/app/api/project/agent-logs/route");
    const request = new Request(url.toString());
    return mod.GET(request);
  }

  it("returns 400 without workspace", async () => {
    const res = await callAPI({});
    expect(res.status).toBe(400);
  });

  it("returns 400 with invalid role", async () => {
    const res = await callAPI({ workspace: tmpDir, role: "invalid" });
    expect(res.status).toBe(400);
  });

  it("returns empty array when log file does not exist", async () => {
    const res = await callAPI({ workspace: tmpDir, role: "arch" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it("parses real-format stream-json log lines with timestamps", async () => {
    // Build today's date string
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // Write some real-format log lines
    const logFile = path.join(tmpDir, "logs", `arch_${today}.log`);
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "test" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello from arch" }],
        },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
        timestamp: "2026-06-15T16:17:28.315Z",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { file_path: "/src/app.js" } }],
        },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "done" }] },
        timestamp: "2026-06-15T16:17:54.693Z",
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "done" }),
    ];
    fs.writeFileSync(logFile, lines.join("\n") + "\n");

    const res = await callAPI({ workspace: tmpDir, role: "arch", limit: "10" });
    expect(res.status).toBe(200);
    const data = await res.json();

    // system and result are skipped, should get text + tool_use
    expect(data).toHaveLength(2);
    expect(data[0].content).toBe("Hello from arch");
    expect(data[0].time).toBe(formatLogTime("2026-06-15T16:17:28.315Z"));
    expect(data[1].content).toBe("Read /src/app.js");
    expect(data[1].tone).toBe("route");
    expect(data[1].time).toBe(formatLogTime("2026-06-15T16:17:54.693Z"));
  });

  it("respects limit parameter", async () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const logFile = path.join(tmpDir, "logs", `dev_${today}.log`);

    // Write 5 text lines
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `Line ${i}` }] } })
    );
    fs.writeFileSync(logFile, lines.join("\n") + "\n");

    // Request only last 2
    const res = await callAPI({ workspace: tmpDir, role: "dev", limit: "2" });
    const data = await res.json();

    // Should only parse the last 2 lines
    expect(data).toHaveLength(2);
    expect(data[0].content).toBe("Line 3");
    expect(data[1].content).toBe("Line 4");
  });

  it("falls back to the newest dated log when today's file is missing", async () => {
    const logFile = path.join(tmpDir, "logs", "dev_2026-06-15.log");
    fs.writeFileSync(logFile, `${assistantTextLine("Yesterday dev log")}\n`);

    const res = await callAPI({ workspace: tmpDir, role: "dev", limit: "10" });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toHaveLength(1);
    expect(data[0].content).toBe("Yesterday dev log");
  });

  it("prefers today's log when both today and yesterday exist", async () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    fs.writeFileSync(
      path.join(tmpDir, "logs", "dev_2026-06-15.log"),
      `${assistantTextLine("Old dev log")}\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, "logs", `dev_${today}.log`),
      `${assistantTextLine("Today dev log")}\n`
    );

    const res = await callAPI({ workspace: tmpDir, role: "dev", limit: "10" });
    const data = await res.json();

    expect(data).toHaveLength(1);
    expect(data[0].content).toBe("Today dev log");
  });

  it("falls back when today's log file is empty", async () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    fs.writeFileSync(path.join(tmpDir, "logs", `dev_${today}.log`), "");
    fs.writeFileSync(
      path.join(tmpDir, "logs", "dev_2026-06-15.log"),
      `${assistantTextLine("Fallback dev log")}\n`
    );

    const res = await callAPI({ workspace: tmpDir, role: "dev", limit: "10" });
    const data = await res.json();

    expect(data).toHaveLength(1);
    expect(data[0].content).toBe("Fallback dev log");
  });
});

describe("agent-log-files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-log-files-test-"));
    fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists only dated role logs and ignores legacy files", () => {
    const logsDir = path.join(tmpDir, "logs");
    fs.writeFileSync(path.join(logsDir, "dev_2026-06-15.log"), assistantTextLine("a"));
    fs.writeFileSync(path.join(logsDir, "dev_2026-06-14.log"), assistantTextLine("b"));
    fs.writeFileSync(path.join(logsDir, "dev.log"), assistantTextLine("legacy"));
    fs.writeFileSync(path.join(logsDir, "daemon.log"), "daemon");

    const files = listAgentLogFiles(logsDir, "dev");
    expect(files).toHaveLength(2);
    expect(files[0]).toContain("dev_2026-06-15.log");
    expect(files[1]).toContain("dev_2026-06-14.log");
  });

  it("resolveLatestAgentLogFile skips empty files", () => {
    const logsDir = path.join(tmpDir, "logs");
    fs.writeFileSync(path.join(logsDir, "dev_2026-06-16.log"), "");
    fs.writeFileSync(path.join(logsDir, "dev_2026-06-15.log"), `${assistantTextLine("ok")}\n`);

    expect(resolveLatestAgentLogFile(logsDir, "dev")).toBe(
      path.join(logsDir, "dev_2026-06-15.log")
    );
  });
});
