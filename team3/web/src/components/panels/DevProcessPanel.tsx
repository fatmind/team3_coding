"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";

interface ModuleInfo {
  id: string;
  name: string;
}

interface DevProcessPanelProps {
  workspace: string;
}

export default function DevProcessPanel({ workspace }: DevProcessPanelProps) {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = useCallback(
    (base: string, extra?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (workspace) params.set("workspace", workspace);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) params.set(k, v);
      }
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    },
    [workspace]
  );

  useEffect(() => {
    async function fetchModules() {
      try {
        const res = await fetch(apiUrl("/api/modules"));
        if (res.ok) {
          const data = await res.json();
          const mods: ModuleInfo[] = (data.modules || []).map((m: { id: string; name: string }) => ({
            id: m.id,
            name: m.name,
          }));
          setModules(mods);
          if (mods.length > 0 && selectedModule === null) {
            setSelectedModule(mods[0].id);
          }
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchModules();
  }, [apiUrl, selectedModule]);

  const fetchTimeline = useCallback(async (mid: string) => {
    setContentLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/timeline", { mid }));
      if (res.ok) {
        const text = await res.text();
        setContent(text);
      } else {
        setError("Failed to load progress");
        setContent("");
      }
    } catch {
      setError("Failed to fetch timeline");
      setContent("");
    } finally {
      setContentLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    if (selectedModule !== null) {
      fetchTimeline(selectedModule);
    }
  }, [selectedModule, fetchTimeline]);

  const selectedModuleLabel = modules.find((m) => m.id === selectedModule)?.name || "";

  if (loading) {
    return (
      <div className="devprocess-panel" data-slot="devprocess-panel" data-testid="devprocess-panel">
        <div className="panel-loading">Loading...</div>
      </div>
    );
  }

  if (modules.length === 0) {
    return (
      <div className="devprocess-panel" data-slot="devprocess-panel" data-testid="devprocess-panel">
        <div className="panel-empty">
          <p className="panel-empty-text">No modules yet.</p>
          <p className="panel-empty-hint">Progress logs will appear here after development starts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="devprocess-panel" data-slot="devprocess-panel" data-testid="devprocess-panel">
      {/* Title bar */}
      <div className="devprocess-header" data-testid="devprocess-header">
        <h3 className="devprocess-title">
          {selectedModuleLabel ? `${selectedModuleLabel} 工作过程` : "开发过程"}
        </h3>
        <span className="devprocess-file-hint">
          {selectedModule ? `${selectedModule}_progress.txt` : ""}
        </span>
      </div>

      {/* Module selector */}
      <div className="devprocess-selector" data-testid="devprocess-selector">
        {modules.map((mod) => (
          <button
            key={mod.id}
            className={cn("devprocess-tab", selectedModule === mod.id && "active")}
            onClick={() => setSelectedModule(mod.id)}
          >
            {mod.name}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="devprocess-content" data-testid="devprocess-content">
        {contentLoading ? (
          <div className="panel-loading">Loading progress...</div>
        ) : error ? (
          <div className="devprocess-error" data-testid="timeline-error">
            <p>{error}</p>
            <button className="devprocess-retry" onClick={() => selectedModule !== null && fetchTimeline(selectedModule)}>
              Try again
            </button>
          </div>
        ) : content ? (
          <div data-testid="timeline-content">
            <pre className="devprocess-pre">{content}</pre>
          </div>
        ) : (
          <div className="panel-empty-text">No progress log yet for this module.</div>
        )}
      </div>
    </div>
  );
}
