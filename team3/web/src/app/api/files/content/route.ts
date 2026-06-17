/**
 * GET /api/files/content?path=<relative_path>
 *
 * Returns the file content and modification time.
 * Response: { content: string, mtime: number }
 */

import * as fs from "node:fs";
import { imageMimeType, isImageFile } from "@/lib/file-types";
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
    if (!stat.isFile()) {
      return Response.json(
        { error: "Path is not a file" },
        { status: 400 }
      );
    }

    const mtime = Math.floor(stat.mtimeMs);

    if (isImageFile(relativePath)) {
      webLog.file("read", relativePath, 200);
      webLog.api("GET", `/api/files/content?path=${relativePath}`, 200, Date.now() - start);
      return Response.json({
        kind: "image",
        mimeType: imageMimeType(relativePath),
        mtime,
      });
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");

    webLog.file("read", relativePath, 200);
    webLog.api("GET", `/api/files/content?path=${relativePath}`, 200, Date.now() - start);
    return Response.json({ kind: "text", content, mtime });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      webLog.api("GET", `/api/files/content?path=${relativePath}`, 404, Date.now() - start);
      return Response.json(
        { error: "File not found" },
        { status: 404 }
      );
    }
    webLog.api("GET", `/api/files/content?path=${relativePath}`, 500, Date.now() - start);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
