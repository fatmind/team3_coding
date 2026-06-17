/**
 * GET /api/projects
 *
 * Reads the project list from data/projects.json.
 * Returns a JSON array of project info (name, workspace, createdTime).
 */

import { loadProjects } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();

  try {
    const projects = loadProjects();
    webLog.api("GET", "/api/projects", 200, Date.now() - start);
    return Response.json(projects);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    webLog.api("GET", "/api/projects", 500, Date.now() - start);
    return Response.json(
      { error: `Failed to load projects: ${message}` },
      { status: 500 }
    );
  }
}
