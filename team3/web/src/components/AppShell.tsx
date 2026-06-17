"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Sidebar from "./Sidebar";
import MainContent from "./MainContent";

export interface ProjectInfo {
  name: string;
  workspace: string;
  createdTime: string;
  daemon_port?: number;
}

export type PanelId = 1 | 2 | 3 | 4;
export type TabId = "chat" | "doc";

export default function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const selectedProject = searchParams.get("project") || null;
  const activePanel = (Number(searchParams.get("panel")) || 1) as PanelId;
  const activeTab = (searchParams.get("tab") as TabId) || "chat";

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data: ProjectInfo[] = await res.json();
        setProjects(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const currentProject = projects.find((p) => p.name === selectedProject) || null;
  const currentWorkspace = currentProject?.workspace || null;

  function updateUrl(params: Record<string, string | null>) {
    const current = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(params)) {
      if (value === null) {
        current.delete(key);
      } else {
        current.set(key, value);
      }
    }
    const qs = current.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  function handleSelectProject(name: string) {
    updateUrl({ project: name, panel: "1", tab: "chat" });
  }

  function handleSelectPanel(panel: PanelId) {
    updateUrl({ panel: String(panel) });
  }

  function handleSelectTab(tab: TabId) {
    updateUrl({ tab });
  }

  return (
    <div className="app-shell" data-slot="app-shell">
      <Sidebar
        projects={projects}
        selectedProject={selectedProject}
        activePanel={activePanel}
        loading={loading}
        onSelectProject={handleSelectProject}
        onSelectPanel={handleSelectPanel}
        onProjectCreated={fetchProjects}
      />
      <MainContent
        project={currentProject}
        workspace={currentWorkspace}
        activePanel={activePanel}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
      />
    </div>
  );
}
