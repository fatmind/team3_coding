/**
 * PUT /api/files/update
 *
 * Body: { path: string, content: string }
 * Writes content to the specified file path (relative to workspace root).
 * Returns 200 on success.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { resolveWorkspace, resolveSafePath } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const start = Date.now();
  let body: { path?: string; content?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { path: relativePath, content } = body;

  if (!relativePath || typeof relativePath !== "string") {
    return Response.json(
      { error: "Missing required field: path" },
      { status: 400 }
    );
  }

  if (content === undefined || content === null || typeof content !== "string") {
    return Response.json(
      { error: "Missing required field: content" },
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

  const resolvedPath = resolveSafePath(relativePath, workspaceRoot);

  if (!resolvedPath) {
    return Response.json(
      { error: "Access denied: path traversal detected" },
      { status: 403 }
    );
  }

  try {
    // Ensure parent directory exists
    const dir = nodePath.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });

    // Write the file
    fs.writeFileSync(resolvedPath, content, "utf-8");

    webLog.file("write", relativePath, 200);
    webLog.api("PUT", `/api/files/update?path=${relativePath}`, 200, Date.now() - start);
    return Response.json({ success: true });
  } catch {
    webLog.api("PUT", `/api/files/update?path=${relativePath}`, 500, Date.now() - start);
    return Response.json(
      { error: "Failed to write file" },
      { status: 500 }
    );
  }
}
