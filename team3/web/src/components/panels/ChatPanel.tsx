"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useDaemonSocket, type DaemonStatus, type ParsedMessage } from "@/lib/useDaemonSocket";

interface ChatMessage {
  action: string;
  from: string;
  to: string;
  ts: number | string;
  message?: string;
  body?: string;
}

interface AgentConfig {
  key: string;
  name: string;
  avatar: string;
  role: string;
}

interface RoleInfo {
  name: string;
  role: string;
  isHuman: boolean;
  initial: string;
  avatar: string;
  colorClass: string;
}

const DEFAULT_ROLES: Record<string, RoleInfo> = {
  human: { name: "Human", role: "Human", isHuman: true, initial: "H", avatar: "", colorClass: "avatar-green" },
  arch: { name: "arch_1", role: "Architect", isHuman: false, initial: "A", avatar: "", colorClass: "avatar-green" },
  dev: { name: "dev_2", role: "Dev", isHuman: false, initial: "D", avatar: "", colorClass: "avatar-blue" },
  uat: { name: "uat_1", role: "UAT", isHuman: false, initial: "U", avatar: "", colorClass: "avatar-orange" },
};

const ROLE_COLORS: Record<string, string> = {
  arch: "avatar-green",
  dev: "avatar-blue",
  uat: "avatar-orange",
  human: "avatar-green",
};

// Same format as api/chat/send — whole message wrapped in [rebase: ...]
const REBASE_MSG_RE = /^\[rebase:\s*([\s\S]+?)\s*\]$/;

interface ChatPanelProps {
  workspace: string;
}

