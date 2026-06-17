import * as fs from "node:fs";
import * as path from "node:path";

const DATE_LOG_PATTERN = /^(\d{4}-\d{2}-\d{2})\.log$/;

function agentLogFilePattern(role: string): RegExp {
  return new RegExp(`^${role}_(\\d{4}-\\d{2}-\\d{2})\\.log$`);
}

/** List `{role}_YYYY-MM-DD.log` files in logsDir, newest date first. */
export function listAgentLogFiles(logsDir: string, role: string): string[] {
  if (!fs.existsSync(logsDir)) return [];

  const pattern = agentLogFilePattern(role);
  const entries = fs.readdirSync(logsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(pattern);
      return { path: path.join(logsDir, entry.name), date: match?.[1] ?? "" };
    })
    .filter((entry) => DATE_LOG_PATTERN.test(`${entry.date}.log`))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((entry) => entry.path);
}

function fileHasNonEmptyLines(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;

  const content = fs.readFileSync(filePath, "utf-8");
  return content.split("\n").some((line) => line.trim().length > 0);
}

/** Resolve the newest dated log file that exists and has at least one non-empty line. */
export function resolveLatestAgentLogFile(logsDir: string, role: string): string | null {
  for (const filePath of listAgentLogFiles(logsDir, role)) {
    if (fileHasNonEmptyLines(filePath)) {
      return filePath;
    }
  }

  return null;
}

/** Read the tail of the newest non-empty agent log file for a role. */
export function readAgentLogTail(logsDir: string, role: string, limit: number): string[] {
  const logFilePath = resolveLatestAgentLogFile(logsDir, role);
  if (!logFilePath) return [];

  const content = fs.readFileSync(logFilePath, "utf-8");
  const allLines = content.split("\n").filter((line) => line.trim().length > 0);
  return allLines.slice(-limit);
}
