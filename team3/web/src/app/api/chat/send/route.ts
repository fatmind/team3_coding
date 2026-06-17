/**
 * POST /api/chat/send
 *
 * Body: { action: string, to: string, message: string }
 * Appends a JSON line to spec/actions.jsonl with from='human' and ts=current timestamp.
 * Returns 200 on success.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkspace } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = ["to_arch", "to_human", "dev_do", "dev_fix", "uat_design", "uat_check", "uat_fix", "note"];
const VALID_TARGETS = ["arch", "dev", "uat", "human", ""];

export async function POST(request: Request) {
  const start = Date.now();
  let body: { action?: string; to?: string; message?: string };

  try {
    body = await request.json();
  } catch {
    webLog.api("POST", "/api/chat/send", 400, Date.now() - start);
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { action, to, message } = body;

  if (!action || typeof action !== "string") {
    return Response.json(
      { error: "Missing required field: action" },
      { status: 400 }
    );
  }

  if (!VALID_ACTIONS.includes(action)) {
    return Response.json(
      { error: `Invalid action: ${action}. Valid: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  if (to === undefined || to === null || typeof to !== "string") {
    return Response.json(
      { error: "Missing required field: to" },
      { status: 400 }
    );
  }

  if (!VALID_TARGETS.includes(to)) {
    return Response.json(
      { error: `Invalid target: ${to}. Valid: ${VALID_TARGETS.join(", ")}` },
      { status: 400 }
    );
  }

  if (!message || typeof message !== "string") {
    return Response.json(
      { error: "Missing required field: message" },
      { status: 400 }
    );
  }

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

  const entry = {
    action,
    from: "human",
    to,
    ts: Math.floor(Date.now() / 1000),
    message,
  };

  try {
    // Ensure spec directory exists
    const specDir = path.dirname(actionsFile);
    fs.mkdirSync(specDir, { recursive: true });

    // Append the JSON line
    fs.appendFileSync(actionsFile, JSON.stringify(entry) + "\n", "utf-8");

    webLog.api("POST", "/api/chat/send", 200, Date.now() - start);
    return Response.json({ success: true, entry });
  } catch {
    webLog.api("POST", "/api/chat/send", 500, Date.now() - start);
    return Response.json(
      { error: "Failed to write to actions.jsonl" },
      { status: 500 }
    );
  }
}
