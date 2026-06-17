/**
 * POST /api/project/start
 *
 * Body: { workspace: string }
 * Starts the daemon for the given workspace.
 * Returns { success, pid, port } on success.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { startDaemon } from "@/lib/init/start-daemon";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const start = Date.now();
  let body: { workspace?: string };

  try {
    body = await request.json();
  } catch {
    webLog.api("POST", "/api/project/start", 400, Date.now() - start);
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { workspace } = body;

  if (!workspace || typeof workspace !== "string") {
    webLog.api("POST", "/api/project/start", 400, Date.now() - start);
    return Response.json(
      { error: "Missing required field: workspace" },
      { status: 400 }
    );
  }

  if (!path.isAbsolute(workspace)) {
    webLog.api("POST", "/api/project/start", 400, Date.now() - start);
    return Response.json(
      { error: "workspace must be an absolute path" },
      { status: 400 }
    );
  }

  // Verify .team3-project.json exists
  const projectJsonPath = path.join(workspace, ".team3-project.json");
  if (!fs.existsSync(projectJsonPath)) {
    webLog.api("POST", "/api/project/start", 404, Date.now() - start);
    return Response.json(
      { error: `.team3-project.json not found in ${workspace}` },
      { status: 404 }
    );
  }

  try {
    const result = await startDaemon(workspace);

    webLog.api("POST", "/api/project/start", 200, Date.now() - start);
    return Response.json({
      success: true,
      pid: result.pid,
      port: result.port,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    webLog.api("POST", "/api/project/start", 500, Date.now() - start);
    return Response.json(
      { error: `Failed to start daemon: ${message}` },
      { status: 500 }
    );
  }
}
