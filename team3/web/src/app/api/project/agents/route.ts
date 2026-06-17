/**
 * PUT /api/project/agents
 *
 * Updates agent name/avatar in .team3-project.json
 * Body: { workspace: string, agentKey: string, name?: string, avatar?: string }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkspace } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const start = Date.now();
  let body: { workspace?: string; agentKey?: string; name?: string; avatar?: string };

  try {
    body = await request.json();
  } catch {
    webLog.api("PUT", "/api/project/agents", 400, Date.now() - start);
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { agentKey, name, avatar } = body;
  const workspace = resolveWorkspace(body.workspace ?? null);

  if (!workspace) {
    return Response.json({ error: "Missing required param: workspace" }, { status: 400 });
  }

  if (!agentKey || typeof agentKey !== "string") {
    return Response.json({ error: "Missing required param: agentKey" }, { status: 400 });
  }

  const validKeys = ["human", "arch_agent", "dev_agent", "uat_agent"];
  if (!validKeys.includes(agentKey)) {
    return Response.json({ error: `Invalid agentKey: ${agentKey}` }, { status: 400 });
  }

  const projectJsonPath = path.join(workspace, ".team3-project.json");

  try {
    const raw = fs.readFileSync(projectJsonPath, "utf-8");
    const data = JSON.parse(raw);

    if (!data.partner) data.partner = {};
    if (!data.partner[agentKey]) data.partner[agentKey] = {};

    if (name !== undefined) data.partner[agentKey].name = name;
    if (avatar !== undefined) data.partner[agentKey].avatar = avatar;

    fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8");

    webLog.api("PUT", "/api/project/agents", 200, Date.now() - start);
    return Response.json({ success: true, agent: data.partner[agentKey] });
  } catch {
    webLog.api("PUT", "/api/project/agents", 500, Date.now() - start);
    return Response.json({ error: "Failed to update agent config" }, { status: 500 });
  }
}
