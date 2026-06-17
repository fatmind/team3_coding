"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ProjectInfo, PanelId } from "./AppShell";
import CreateProjectModal from "./CreateProjectModal";

const PANELS: { id: PanelId; label: string; icon: string }[] = [
  { id: 1, label: "人类你说", icon: "&#128172;" },
  { id: 2, label: "整体进度", icon: "&#128200;" },
  { id: 3, label: "开发过程", icon: "&#128736;" },
  { id: 4, label: "Agents", icon: "&#129302;" },
];

interface SidebarProps {
  projects: ProjectInfo[];
  selectedProject: string | null;
  activePanel: PanelId;
  loading: boolean;
  onSelectProject: (name: string) => void;
  onSelectPanel: (panel: PanelId) => void;
  onProjectCreated: () => void;
}

export default function Sidebar({
  projects,
  selectedProject,
  activePanel,
  loading,
  onSelectProject,
  onSelectPanel,
  onProjectCreated,
}: SidebarProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <>
      <aside className="sidebar" data-slot="sidebar" data-testid="sidebar">
        {/* Brand header */}
        <div className="sidebar-brand">
          <span className="sidebar-brand-icon">&#9881;</span>
          <span className="sidebar-brand-name">team3</span>
        </div>

        {/* Create project button */}
        <div className="sidebar-header">
          <button
            className="sidebar-create-btn"
            onClick={() => setShowCreateModal(true)}
            data-testid="sidebar-create-btn"
          >
            + 新建项目
          </button>
        </div>

        {/* Project list */}
        <div className="sidebar-section">
          <div className="sidebar-section-title"># PROJECTS</div>
          {loading ? (
            <div className="sidebar-loading">Loading...</div>
          ) : projects.length === 0 ? (
            <div className="sidebar-empty">No projects yet</div>
          ) : (
            <div className="sidebar-project-list" data-testid="sidebar-project-list">
              {projects.map((p) => (
                <div key={p.name} className="sidebar-project-group">
                  <button
                    className={cn("sidebar-project-item", selectedProject === p.name && "active")}
                    onClick={() => onSelectProject(p.name)}
                    data-testid={`sidebar-project-${p.name}`}
                  >
                    <span className="sidebar-project-name"># {p.name}</span>
                  </button>
                  {selectedProject === p.name && (
                    <nav className="sidebar-nav" data-testid="sidebar-nav">
                      {PANELS.map((panel) => (
                        <button
                          key={panel.id}
                          className={cn("sidebar-nav-item", activePanel === panel.id && "active")}
                          onClick={() => onSelectPanel(panel.id)}
                          data-testid={`sidebar-panel-${panel.id}`}
                        >
                          <span
                            className="sidebar-nav-icon"
                            dangerouslySetInnerHTML={{ __html: panel.icon }}
                          />
                          <span className="sidebar-nav-label">{panel.label}</span>
                        </button>
                      ))}
                    </nav>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="sidebar-footer">
          <button className="sidebar-settings-btn" data-testid="sidebar-settings">
            <span className="sidebar-settings-icon">&#9881;</span>
            设置
          </button>
        </div>
      </aside>

      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(name) => {
            setShowCreateModal(false);
            onProjectCreated();
            onSelectProject(name);
          }}
        />
      )}
    </>
  );
}
