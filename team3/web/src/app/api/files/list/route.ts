/**
 * GET /api/files/list?path=<relative_path>
 *
 * Returns a JSON array of directory entries with name and type (file/dir).
 * The path is relative to the workspace root.
 */

import * as fs from "node:fs";
import { resolveWorkspace, resolveSafePath } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const relativePath = searchParams.get("path");

  if (!relativePath) {
    return Response.json(
      { error: "Missing required query parameter: path" },
      { status: 400 }
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

  const resolvedPath = resolveSafePath(relativePath, workspaceRoot);

  if (!resolvedPath) {
    return Response.json(
      { error: "Access denied: path traversal detected" },
      { status: 403 }
    );
  }

  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return Response.json(
        { error: "Path is not a directory" },
        { status: 400 }
      );
    }

    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    const result = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
    }));

    webLog.api("GET", `/api/files/list?path=${relativePath}`, 200, Date.now() - start);
    return Response.json(result);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      webLog.api("GET", `/api/files/list?path=${relativePath}`, 404, Date.now() - start);
      return Response.json(
        { error: "Path not found" },
        { status: 404 }
      );
    }
    webLog.api("GET", `/api/files/list?path=${relativePath}`, 500, Date.now() - start);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
