/**
 * Unit tests for POST /api/chat/send — rebase special format matching
 * [rebase: xxx] → action=rebase (one format only; daemon decides by state)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

// Mock workspace
vi.mock("@/lib/workspace", () => ({
  resolveWorkspace: vi.fn((ws?: string | null) => ws || null),
}));

// Mock web logger
vi.mock("@/lib/web-logger", () => ({
  webLog: { api: vi.fn() },
}));

import * as fs from "node:fs";
import { POST } from "@/app/api/chat/send/route";

function makeRequest(body: object): Request {
  return new Request("http://localhost/api/chat/send?workspace=/fake/ws", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function appendedEntry(): { action: string; from: string; to: string; message: string } {
  const call = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
  return JSON.parse((call[1] as string).trim());
}

describe("POST /api/chat/send — rebase formats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes normal messages through unchanged", async () => {
    const res = await POST(makeRequest({ action: "to_arch", to: "arch", message: "普通消息" }));
    expect(res.status).toBe(200);
    const entry = appendedEntry();
    expect(entry.action).toBe("to_arch");
    expect(entry.message).toBe("普通消息");
  });

  it("accepts human pure-message channels to_dev / to_uat with from=human", async () => {
    for (const [action, to] of [["to_dev", "dev"], ["to_uat", "uat"]] as const) {
      vi.clearAllMocks();
      const res = await POST(makeRequest({ action, to, message: "补充一句" }));
      expect(res.status).toBe(200);
      const entry = appendedEntry();
      expect(entry.action).toBe(action);
      expect(entry.from).toBe("human");
      expect(entry.to).toBe(to);
    }
  });

  it("rewrites [rebase: xxx] into a rebase action with inner message", async () => {
    const inner = "方向已调整，以新基准为准 [reread: spec/app_design.md, spec/baseline.md]";
    const res = await POST(makeRequest({ action: "to_arch", to: "arch", message: `[rebase: ${inner}]` }));
    expect(res.status).toBe(200);
    const entry = appendedEntry();
    expect(entry.action).toBe("rebase");
    expect(entry.to).toBe("T3");
    expect(entry.from).toBe("human");
    expect(entry.message).toBe(inner);
  });

  it("supports multi-line rebase messages", async () => {
    const inner = "第一行\n第二行 [reread: spec/app_design.md]";
    await POST(makeRequest({ action: "to_arch", to: "arch", message: `[rebase:${inner}]` }));
    expect(appendedEntry().action).toBe("rebase");
    expect(appendedEntry().message).toBe(inner);
  });

  it("targets rebase to T3 regardless of declared to", async () => {
    await POST(makeRequest({ action: "to_human", to: "human", message: "[rebase: 新基准]" }));
    expect(appendedEntry().to).toBe("T3");
  });

  it("rewrites [rebase: 确认] replies the same way (state lives in daemon)", async () => {
    await POST(makeRequest({ action: "to_arch", to: "arch", message: "[rebase: 确认]" }));
    expect(appendedEntry().action).toBe("rebase");
    expect(appendedEntry().message).toBe("确认");
  });

  it("does not treat rebase mentioned mid-text as special format", async () => {
    const msg = "我们聊聊 [rebase: xxx] 这个功能怎么做";
    await POST(makeRequest({ action: "to_arch", to: "arch", message: msg }));
    expect(appendedEntry().action).toBe("to_arch");
    expect(appendedEntry().message).toBe(msg);
  });

  it("still rejects direct rebase action values (only special format allowed)", async () => {
    const res = await POST(makeRequest({ action: "rebase", to: "arch", message: "直接传 action" }));
    expect(res.status).toBe(400);
  });
});
