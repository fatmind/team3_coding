import { describe, it, expect } from "vitest";
import {
  parseStreamJsonLine,
  parseContentBlock,
  parseLogLinesFromRaw,
  extractLogTimestamp,
  formatLogTime,
  truncate,
  getParamSummary,
  detectTextTone,
  MAX_CONTENT_LENGTH,
} from "@/lib/stdout-parser";

/** Build a real stream-json assistant line */
function assistantLine(blocks: Record<string, unknown> | Record<string, unknown>[]) {
  return JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-opus-4-6",
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: Array.isArray(blocks) ? blocks : [blocks],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    session_id: "test-session",
  });
}

describe("stdout-parser.ts", () => {
  describe("truncate()", () => {
    it("returns short strings unchanged", () => {
      expect(truncate("hello")).toBe("hello");
    });

    it("truncates long strings with ...", () => {
      const long = "a".repeat(600);
      const result = truncate(long);
      expect(result).toHaveLength(503); // 500 + '...'
      expect(result.endsWith("...")).toBe(true);
    });

    it("handles null/undefined", () => {
      expect(truncate(null)).toBe("");
      expect(truncate(undefined)).toBe("");
    });
  });

  describe("getParamSummary()", () => {
    it("prefers file_path", () => {
      expect(getParamSummary({ file_path: "/src/foo.js", command: "ls" })).toBe("/src/foo.js");
    });

    it("falls back to command", () => {
      expect(getParamSummary({ command: "npm test" })).toBe("npm test");
    });

    it("returns empty for null", () => {
      expect(getParamSummary(null)).toBe("");
    });
  });

  describe("detectTextTone()", () => {
    it("detects success with checkmark", () => {
      expect(detectTextTone("✓ all done")).toBe("success");
    });

    it("detects success with passed", () => {
      expect(detectTextTone("All tests passed")).toBe("success");
    });

    it("detects mention with arrow + action", () => {
      expect(detectTextTone("→ dev_do dispatch")).toBe("mention");
    });

    it("returns undefined for plain text", () => {
      expect(detectTextTone("ordinary text")).toBeUndefined();
    });
  });

  describe("parseContentBlock()", () => {
    it("parses text block", () => {
      const result = parseContentBlock({ type: "text", text: "Hello" });
      expect(result).toEqual({ content: "Hello" });
    });

    it("parses thinking block (from .thinking field)", () => {
      const result = parseContentBlock({ type: "thinking", thinking: "Let me think...", signature: "abc" });
      expect(result?.content).toMatch(/^\[思考\]/);
      expect(result?.content).toContain("Let me think");
    });

    it("parses tool_use block", () => {
      const result = parseContentBlock({ type: "tool_use", name: "Read", input: { file_path: "/a.js" } });
      expect(result).toEqual({ content: "Read /a.js", tone: "route" });
    });

    it("returns null for tool_result", () => {
      expect(parseContentBlock({ type: "tool_result" })).toBeNull();
    });
  });

  describe("parseStreamJsonLine() — real format", () => {
    it("parses assistant text", () => {
      const line = assistantLine({ type: "text", text: "Hello world" });
      const result = parseStreamJsonLine(line);
      expect(result).toEqual([{ content: "Hello world" }]);
    });

    it("parses assistant thinking", () => {
      const line = assistantLine({ type: "thinking", thinking: "Analyzing...", signature: "x" });
      const result = parseStreamJsonLine(line);
      expect(result).toHaveLength(1);
      expect(result![0].content).toMatch(/^\[思考\] Analyzing/);
    });

    it("parses assistant tool_use with file_path", () => {
      const line = assistantLine({ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/app.js" } });
      const result = parseStreamJsonLine(line);
      expect(result).toEqual([{ content: "Read /src/app.js", tone: "route" }]);
    });

    it("detects success tone", () => {
      const line = assistantLine({ type: "text", text: "All tests passed ✓" });
      const result = parseStreamJsonLine(line);
      expect(result![0].tone).toBe("success");
    });

    it("returns null for system events", () => {
      expect(parseStreamJsonLine(JSON.stringify({ type: "system", subtype: "init" }))).toBeNull();
    });

    it("returns null for user events", () => {
      expect(
        parseStreamJsonLine(JSON.stringify({ type: "user", message: { content: [] } }))
      ).toBeNull();
    });

    it("returns null for result events", () => {
      expect(
        parseStreamJsonLine(JSON.stringify({ type: "result", subtype: "success", result: "done" }))
      ).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      expect(parseStreamJsonLine("not json")).toBeNull();
    });

    it("returns null for empty/null", () => {
      expect(parseStreamJsonLine("")).toBeNull();
      expect(parseStreamJsonLine(null)).toBeNull();
    });

    it("handles real claude log format (thinking)", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-6",
          id: "msg_vrtx_01G1XqNU7D8xpM2hLSTVhtHS",
          type: "message",
          role: "assistant",
          content: [{
            type: "thinking",
            thinking: "The user is asking me to check if the product design is clear.",
            signature: "Eq8D...",
          }],
          stop_reason: null,
          usage: { input_tokens: 3, output_tokens: 14 },
        },
        session_id: "c90f755f-31b3-412a-ba36-4cd624dd61c9",
      });
      const result = parseStreamJsonLine(line);
      expect(result).toHaveLength(1);
      expect(result![0].content).toContain("[思考]");
      expect(result![0].content).toContain("product design");
    });

    it("handles real claude log format (tool_use)", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-6",
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "toolu_vrtx_01GQdXsgs5HYDDSpFNLzzcV9",
            name: "Bash",
            input: { command: "pwd && ls", description: "Check current directory" },
          }],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 26 },
        },
        session_id: "test-session",
      });
      const result = parseStreamJsonLine(line);
      expect(result).toEqual([{ content: "Bash pwd && ls", tone: "route" }]);
    });
  });

  describe("timestamp helpers", () => {
    it("formats ISO timestamps as HH:MM:SS", () => {
      expect(formatLogTime("2026-06-15T16:17:28.315Z")).toBe(
        new Date("2026-06-15T16:17:28.315Z").toLocaleTimeString("en-GB", { hour12: false })
      );
    });

    it("extracts timestamp from user stream-json lines", () => {
      const line = JSON.stringify({
        type: "user",
        timestamp: "2026-06-15T16:17:54.693Z",
        message: { role: "user", content: [] },
      });
      expect(extractLogTimestamp(line)).toBe(formatLogTime("2026-06-15T16:17:54.693Z"));
    });

    it("assigns assistant lines the nearest user timestamp", () => {
      const rawLines = [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Step 1" }] },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-15T16:17:28.315Z",
          message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a.js" } }] },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-15T16:17:54.693Z",
          message: { role: "user", content: [{ type: "tool_result", content: "done" }] },
        }),
      ];

      const result = parseLogLinesFromRaw(rawLines);
      expect(result).toHaveLength(2);
      expect(result[0].time).toBe(formatLogTime("2026-06-15T16:17:28.315Z"));
      expect(result[1].time).toBe(formatLogTime("2026-06-15T16:17:54.693Z"));
    });
  });
});
