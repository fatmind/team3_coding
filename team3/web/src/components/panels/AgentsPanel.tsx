"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { useDaemonSocket, type AgentLogEvent } from "@/lib/useDaemonSocket";
import type { LogLine } from "@/lib/stdout-parser";

interface DaemonInfo {
  running: boolean;
  pid?: number | null;
  port?: number | null;
  lastHeartbeat?: string | null;
}

interface AgentInfo {
  key: string;
  name: string;
  avatar: string;
  role: string;
  session?: string;
  status: "active" | "idle";
}

interface AgentsPanelProps {
  workspace: string;
}

type AgentKey = "arch_agent" | "dev_agent" | "uat_agent";
type AgentRole = "arch" | "dev" | "uat";

interface AgentView {
  key: AgentKey;
  role: AgentRole;
  label: string;
  roleName: string;
  fallbackName: string;
  fallbackAvatar: string;
  data?: AgentInfo;
}

interface DisplayLogLine extends LogLine {
  id: number;
  time: string;
}

const AGENT_VIEWS: AgentView[] = [
  {
    key: "arch_agent",
    role: "arch",
    label: "ARCH",
    roleName: "Architecture Agent",
    fallbackName: "张三丰",
    fallbackAvatar: "张",
  },
  {
    key: "dev_agent",
    role: "dev",
    label: "DEV",
    roleName: "Development Agent",
    fallbackName: "多隆",
    fallbackAvatar: "多",
  },
  {
    key: "uat_agent",
    role: "uat",
    label: "UAT",
    roleName: "UAT Agent",
    fallbackName: "白帽",
    fallbackAvatar: "白",
  },
];

const LOG_BUFFER_SIZE = 80;

function roleToKey(role: AgentRole): AgentKey {
  return `${role}_agent` as AgentKey;
}

function keyToRole(key: AgentKey): AgentRole {
  return key.replace("_agent", "") as AgentRole;
}

