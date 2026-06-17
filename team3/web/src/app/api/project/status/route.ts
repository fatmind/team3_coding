/**
 * GET /api/project/status?workspace=...
 *
 * Returns daemon status and agent info for a given workspace.
 * Response: { daemon: { running, pid, port, lastHeartbeat }, agents: [...] }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkspace } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

interface ProjectJson {
  name?: string;
  init_daemon?: number;
  daemon_port?: number;
  daemon_heart?: string;
  partner?: Record<string, { name?: string; avatar?: string; session?: { runing?: string } }>;
}

export async function GET(request: Request) {
  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const workspace = resolveWorkspace(searchParams.get("workspace"));

  if (!workspace) {
    return Response.json(
      { error: "Missing required param: workspace" },
      { status: 400 }
    );
  }

  const projectJsonPath = path.join(workspace, ".team3-project.json");

  let projectData: ProjectJson = {};
  try {
    if (fs.existsSync(projectJsonPath)) {
      const raw = fs.readFileSync(projectJsonPath, "utf-8");
      projectData = JSON.parse(raw);
    }
  } catch {
    // file missing or invalid
  }

  const pid = projectData.init_daemon || null;
  let running = false;

  if (pid) {
    try {
      process.kill(pid, 0);
      running = true;
    } catch {
      running = false;
    }
  }

  // Read daemon port from .team3-project.json (written by start-daemon.ts)
  const port: number | null = projectData.daemon_port || null;

  // Parse agents from partner field
  const agents: { key: string; name: string; avatar: string; role: string; session?: string; status: string }[] = [];
  const humanInfo = { name: "", avatar: "" };
  if (projectData.partner) {
    const roleMap: Record<string, string> = {
      arch_agent: "Architect",
      dev_agent: "Developer",
      uat_agent: "UAT Tester",
    };
    for (const [key, val] of Object.entries(projectData.partner)) {
      if (key === "human") {
        humanInfo.name = val?.name || "";
        humanInfo.avatar = val?.avatar || "";
        continue;
      }
      agents.push({
        key,
        name: val?.name || key,
        avatar: val?.avatar || "",
        role: roleMap[key] || key,
        session: val?.session?.runing || undefined,
        status: val?.session?.runing ? "active" : "idle",
      });
    }
  }

  webLog.api("GET", "/api/project/status", 200, Date.now() - start);
  return Response.json({
    daemon: {
      running,
      pid: running ? pid : null,
      port,
      lastHeartbeat: projectData.daemon_heart || null,
    },
    agents,
    human: humanInfo,
  });
}
