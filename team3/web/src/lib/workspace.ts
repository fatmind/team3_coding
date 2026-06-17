/**
 * Workspace path resolution, security validation, and project registry.
 *
 * Project registry: stored in ~/.team3/projects.json (global user data).
 * Created/updated by POST /api/project/init.
 *
 * All APIs require an explicit workspace query parameter — no fallback to
 * cwd-based resolution. Missing workspace = 400.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/* ------------------------------------------------------------------ */
/*  Workspace resolution                                               */
/* ------------------------------------------------------------------ */

export function resolveWorkspace(workspaceParam?: string | null): string | null {
  if (workspaceParam && typeof workspaceParam === "string") {
    return path.resolve(workspaceParam);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Project registry  (file: ~/.team3/projects.json)                   */
/* ------------------------------------------------------------------ */

export interface ProjectInfo {
  name: string;
  workspace: string;
  createdTime: string;
}

export function getProjectsFilePath(): string {
  return path.join(os.homedir(), ".team3", "projects.json");
}

export function loadProjects(): ProjectInfo[] {
  const filePath = getProjectsFilePath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: ProjectInfo[]): void {
  const filePath = getProjectsFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(projects, null, 2) + "\n", "utf-8");
}

export function addProject(project: ProjectInfo): void {
  const projects = loadProjects();
  const exists = projects.some((p) => p.workspace === project.workspace);
  if (!exists) {
    projects.push(project);
    saveProjects(projects);
  }
}

/**
 * Get the default parent directory for new projects.
 * env TEAM3_PROJECTS_DIR → default (parent of team3/).
 */
export function getProjectsDir(): string {
  if (process.env.TEAM3_PROJECTS_DIR) {
    return path.resolve(process.env.TEAM3_PROJECTS_DIR);
  }
  // web process runs from team3/web/, so team3/ is parent of cwd
  const team3Dir = path.dirname(process.cwd());
  return path.dirname(team3Dir);
}

export function resolveSafePath(
  relativePath: string,
  workspaceRoot: string
): string | null {
  const normalizedRoot = path.resolve(workspaceRoot) + path.sep;
  const resolved = path.resolve(workspaceRoot, relativePath);

  if (resolved === path.resolve(workspaceRoot) || resolved.startsWith(normalizedRoot)) {
    return resolved;
  }

  return null;
}
