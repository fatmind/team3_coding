/**
 * WebLogger — Structured event logging for web app.
 * Writes to ~/.team3/logs/web.log with timestamped tagged lines.
 * Tags: [START] [API] [WS] [FILE] [WORKSPACE] [ERROR]
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let logStream: fs.WriteStream | null = null;
let logDir: string | null = null;
let started = false;

function getLogBase(): string {
  return path.join(os.homedir(), ".team3");
}

function ensureStream() {
  if (logStream) return;
  try {
    logDir = path.join(getLogBase(), "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, "web.log");
    logStream = fs.createWriteStream(logPath, { flags: "a" });
  } catch {
    // Non-fatal: logging is best-effort
  }
}

function formatTs(d: Date): string {
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

function write(tag: string, msg: string) {
  const ts = formatTs(new Date());
  const line = `[${ts}] [${tag}] ${msg}\n`;
  ensureStream();
  if (logStream) {
    logStream.write(line);
  }
}

export const webLog = {
  start(info: { port?: number }) {
    if (started) return;
    started = true;
    write("START", `port=${info.port || "?"} pid=${process.pid}`);
  },

  api(method: string, path: string, status: number, durationMs?: number) {
    const dur = durationMs != null ? ` ${durationMs}ms` : "";
    write("API", `${method} ${path} ${status}${dur}`);
  },

  ws(msg: string) {
    write("WS", msg);
  },

  file(operation: string, filePath: string, status: number | string) {
    write("FILE", `${operation} ${filePath} ${status}`);
  },

  workspace(resolved: string) {
    write("WORKSPACE", `resolved=${resolved}`);
  },

  error(msg: string) {
    write("ERROR", msg);
  },
};
