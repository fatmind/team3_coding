/**
 * GET /api/modules
 *   - No query params → returns modules_progress.json content (normalized)
 *   - ?mid=module_X → returns module_X_feature_list.json content
 *
 * Normalization: modules_progress.json is written by AI agents and its schema
 * varies across projects. This API normalizes all variants to a canonical form:
 *   { id: "module_1", name: "显示名称", ... }
 *
 * Known variants:
 *   A: { id: "module_1", name: "活动与报名" }          ← canonical
 *   B: { name: "module_1", title: "流水线编排框架" }     ← name is id, title is display name
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkspace } from "@/lib/workspace";
import { webLog } from "@/lib/web-logger";

export const dynamic = "force-dynamic";

function isValidModuleId(mid: string): boolean {
  return /^module_[a-zA-Z0-9_]+$/.test(mid);
}

function looksLikeModuleId(s: string): boolean {
  return /^module_\w+$/.test(s);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeModules(data: any): any {
  if (!data || !Array.isArray(data.modules)) return data;

  data.modules = data.modules.map((m: any, idx: number) => {
    if (m.id && !looksLikeModuleId(m.id) && m.name && looksLikeModuleId(m.name)) {
      // variant: { id: non-module-id, name: "module_X" } — swap
      return { ...m, id: m.name, name: m.id };
    }

    if (!m.id && m.name && looksLikeModuleId(m.name)) {
      // variant B: { name: "module_1", title: "显示名" } — promote name→id, title→name
      const { name: id, title, ...rest } = m;
      return { ...rest, id, name: title || id };
    }

    if (m.id && looksLikeModuleId(m.id)) {
      // variant A (canonical) or already correct
      return m;
    }

    // fallback: generate id from index
    return { ...m, id: m.id || `module_${idx + 1}`, name: m.name || m.title || `Module ${idx + 1}` };
  });

  return data;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function GET(request: Request) {
  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const mid = searchParams.get("mid");

  const workspace = searchParams.get("workspace");
  const workspaceRoot = resolveWorkspace(workspace);

  if (!workspaceRoot) {
    return Response.json(
      { error: "Missing required query parameter: workspace" },
      { status: 400 }
    );
  }

  if (!mid) {
    // Return modules_progress.json content (normalized)
    const filePath = path.join(workspaceRoot, "spec", "modules_progress.json");

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = normalizeModules(JSON.parse(content));
      webLog.api("GET", "/api/modules", 200, Date.now() - start);
      return Response.json(data);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        webLog.api("GET", "/api/modules", 404, Date.now() - start);
        return Response.json(
          { error: "modules_progress.json not found" },
          { status: 404 }
        );
      }
      webLog.api("GET", "/api/modules", 500, Date.now() - start);
      return Response.json(
        { error: "Failed to read modules_progress.json" },
        { status: 500 }
      );
    }
  }

  // Validate mid format
  if (!isValidModuleId(mid)) {
    return Response.json(
      { error: `Invalid module ID: ${mid}` },
      { status: 404 }
    );
  }

  // Return module_X_feature_list.json content
  const featureListPath = path.join(workspaceRoot, "spec", `${mid}_feature_list.json`);

  try {
    const content = fs.readFileSync(featureListPath, "utf-8");
    const data = JSON.parse(content);
    webLog.api("GET", `/api/modules?mid=${mid}`, 200, Date.now() - start);
    return Response.json(data);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      webLog.api("GET", `/api/modules?mid=${mid}`, 404, Date.now() - start);
      return Response.json(
        { error: `Feature list not found for module: ${mid}` },
        { status: 404 }
      );
    }
    webLog.api("GET", `/api/modules?mid=${mid}`, 500, Date.now() - start);
    return Response.json(
      { error: `Failed to read feature list for module: ${mid}` },
      { status: 500 }
    );
  }
}
