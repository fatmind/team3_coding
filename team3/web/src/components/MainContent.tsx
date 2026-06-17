"use client";

import { cn } from "@/lib/cn";
import type { ProjectInfo, PanelId, TabId } from "./AppShell";
import ChatPanel from "./panels/ChatPanel";
import DocPanel from "./panels/DocPanel";
import ProgressPanel from "./panels/ProgressPanel";
import DevProcessPanel from "./panels/DevProcessPanel";
import AgentsPanel from "./panels/AgentsPanel";

interface MainContentProps {
  project: ProjectInfo | null;
  workspace: string | null;
  activePanel: PanelId;
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
}

export default function MainContent({
  project,
  workspace,
  activePanel,
  activeTab,
  onSelectTab,
}: MainContentProps) {
  if (!project || !workspace) {
    return (
      <main className="main-content" data-slot="main-content" data-testid="main-content">
        <div className="main-empty-state">
          <div className="main-empty-icon">&#128640;</div>
          <h2 className="main-empty-title">Welcome to Team3</h2>
          <p className="main-empty-text">
            Select a project from the sidebar, or create a new one to start collaborating with AI agents.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="main-content" data-slot="main-content" data-testid="main-content">
      {/* Header */}
      <header className="main-header" data-testid="main-header">
        <span className="main-header-project"># {project.name}</span>
        {activePanel === 1 && (
          <div className="main-header-tabs" data-testid="main-header-tabs">
            <button
              className={cn("main-tab", activeTab === "chat" && "active")}
              onClick={() => onSelectTab("chat")}
              data-testid="tab-chat"
            >
              chat
            </button>
            <button
              className={cn("main-tab", activeTab === "doc" && "active")}
              onClick={() => onSelectTab("doc")}
              data-testid="tab-doc"
            >
              文档
            </button>
          </div>
        )}
      </header>

      {/* Panel body */}
      <div className="main-panel-body" data-testid="main-panel-body">
        {activePanel === 1 && activeTab === "chat" && (
          <ChatPanel workspace={workspace} />
        )}
        {activePanel === 1 && activeTab === "doc" && (
          <DocPanel workspace={workspace} />
        )}
        {activePanel === 2 && (
          <ProgressPanel workspace={workspace} />
        )}
        {activePanel === 3 && (
          <DevProcessPanel workspace={workspace} />
        )}
        {activePanel === 4 && (
          <AgentsPanel workspace={workspace} />
        )}
      </div>
    </main>
  );
}
