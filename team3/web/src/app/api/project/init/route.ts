/**
 * POST /api/project/init
 *
 * Body: { name: string, parentDir?: string }
 * Creates a new project workspace using initWorkspace,
 * then registers it in data/projects.json.
 * Returns { success, workspace, name } on success.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { initWorkspace } from "@/lib/init/init-workspace";
import { addProject } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const start = Date.now();
  let body: { name?: string; parentDir?: string };

  try {
    body = await request.json();
  } catch {
    webLog.api("POST", "/api/project/init", 400, Date.now() - start);
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { name, parentDir } = body;

  if (!name || typeof name !== "string") {
    return Response.json(
      { error: "Missing required field: name" },
      { status: 400 }
    );
  }

  // Validate name: only allow alphanumeric, dash, underscore, dot
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return Response.json(
      { error: "Invalid project name: only alphanumeric, dash, underscore, and dot allowed" },
      { status: 400 }
    );
  }

  // Validate parentDir: must be provided and must be absolute
  if (!parentDir || typeof parentDir !== "string") {
    return Response.json(
      { error: "Missing required field: parentDir (absolute path)" },
      { status: 400 }
    );
  }

  if (!path.isAbsolute(parentDir)) {
    return Response.json(
      { error: "parentDir must be an absolute path" },
      { status: 400 }
    );
  }

  // Resolve parent directory
  const resolvedParent = path.resolve(parentDir);

  // Build workspace path
  const workspacePath = path.join(resolvedParent, name);

  try {
    // Create workspace directory structure (idempotent — safe for existing dirs)
    initWorkspace(workspacePath);

    // Register in data/projects.json
    const today = new Date();
    const createdTime = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    addProject({ name, workspace: workspacePath, createdTime });

    webLog.api("POST", "/api/project/init", 200, Date.now() - start);
    return Response.json({
      success: true,
      workspace: workspacePath,
      name,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    webLog.api("POST", "/api/project/init", 500, Date.now() - start);
    return Response.json(
      { error: `Failed to create project: ${message}` },
      { status: 500 }
    );
  }
}