export default function ChatPanel({ workspace }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus>("disconnected");
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [humanConfig, setHumanConfig] = useState<{ name: string; avatar: string }>({ name: "", avatar: "" });
  const [resolvedPort, setResolvedPort] = useState<number | null>(null);
  const [daemonRunning, setDaemonRunning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const wsUrl = resolvedPort ? `ws://127.0.0.1:${resolvedPort}` : null;

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
    async function fetchProjectStatus() {
      try {
        const params = new URLSearchParams({ workspace });
        const res = await fetch(`/api/project/status?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setAgentConfigs(data.agents || []);
          setHumanConfig(data.human || { name: "", avatar: "" });
          if (data.daemon?.port) setResolvedPort(data.daemon.port);
          if (data.daemon?.running) setDaemonRunning(true);
        }
      } catch {
        // use defaults
      }
    }
    fetchProjectStatus();
  }, [workspace]);

  function getMsgText(msg: ChatMessage): string {
    return msg.message || msg.body || "";
  }

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/chat/history"));
      if (res.ok) {
        const data: ChatMessage[] = await res.json();
        setMessages(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  const handleAgentMessage = useCallback((msg: ParsedMessage) => {
    setMessages((prev) => {
      const isDuplicate = prev.some(
        (existing) => existing.ts === msg.ts && existing.from === msg.from && existing.message === msg.message
      );
      if (isDuplicate) return prev;
      return [...prev, msg as ChatMessage];
    });
  }, []);

  const handleReconnect = useCallback(() => {
    fetchHistory();
  }, [fetchHistory]);

  useDaemonSocket({
    url: wsUrl || "ws://127.0.0.1:3100",
    autoConnect: !!wsUrl,
    onAgentMessage: handleAgentMessage,
    onStatusChange: setDaemonStatus,
    onReconnect: handleReconnect,
  });

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build mention targets from agent configs
  const mentionTargets = agentConfigs.length > 0
    ? agentConfigs.map((a) => ({ key: a.key, name: a.name || a.key, avatar: a.avatar }))
    : [
        { key: "arch_agent", name: "arch_1", avatar: "" },
        { key: "dev_agent", name: "dev_2", avatar: "" },
        { key: "uat_agent", name: "uat_1", avatar: "" },
      ];

  function insertMention(name: string) {
    setInputText((prev) => {
      const prefix = prev.endsWith(" ") || prev === "" ? "" : " ";
      return `${prev}${prefix}@${name} `;
    });
    setShowMentionDropdown(false);
    inputRef.current?.focus();
  }

  function selectMentionFromDropdown(name: string) {
    setInputText((prev) => {
      const atIdx = prev.lastIndexOf("@");
      if (atIdx === -1) return `${prev}@${name} `;
      return `${prev.slice(0, atIdx)}@${name} `;
    });
    setShowMentionDropdown(false);
    inputRef.current?.focus();
  }

  function handleInputChange(value: string) {
    setInputText(value);
    const atIdx = value.lastIndexOf("@");
    if (atIdx !== -1) {
      const beforeAt = value.slice(0, atIdx);
      const isStartOrAfterSpace = atIdx === 0 || beforeAt.endsWith(" ");
      if (isStartOrAfterSpace) {
        const query = value.slice(atIdx + 1);
        if (!query.includes(" ")) {
          setMentionFilter(query.toLowerCase());
          setShowMentionDropdown(true);
          return;
        }
      }
    }
    setShowMentionDropdown(false);
  }

  const filteredMentions = mentionTargets.filter((t) =>
    t.name.toLowerCase().includes(mentionFilter) || t.key.toLowerCase().includes(mentionFilter)
  );

  // Map agent key (arch_agent) to short form (arch) for API
  function agentKeyToShort(key: string): string {
    return key.replace(/_agent$/, "");
  }

  function parseTarget(text: string): { cleanText: string; parsedTarget: string } {
    // Try matching by configured agent names first
    for (const agent of mentionTargets) {
      const pattern = new RegExp(`^@${agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, "i");
      const match = text.match(pattern);
      if (match) {
        return { cleanText: text.slice(match[0].length), parsedTarget: agentKeyToShort(agent.key) };
      }
    }
    // Fallback to short names
    const mentionMatch = text.match(/^@(arch|dev|uat)\s+/i);
    if (mentionMatch) {
      return { cleanText: text.slice(mentionMatch[0].length), parsedTarget: mentionMatch[1].toLowerCase() };
    }
    return { cleanText: text, parsedTarget: "arch" };
  }

  async function handleSend() {
    if (!inputText.trim() || sending) return;

    const { cleanText, parsedTarget } = parseTarget(inputText);
    const messageText = cleanText.trim() || inputText.trim();

    // Human chat is a pure-message channel: to_arch / to_dev / to_uat all
    // reuse the agent's current session. Task dispatch (dev_do / uat_design /
    // uat_check) is arch's job — humans talk, arch schedules.
    const action = `to_${parsedTarget}`;

    // Rebase special format: optimistic echo mirrors what the server will
    // actually write (action=rebase, wrapper stripped) — no @, badge instead
    const rebaseMatch = messageText.match(REBASE_MSG_RE);

    const localMessage: ChatMessage = {
      action: rebaseMatch ? "rebase" : action,
      from: "human",
      to: rebaseMatch ? "T3" : parsedTarget,
      ts: Math.floor(Date.now() / 1000),
      message: rebaseMatch ? rebaseMatch[1] : messageText,
    };
    setMessages((prev) => [...prev, localMessage]);
    setInputText("");

    setSending(true);
    try {
      const res = await fetch(apiUrl("/api/chat/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          to: parsedTarget,
          message: messageText,
        }),
      });
      if (!res.ok) {
        console.error("[ChatPanel] Failed to send message:", await res.text());
      }
    } catch {
      // optimistic update already shown
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  }

  function getRoleInfo(from: string): RoleInfo {
    // Daemon system messages: display as T3 with its own accent color
    // ("daemon" kept for older actions.jsonl written before the rename)
    if (from === "T3" || from === "daemon") {
      return { name: "T3", role: "System", isHuman: false, initial: "T", avatar: "", colorClass: "avatar-purple" };
    }
    // Check if it's human
    if (from === "human" || from === "fatmind") {
      return {
        name: humanConfig.name || "Human",
        role: "Human",
        isHuman: true,
        initial: (humanConfig.name || "H").charAt(0).toUpperCase(),
        avatar: humanConfig.avatar,
        colorClass: "avatar-green",
      };
    }
    // Check agent configs
    const shortForm = from.replace(/_agent$/, "");
    const agentKey = from.endsWith("_agent") ? from : `${shortForm}_agent`;
    const config = agentConfigs.find((a) => a.key === agentKey);
    if (config) {
      return {
        name: config.name || from,
        role: config.role,
        isHuman: false,
        initial: (config.name || from).charAt(0).toUpperCase(),
        avatar: config.avatar,
        colorClass: ROLE_COLORS[shortForm] || "avatar-gray",
      };
    }
    // Fallback
    if (DEFAULT_ROLES[from]) return DEFAULT_ROLES[from];
    if (from.startsWith("arch")) return { ...DEFAULT_ROLES.arch, name: from };
    if (from.startsWith("dev")) return { ...DEFAULT_ROLES.dev, name: from };
    if (from.startsWith("uat")) return { ...DEFAULT_ROLES.uat, name: from };
    return { name: from, role: from, isHuman: false, initial: from.charAt(0).toUpperCase(), avatar: "", colorClass: "avatar-gray" };
  }

  // Build lookup for @mention → display name conversion
  function getDisplayNameForTarget(to: string): string {
    const agentKey = to.endsWith("_agent") ? to : `${to}_agent`;
    const config = agentConfigs.find((a) => a.key === agentKey);
    if (config?.name) return config.name;
    return to;
  }

  function formatTime(ts: number | string): string {
    const date = typeof ts === "string" ? new Date(ts) : new Date(ts * 1000);
    if (isNaN(date.getTime())) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${minutes}`;
  }

  // Agent sometimes writes a long message as one paragraph with zero newlines,
  // which renders as an unreadable wall of text. If so, insert line breaks
  // before structural markers (①②③…, mid-text 【…】, [reread: …]).
  function autoBreak(text: string): string {
    if (text.includes("\n") || text.length < 120) return text;
    return text
      .replace(/(?<=.)(?=[①②③④⑤⑥⑦⑧⑨⑩])/g, "\n")
      .replace(/(?<=.)(?=【)/g, "\n")
      .replace(/\s*(?=\[reread:)/g, "\n");
  }

  function renderMessageText(text: string | undefined | null, msg: ChatMessage) {
    if (!text) return null;
    const parts: React.ReactNode[] = [];
    // Rebase messages: no @ prefix — dedicated badge instead
    const rebaseMatch = text.trim().match(REBASE_MSG_RE);
    const isRebase = msg.action === "rebase" || !!rebaseMatch;
    const bodyText = autoBreak(rebaseMatch ? rebaseMatch[1] : text);
    if (isRebase) {
      parts.push(<span key="rebase-badge" className="chat-rebase-badge">⟲ rebase</span>);
      parts.push(<span key="rebase-space"> </span>);
    } else if (msg.to && msg.to !== msg.from && msg.to !== "human") {
      // Show "to" as @name prefix if different from "from"
      const displayName = getDisplayNameForTarget(msg.to);
      parts.push(<span key="to-mention" className="chat-mention">@{displayName}</span>);
      parts.push(<span key="to-space"> </span>);
    }
    // Parse inline @mentions
    const textParts = bodyText.split(/(@\w+)/g);
    textParts.forEach((part, i) => {
      if (part.startsWith("@")) {
        parts.push(<span key={`t-${i}`} className="chat-mention">{part}</span>);
      } else {
        parts.push(<span key={`t-${i}`}>{part}</span>);
      }
    });
    return parts;
  }

  if (loading) {
    return (
      <div className="chat-panel" data-slot="chat-panel" data-testid="chat-panel">
        <div className="chat-skeleton">
          <div className="chat-skeleton-bubble" />
          <div className="chat-skeleton-bubble short" />
          <div className="chat-skeleton-bubble" />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel" data-slot="chat-panel" data-testid="chat-panel">
      {daemonStatus !== "connected" && !daemonRunning && (
        <div className="chat-offline-banner" data-testid="chat-offline-banner">
          <span className="chat-offline-dot" />
          <span>Daemon offline</span>
          <span className="chat-offline-hint">Go to Agents panel to start</span>
        </div>
      )}

      <div className="chat-messages" ref={listRef} data-testid="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">&#128172;</div>
            <p className="chat-empty-text">No messages yet. Start a conversation with your agents!</p>
            <p className="chat-empty-hint">Click a mention chip below to direct your message</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const role = getRoleInfo(msg.from);
          return (
            <div
              key={`${msg.ts}-${i}`}
              className="chat-msg-row"
              data-testid={`chat-msg-${i}`}
            >
              <div className={cn("chat-avatar", role.colorClass)} data-testid="chat-avatar">
                {role.initial}
              </div>
              <div className="chat-msg-body">
                <div className="chat-msg-header">
                  <span className="chat-msg-name">{role.name}</span>
                  <span className="chat-msg-role">{role.role}</span>
                  <span className="chat-msg-time">{formatTime(msg.ts)}</span>
                </div>
                <div className="chat-msg-text">{renderMessageText(getMsgText(msg), msg)}</div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area" data-testid="chat-input-area">
        <div className="chat-mention-chips">
          <span className="chat-mention-label">提及</span>
          {mentionTargets.map((t) => (
            <button
              key={t.key}
              className="chat-mention-chip"
              onClick={() => insertMention(t.name)}
              data-testid={`mention-${t.key}`}
            >
              @{t.name}
            </button>
          ))}
        </div>
        <div className="chat-input-wrapper">
          {showMentionDropdown && filteredMentions.length > 0 && (
            <div className="chat-mention-dropdown" data-testid="mention-dropdown">
              {filteredMentions.map((t) => (
                <button
                  key={t.key}
                  className="chat-mention-dropdown-item"
                  onMouseDown={(e) => { e.preventDefault(); selectMentionFromDropdown(t.name); }}
                >
                  <span className={cn("chat-mention-dropdown-dot", ROLE_COLORS[agentKeyToShort(t.key)] || "avatar-gray")} />
                  <span className="chat-mention-dropdown-name">{t.name}</span>
                  <span className="chat-mention-dropdown-role">{t.key.replace(/_agent$/, "")}</span>
                </button>
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="输入消息, @ 提及 agent..."
              value={inputText}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowMentionDropdown(false), 150)}
              data-testid="chat-input"
              rows={3}
            />
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={!inputText.trim() || sending}
              data-testid="chat-send-btn"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
