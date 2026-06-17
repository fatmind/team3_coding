/**
 * GET /api/timeline?mid=module_X
 *
 * Returns the module_X_progress.txt file content as plain text.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkspace } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

function isValidModuleId(mid: string): boolean {
  return /^module_[a-zA-Z0-9_]+$/.test(mid);
}

export async function GET(request: Request) {
  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const mid = searchParams.get("mid");

  if (!mid) {
    return Response.json(
      { error: "Missing required query parameter: mid" },
      { status: 400 }
    );
  }

  if (!isValidModuleId(mid)) {
    return Response.json(
      { error: `Invalid module ID: ${mid}` },
      { status: 404 }
    );
  }

  const workspace = searchParams.get("workspace");
  const workspaceRoot = resolveWorkspace(workspace);

  if (!workspaceRoot) {
    return Response.json(
      { error: "Missing required query parameter: workspace" },
      { status: 400 }
    );
  }

  const progressPath = path.join(workspaceRoot, "spec", `${mid}_progress.txt`);

  try {
    const content = fs.readFileSync(progressPath, "utf-8");
    webLog.api("GET", `/api/timeline?mid=${mid}`, 200, Date.now() - start);
    return new Response(content, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      webLog.api("GET", `/api/timeline?mid=${mid}`, 404, Date.now() - start);
      return Response.json(
        { error: `Progress file not found for module: ${mid}` },
        { status: 404 }
      );
    }
    webLog.api("GET", `/api/timeline?mid=${mid}`, 500, Date.now() - start);
    return Response.json(
      { error: `Failed to read progress file for module: ${mid}` },
      { status: 500 }
    );
  }
}
