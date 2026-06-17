/**
 * stdout-parser.ts - Feature #9 (Module 1)
 *
 * TypeScript port of daemon/src/stdout-parser.js (Feature #22).
 * Parses claude code --output-format stream-json stdout lines.
 *
 * Real stream-json format:
 *   assistant/text:     {type:"assistant", message:{content:[{type:"text", text:"Hello"}]}}
 *   assistant/thinking: {type:"assistant", message:{content:[{type:"thinking", thinking:"..."}]}}
 *   assistant/tool_use: {type:"assistant", message:{content:[{type:"tool_use", name:"Read", input:{...}}]}}
 *   system/user/result: skipped (return null)
 */

export const MAX_CONTENT_LENGTH = 500;

export interface LogLine {
  content: string;
  tone?: "success" | "mention" | "route";
  /** HH:MM:SS from stream-json timestamp field */
  time?: string;
}

const ACTION_KEYWORDS = [
  "to_arch",
  "to_human",
  "dev_do",
  "dev_fix",
  "uat_check",
  "uat_fix",
  "uat_design",
  "dispatch",
  "route",
  "forward",
  "send",
  "notify",
];

/** Truncate a string to maxLen characters, appending '...' if truncated. */
export function truncate(str: string | null | undefined, maxLen = MAX_CONTENT_LENGTH): string {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + "...";
}

/** Extract a short parameter summary from tool_use input. Priority: file_path > command > description > query */
export function getParamSummary(input: Record<string, unknown> | null | undefined): string {
  if (!input || typeof input !== "object") return "";

  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.command === "string") return input.command;
  if (typeof input.description === "string") return input.description;
  if (typeof input.query === "string") return input.query;

  for (const key of Object.keys(input)) {
    const val = input[key];
    if (typeof val === "string" && val.length > 0) return val;
  }

  return "";
}

/** Detect tone for text content. */
export function detectTextTone(text: string | null | undefined): LogLine["tone"] | undefined {
  if (!text) return undefined;

  if (text.includes("✓") || text.toLowerCase().includes("passed")) {
    return "success";
  }

  if (text.includes("→")) {
    const lower = text.toLowerCase();
    for (const keyword of ACTION_KEYWORDS) {
      if (lower.includes(keyword)) return "mention";
    }
  }

  return undefined;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Parse a single content block from message.content[]. */
export function parseContentBlock(block: ContentBlock | null | undefined): LogLine | null {
  if (!block || !block.type) return null;

  if (block.type === "thinking") {
    const text = block.thinking || "";
    return { content: "[思考] " + truncate(text, MAX_CONTENT_LENGTH) };
  }

  if (block.type === "text") {
    const text = block.text || "";
    const content = truncate(text, MAX_CONTENT_LENGTH);
    const tone = detectTextTone(text);
    const item: LogLine = { content };
    if (tone) item.tone = tone;
    return item;
  }

  if (block.type === "tool_use") {
    const name = block.name || "unknown_tool";
    const paramSummary = getParamSummary(block.input);
    const summaryText = paramSummary ? `${name} ${paramSummary}` : name;
    const content = truncate(summaryText, MAX_CONTENT_LENGTH);
    return { content, tone: "route" };
  }

  return null;
}

/** Parse a single stream-json line. Returns array of LogLine items or null. */
export function parseStreamJsonLine(line: string | null | undefined): LogLine[] | null {
  if (!line || !line.trim()) return null;

  let parsed: { type?: string; message?: { content?: ContentBlock[] } };
  try {
    parsed = JSON.parse(line.trim());
  } catch {
    return null;
  }

  if (parsed.type !== "assistant") return null;

  const contentBlocks = parsed.message?.content;
  if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) return null;

  const results: LogLine[] = [];
  for (const block of contentBlocks) {
    const item = parseContentBlock(block);
    if (item) results.push(item);
  }

  return results.length > 0 ? results : null;
}

/** Format ISO timestamp or Date as HH:MM:SS (24h). */
export function formatLogTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "";
  }
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

/** Extract top-level timestamp from a raw stream-json line (user/tool_result events). */
export function extractLogTimestamp(rawLine: string | null | undefined): string | null {
  if (!rawLine?.trim()) return null;

  try {
    const parsed = JSON.parse(rawLine.trim()) as { timestamp?: string };
    if (typeof parsed.timestamp === "string") {
      return formatLogTime(parsed.timestamp);
    }
  } catch {
    // Non-JSON line
  }

  return null;
}

function resolveLineTimestamp(timestamps: (string | null)[], index: number): string | null {
  if (timestamps[index]) return timestamps[index];

  for (let j = index + 1; j < timestamps.length; j++) {
    if (timestamps[j]) return timestamps[j];
  }

  for (let j = index - 1; j >= 0; j--) {
    if (timestamps[j]) return timestamps[j];
  }

  return null;
}

/**
 * Parse raw log file lines into display log entries with timestamps.
 * Assistant lines inherit time from nearest user/tool_result timestamp.
 */
export function parseLogLinesFromRaw(rawLines: string[]): LogLine[] {
  const timestamps = rawLines.map(extractLogTimestamp);
  const results: LogLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const parsed = parseStreamJsonLine(rawLines[i]);
    if (!parsed) continue;

    const time = resolveLineTimestamp(timestamps, i);
    for (const item of parsed) {
      results.push(time ? { ...item, time } : item);
    }
  }

  return results;
}