function formatTime(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export default function AgentsPanel({ workspace }: AgentsPanelProps) {
  const [daemon, setDaemon] = useState<DaemonInfo | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [humanInfo, setHumanInfo] = useState<{ name: string; avatar: string }>({ name: "", avatar: "" });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>("arch_agent");

  // Per-agent log buffers (real data, no mocks)
  const [logBuffers, setLogBuffers] = useState<Record<AgentKey, DisplayLogLine[]>>({
    arch_agent: [],
    dev_agent: [],
    uat_agent: [],
  });
  const logIdRef = useRef(0);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  // Active buffer for the selected agent
  const activeLogs = logBuffers[selectedAgent];

  const fetchStatus = useCallback(async () => {
    try {
      const params = new URLSearchParams({ workspace });
      const res = await fetch(`/api/project/status?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDaemon(data.daemon || { running: false });
        setAgents(data.agents || []);
        setHumanInfo(data.human || { name: "", avatar: "" });
        setError(null);
      } else {
        setDaemon({ running: false });
        setAgents([]);
      }
    } catch {
      setDaemon({ running: false });
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  // Fetch initial log buffer from API for all 3 agents
  const fetchInitialLogs = useCallback(async () => {
    const roles: AgentRole[] = ["arch", "dev", "uat"];
    for (const role of roles) {
      try {
        const params = new URLSearchParams({ workspace, role, limit: "50" });
        const res = await fetch(`/api/project/agent-logs?${params.toString()}`);
        if (res.ok) {
          const lines: LogLine[] = await res.json();
          if (lines.length > 0) {
            const displayLines: DisplayLogLine[] = lines.map((line) => {
              logIdRef.current += 1;
              return { ...line, id: logIdRef.current, time: line.time || "—" };
            });
            setLogBuffers((prev) => ({
              ...prev,
              [roleToKey(role)]: displayLines.slice(-LOG_BUFFER_SIZE),
            }));
          }
        }
      } catch {
        // Silently skip — API may not be available yet
      }
    }
  }, [workspace]);

  // Handle WS agent.log events
  const handleAgentLog = useCallback((event: AgentLogEvent) => {
    const agentKey = roleToKey(event.role);
    const newLines: DisplayLogLine[] = event.lines.map((line) => {
      logIdRef.current += 1;
      return { ...line, id: logIdRef.current, time: line.time || formatTime() };
    });

    setLogBuffers((prev) => {
      const current = prev[agentKey] || [];
      const merged = [...current, ...newLines];
      return {
        ...prev,
        [agentKey]: merged.slice(-LOG_BUFFER_SIZE),
      };
    });
  }, []);

  // Connect to daemon WS for real-time log events
  const wsUrl = daemon?.running && daemon.port ? `ws://127.0.0.1:${daemon.port}` : undefined;
  useDaemonSocket({
    url: wsUrl,
    autoConnect: !!wsUrl,
    onAgentLog: handleAgentLog,
  });

  // Fetch status on mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStatus]);

  // Fetch initial logs after status loaded (once daemon info is available)
  useEffect(() => {
    if (!loading) {
      fetchInitialLogs();
    }
  }, [loading, fetchInitialLogs]);

  // Auto-scroll log console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [activeLogs]);

  const orderedAgents = useMemo(
    () =>
      AGENT_VIEWS.map((view) => ({
        ...view,
        data: agents.find((agent) => agent.key === view.key),
      })),
    [agents]
  );

  const selectedAgentLabel =
    orderedAgents.find((agentView) => agentView.key === selectedAgent)?.label || "AGENT";

  async function handleStartDaemon() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/project/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace }),
      });
      if (res.ok) {
        setTimeout(fetchStatus, 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to start daemon");
      }
    } catch {
      setError("Failed to connect to server");
    } finally {
      setStarting(false);
    }
  }

  function startEditing(agentKey: string, currentName: string, currentAvatar: string) {
    setEditingAgent(agentKey);
    setEditName(currentName);
    setEditAvatar(currentAvatar);
  }

  function selectAgent(agentKey: AgentKey) {
    if (agentKey === selectedAgent) return;
    setSelectedAgent(agentKey);
  }

  function handleAgentKeyDown(event: KeyboardEvent<HTMLDivElement>, agentKey: AgentKey) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectAgent(agentKey);
  }

  async function saveAgent(agentKey: string) {
    try {
      const res = await fetch("/api/project/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, agentKey, name: editName, avatar: editAvatar }),
      });
      if (res.ok) {
        setEditingAgent(null);
        fetchStatus();
      }
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <div className="agents-panel" data-slot="agents-panel" data-testid="agents-panel">
        <div className="agents-loading-grid" data-slot="agents-loading">
          <div className="agents-skeleton-card" />
          <div className="agents-skeleton-card" />
          <div className="agents-skeleton-card wide" />
        </div>
      </div>
    );
  }

  return (
    <div className="agents-panel" data-slot="agents-panel" data-testid="agents-panel">
      <section className="agents-overview" data-slot="agents-overview">
        <div className="agents-system-card" data-slot="agents-daemon-card" data-testid="daemon-card">
          <div className="agents-card-topline">
            <span className="agents-system-icon" aria-hidden="true">
              ▦
            </span>
            <div>
              <div className="agents-card-title-row">
                <h3 className="agents-card-title">Daemon</h3>
                <span className={cn("agents-pill", daemon?.running ? "running" : "idle")}>
                  {daemon?.running ? "Running" : "Offline"}
                </span>
              </div>
              <p className="agents-card-subtitle">
                PID {daemon?.running && daemon.pid ? daemon.pid : "-"}
                <span>port {daemon?.port || "-"}</span>
                <span>heartbeat {formatHeartbeatBrief(daemon?.lastHeartbeat)}</span>
              </p>
            </div>
          </div>

          {!daemon?.running && (
            <div className="agents-card-action">
              <button
                className="agents-start-btn"
                onClick={handleStartDaemon}
                disabled={starting}
                data-testid="start-daemon-btn"
              >
                {starting ? "Starting..." : "启动 Daemon"}
              </button>
            </div>
          )}

          {error && (
            <div className="agents-error" data-testid="daemon-error">
              <span>{error}</span>
              <button className="agents-retry-btn" onClick={handleStartDaemon}>
                Retry
              </button>
            </div>
          )}
        </div>

        <div className="agents-system-card human" data-slot="agents-human-card">
          {editingAgent === "human" ? (
            <AgentEditForm
              editAvatar={editAvatar}
              editName={editName}
              onAvatarChange={setEditAvatar}
              onNameChange={setEditName}
              onCancel={() => setEditingAgent(null)}
              onSave={() => saveAgent("human")}
            />
          ) : (
            <>
              <div className="agents-card-topline">
                <span className="agents-avatar human" aria-hidden="true">
                  {humanInfo.avatar || "人"}
                </span>
                <div>
                  <div className="agents-card-title-row">
                    <h3 className="agents-card-title">{humanInfo.name || "Human"}</h3>
                    <span className="agents-role-label">Human · Partner</span>
                    <span className="agents-pill running">Online</span>
                    <button
                      className="agents-edit-btn"
                      onClick={() => startEditing("human", humanInfo.name, humanInfo.avatar)}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="agents-grid" data-slot="agents-grid" data-testid="agents-list">
        {orderedAgents.map((agentView) => {
          const agent = agentView.data;
          const name = agent?.name || agentView.fallbackName;
          const avatar = agent?.avatar || agentView.fallbackAvatar;
          const session = agent?.session;
          const isActive = agent?.status === "active";

          return (
            <div
              key={agentView.key}
              className={cn("agents-agent-card", agentView.key, selectedAgent === agentView.key && "selected")}
              data-slot="agents-agent-card"
              data-testid={`agent-${agentView.key}`}
              role="button"
              tabIndex={0}
              aria-pressed={selectedAgent === agentView.key}
              onClick={() => {
                if (editingAgent !== agentView.key) {
                  selectAgent(agentView.key);
                }
              }}
              onKeyDown={(event) => {
                if (editingAgent !== agentView.key) {
                  handleAgentKeyDown(event, agentView.key);
                }
              }}
            >
              {editingAgent === agentView.key ? (
                <AgentEditForm
                  editAvatar={editAvatar}
                  editName={editName}
                  onAvatarChange={setEditAvatar}
                  onNameChange={setEditName}
                  onCancel={() => setEditingAgent(null)}
                  onSave={() => saveAgent(agentView.key)}
                />
              ) : (
                <>
                  <div className="agents-agent-topline">
                    <div className="agents-agent-identity">
                      <span className="agents-avatar" aria-hidden="true">
                        {avatar}
                      </span>
                      <div>
                        <div className="agents-agent-label">{agentView.label}</div>
                        <h4 className="agents-agent-name">{name}</h4>
                      </div>
                    </div>
                    <div className="agents-inline-actions">
                      <span className={cn("agents-pill", isActive ? "running" : "idle")}>
                        {isActive ? "Running" : "Idle"}
                      </span>
                      <button
                        className="agents-edit-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditing(agentView.key, name, avatar);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>

                  <div className="agents-session-row">
                    <span>session</span>
                    <strong title={session || "-"}>{session ? `${session.slice(0, 24)}...` : "-"}</strong>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>

      <section className="agents-console" data-slot="agents-console">
        <div className="agents-console-header">
          <h3>{selectedAgentLabel} WORK LOG</h3>
        </div>

        <div className="agents-console-body" ref={consoleRef} aria-live="polite">
          {activeLogs.length === 0 ? (
            <div className="agents-log-empty">
              <span>No log entries yet. Agent activity will appear here in real time.</span>
            </div>
          ) : (
            activeLogs.map((line) => (
              <div key={line.id} className="agents-log-row">
                <span className="agents-log-time">{line.time}</span>
                <span className={cn("agents-log-content", line.tone)}>
                  {renderLogContent(line.content)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function renderLogContent(content: string) {
  const parts = content.split(/(spec\/[^\s，）]+|e2e\/[^\s，）]+)/g);

  return parts.map((part, index) => {
    if (/^(spec|e2e)\//.test(part)) {
      return (
        <span key={`${part}-${index}`} className="agents-log-path">
          {part}
        </span>
      );
    }

    return part;
  });
}

function formatHeartbeatBrief(ts: string | null | undefined) {
  if (!ts) return "-";

  const normalized = ts.replace(/(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})/, "$1 $2:$3:$4");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  return date.toLocaleTimeString("en-GB", { hour12: false });
}

interface AgentEditFormProps {
  editAvatar: string;
  editName: string;
  onAvatarChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

function AgentEditForm({
  editAvatar,
  editName,
  onAvatarChange,
  onNameChange,
  onCancel,
  onSave,
}: AgentEditFormProps) {
  return (
    <div className="agents-edit-form" data-slot="agents-edit-form">
      <div className="agents-edit-row">
        <label className="agents-edit-label">Icon</label>
        <input
          className="agents-edit-input agents-edit-icon-input"
          value={editAvatar}
          onChange={(event) => onAvatarChange(event.target.value)}
          placeholder="字"
        />
      </div>
      <div className="agents-edit-row">
        <label className="agents-edit-label">Name</label>
        <input
          className="agents-edit-input"
          value={editName}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="agent name"
        />
      </div>
      <div className="agents-edit-actions">
        <button className="agents-edit-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="agents-edit-save" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  );
}
