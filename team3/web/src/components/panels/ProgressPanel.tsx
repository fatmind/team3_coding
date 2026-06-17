"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";

interface ModuleFeature {
  id: number;
  description: string;
  status: string;
}

interface ModuleInfo {
  id: string;
  name: string;
  status: string;
  features: ModuleFeature[];
}

interface ModulesData {
  modules: ModuleInfo[];
  dependencies: { from: string; to: string }[];
}

interface FeatureDetail {
  id: number;
  description: string;
  checkpoint: string[];
  passes: boolean;
}

interface ProgressPanelProps {
  workspace: string;
}

export default function ProgressPanel({ workspace }: ProgressPanelProps) {
  const [modulesData, setModulesData] = useState<ModulesData | null>(null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureDetail[]>([]);
  const [expandedFeature, setExpandedFeature] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [featuresLoading, setFeaturesLoading] = useState(false);

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

  const fetchModules = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/modules"));
      if (res.ok) {
        const data: ModulesData = await res.json();
        setModulesData(data);
        if (data.modules.length > 0) {
          setSelectedModule((prev) => prev || data.modules[0].id);
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  const fetchFeatures = useCallback(async (mid: string) => {
    setFeaturesLoading(true);
    try {
      const res = await fetch(apiUrl("/api/modules", { mid }));
      if (res.ok) {
        const data: FeatureDetail[] = await res.json();
        setFeatures(data);
        setFeaturesLoading(false);
        return;
      }
    } catch {
      // fall through to inline fallback
    }
    if (modulesData) {
      const mod = modulesData.modules.find((m) => m.id === mid);
      if (mod && mod.features.length > 0) {
        setFeatures(mod.features.map((f) => ({
          id: f.id,
          description: f.description,
          checkpoint: [],
          passes: f.status === "done",
        })));
        setFeaturesLoading(false);
        return;
      }
    }
    setFeatures([]);
    setFeaturesLoading(false);
  }, [apiUrl, modulesData]);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  useEffect(() => {
    if (selectedModule) {
      fetchFeatures(selectedModule);
    }
  }, [selectedModule, fetchFeatures]);

  function getProgress(mod: ModuleInfo): { done: number; total: number } {
    const done = mod.features.filter((f) => f.status === "done").length;
    return { done, total: mod.features.length };
  }

  function getStatusClass(status: string): string {
    switch (status) {
      case "done": return "status-done";
      case "in_progress": return "status-progress";
      default: return "status-pending";
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case "done": return "Done";
      case "in_progress": return "In Progress";
      default: return "Pending";
    }
  }

  if (loading) {
    return (
      <div className="progress-panel" data-slot="progress-panel" data-testid="progress-panel">
        <div className="panel-loading">Loading modules...</div>
      </div>
    );
  }

  if (!modulesData || modulesData.modules.length === 0) {
    return (
      <div className="progress-panel" data-slot="progress-panel" data-testid="progress-panel">
        <div className="panel-empty">
          <p className="panel-empty-text">No modules defined yet.</p>
          <p className="panel-empty-hint">Modules will appear here after Arch creates them.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="progress-panel" data-slot="progress-panel" data-testid="progress-panel">
      {/* Module cards */}
      <div className="progress-modules" data-testid="progress-modules">
        {modulesData.modules.map((mod) => {
          const progress = getProgress(mod);
          const isSelected = selectedModule === mod.id;
          const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
          return (
            <div
              key={mod.id}
              className={cn("progress-module-card", isSelected && "selected module-card-selected")}
              onClick={() => setSelectedModule(mod.id)}
              data-testid={`module-card-${mod.id}`}
            >
              <div className="progress-module-header">
                <span className="progress-module-name">{mod.name}</span>
                <span className={cn("progress-status-badge", getStatusClass(mod.status))}>
                  {getStatusLabel(mod.status)}
                </span>
              </div>
              <div className="progress-module-bar-row">
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="progress-module-count">{progress.done}/{progress.total} features</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature list */}
      {selectedModule && (
        <div className="progress-features" data-testid="features-section">
          <h3 className="progress-features-title">
            Features — {modulesData.modules.find((m) => m.id === selectedModule)?.name || selectedModule}
          </h3>
          {featuresLoading ? (
            <div className="panel-loading">Loading features...</div>
          ) : features.length === 0 ? (
            <div className="panel-empty-text">No features yet.</div>
          ) : (
            <div className="progress-feature-list">
              {features.map((feature) => (
                <div key={feature.id} className="progress-feature-item" data-testid={`feature-${feature.id}`}>
                  <div
                    className="progress-feature-row"
                    onClick={() => setExpandedFeature(expandedFeature === feature.id ? null : feature.id)}
                  >
                    <span className="progress-feature-id">#{feature.id}</span>
                    <span className="progress-feature-desc">{feature.description}</span>
                    <span className={cn("progress-feature-badge", feature.passes ? "badge-pass" : "badge-pending")}>
                      {feature.passes ? "✓ Passed" : "○ Pending"}
                    </span>
                    <span className="progress-feature-expand">
                      {expandedFeature === feature.id ? "▾" : "▸"}
                    </span>
                  </div>
                  {expandedFeature === feature.id && feature.checkpoint && feature.checkpoint.length > 0 && (
                    <div className="progress-checkpoint-list" data-testid={`checkpoint-${feature.id}`}>
                      {feature.checkpoint.map((cp, idx) => (
                        <div key={idx} className="progress-checkpoint-item">
                          <span className="progress-checkpoint-icon">{feature.passes ? "✓" : "○"}</span>
                          <span className="progress-checkpoint-text">{cp}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
