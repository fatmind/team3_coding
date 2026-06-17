/**
 * GET /api/chat/history
 *
 * Reads spec/actions.jsonl and returns all entries as a JSON array.
 * Each line is parsed as JSON. Invalid lines are skipped.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkspace } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const workspace = searchParams.get("workspace");
  const workspaceRoot = resolveWorkspace(workspace);

  if (!workspaceRoot) {
    return Response.json(
      { error: "Missing required query parameter: workspace" },
      { status: 400 }
    );
  }

  const actionsFile = path.join(workspaceRoot, "spec", "actions.jsonl");

  try {
    if (!fs.existsSync(actionsFile)) {
      webLog.api("GET", "/api/chat/history", 200, Date.now() - start);
      return Response.json([]);
    }

    const content = fs.readFileSync(actionsFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const messages: unknown[] = [];

    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // Skip invalid JSON lines
      }
    }

    webLog.api("GET", "/api/chat/history", 200, Date.now() - start);
    return Response.json(messages);
  } catch {
    webLog.api("GET", "/api/chat/history", 500, Date.now() - start);
    return Response.json(
      { error: "Failed to read chat history" },
      { status: 500 }
    );
  }
}
