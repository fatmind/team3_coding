/**
 * GET /api/project/agent-logs?workspace=X&role=arch&limit=50
 *
 * Reads the latest agent log file for the role in logs/<role>_YYYY-MM-DD.log.
 * Prefers today's file; if missing or empty, falls back to the newest dated file.
 * Takes the last `limit` lines, parses them with stdout-parser,
 * and returns [{content, tone, time?}].
 *
 * Returns empty array if no matching log file exists.
 */

import * as path from "node:path";
import { readAgentLogTail } from "@/lib/agent-log-files";
import { resolveWorkspace } from "@/lib/workspace";
import { parseLogLinesFromRaw } from "@/lib/stdout-parser";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["arch", "dev", "uat"]);

export async function GET(request: Request) {
  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const workspace = resolveWorkspace(searchParams.get("workspace"));
  const role = searchParams.get("role");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50;

  if (!workspace) {
    webLog.api("GET", "/api/project/agent-logs", 400, Date.now() - start);
    return Response.json({ error: "Missing required param: workspace" }, { status: 400 });
  }

  if (!role || !VALID_ROLES.has(role)) {
    webLog.api("GET", "/api/project/agent-logs", 400, Date.now() - start);
    return Response.json({ error: "Missing or invalid param: role (arch|dev|uat)" }, { status: 400 });
  }

  const logsDir = path.join(workspace, "logs");

  try {
    const tailLines = readAgentLogTail(logsDir, role, limit);
    const results = parseLogLinesFromRaw(tailLines);

    webLog.api("GET", "/api/project/agent-logs", 200, Date.now() - start);
    return Response.json(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    webLog.api("GET", "/api/project/agent-logs", 500, Date.now() - start);
    return Response.json({ error: message }, { status: 500 });
  }
}
