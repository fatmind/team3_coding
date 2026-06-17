"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { useDaemonSocket, type DaemonStatus, type ParsedMessage } from "@/lib/useDaemonSocket";

/** Message structure from actions.jsonl */
interface ChatMessage {
  action: string;
  from: string;
  to: string;
  ts: number;
  message: string;
}

/** Role display info */
interface RoleInfo {
  name: string;
  isHuman: boolean;
}

/** Map role keys to display names */
const DEFAULT_ROLES: Record<string, RoleInfo> = {
  human: { name: "Human", isHuman: true },
  arch: { name: "Architect", isHuman: false },
  dev: { name: "Dev", isHuman: false },
  uat: { name: "UAT", isHuman: false },
};

const SEND_TARGETS = ["arch", "dev", "uat"] as const;

interface ChatPanelProps {
  workspace?: string;
}

/**
 * ChatPanel - Group chat area for Page 1 (left 40%).
 * Displays message history, supports sending messages,
 * renders messages by role with appropriate styling.
 * Connects to daemon via WebSocket for real-time agent message push.
 */
export default function ChatPanel({ workspace }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [target, setTarget] = useState<string>("arch");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus>("disconnected");
  const [startingDaemon, setStartingDaemon] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build API URL with optional workspace param
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

  // Fetch chat history
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/chat/history"));
      if (res.ok) {
        const data: ChatMessage[] = await res.json();
        setMessages(data);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  // Handle incoming agent messages from daemon WebSocket
  const handleAgentMessage = useCallback((msg: ParsedMessage) => {
    setMessages((prev) => {
      // Deduplicate: skip if we already have this message (same ts + from + message)
      const isDuplicate = prev.some(
        (existing) => existing.ts === msg.ts && existing.from === msg.from && existing.message === msg.message
      );
      if (isDuplicate) return prev;
      return [...prev, msg as ChatMessage];
    });
  }, []);

  // Handle reconnection: refetch full history to catch up
  const handleReconnect = useCallback(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Start daemon via API
  const handleStartDaemon = useCallback(async () => {
    if (startingDaemon || !workspace) return;
    setStartingDaemon(true);
    try {
      const res = await fetch("/api/project/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("[ChatPanel] Failed to start daemon:", data.error);
      }
      // On success, useDaemonSocket auto-reconnects via backoff
    } catch (err) {
      console.error("[ChatPanel] Error starting daemon:", err);
    } finally {
      setStartingDaemon(false);
    }
  }, [workspace, startingDaemon]);

  // Connect to daemon WebSocket
  useDaemonSocket({
    onAgentMessage: handleAgentMessage,
    onStatusChange: setDaemonStatus,
    onReconnect: handleReconnect,
  });

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // Parse @mention from input to determine target
  function parseTarget(text: string): { cleanText: string; parsedTarget: string } {
    const mentionMatch = text.match(/^@(arch|dev|uat)\s+/i);
    if (mentionMatch) {
      return {
        cleanText: text.slice(mentionMatch[0].length),
        parsedTarget: mentionMatch[1].toLowerCase(),
      };
    }
    return { cleanText: text, parsedTarget: target };
  }

  // Send message
  async function handleSend() {
    if (!inputText.trim() || sending) return;

    const { cleanText, parsedTarget } = parseTarget(inputText);
    if (!cleanText.trim()) return;

    // Determine action based on target
    const actionMap: Record<string, string> = {
      arch: "to_arch",
      dev: "dev_do",
      uat: "uat_design",
    };
    const action = actionMap[parsedTarget] || `to_${parsedTarget}`;

    // Immediately add to local messages (optimistic update)
    const localMessage: ChatMessage = {
      action,
      from: "human",
      to: parsedTarget,
      ts: Math.floor(Date.now() / 1000),
      message: cleanText.trim(),
    };
    setMessages((prev) => [...prev, localMessage]);
    setInputText("");

    // Send to API
    setSending(true);
    try {
      await fetch(apiUrl("/api/chat/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          to: parsedTarget,
          message: cleanText.trim(),
        }),
      });
    } catch {
      // Message was already shown optimistically
    } finally {
      setSending(false);
    }
  }

  // Handle keyboard submit
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Get role info for a from field
  function getRoleInfo(from: string): RoleInfo {
    return DEFAULT_ROLES[from] || { name: from, isHuman: false };
  }

  // Format timestamp
  function formatTime(ts: number): string {
    const date = new Date(ts * 1000);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (loading) {
    return (
      <div className="chat-panel" data-slot="chat-panel" data-testid="chat-panel">
        <div className="chat-loading">Loading messages...</div>
      </div>
    );
  }

  return (
    <div className="chat-panel" data-slot="chat-panel" data-testid="chat-panel">
      {/* Connection Status Indicator + Navigation */}
      <div className="chat-status-bar" data-testid="chat-status-bar">
        <span
          className={cn("chat-status-dot", daemonStatus === "connected" ? "chat-status-online" : "chat-status-offline")}
          data-testid="chat-status-dot"
        />
        <span className="chat-status-text" data-testid="chat-status-text">
          {daemonStatus === "connected" ? "Daemon connected" : daemonStatus === "connecting" ? "Connecting..." : "Daemon offline"}
        </span>
        {daemonStatus !== "connected" && workspace && (
          <button
            className="chat-start-daemon-btn"
            onClick={handleStartDaemon}
            disabled={startingDaemon}
            data-testid="start-daemon-btn"
          >
            {startingDaemon ? "Starting..." : "启动 Daemon"}
          </button>
        )}
        <Link
          href={workspace ? `/modules?workspace=${encodeURIComponent(workspace)}` : "/modules"}
          className="chat-view-work-btn"
          data-testid="view-work-btn"
        >
          查看 Agent 工作
        </Link>
      </div>

      {/* Message List */}
      <div className="chat-messages" ref={listRef} data-testid="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">No messages yet. Start a conversation!</div>
        )}
        {messages.map((msg, i) => {
          const role = getRoleInfo(msg.from);
          const isHuman = role.isHuman;
          return (
            <div
              key={`${msg.ts}-${i}`}
              className={cn("chat-bubble-row", isHuman ? "chat-bubble-right" : "chat-bubble-left")}
              data-testid={`chat-msg-${i}`}
            >
              {!isHuman && (
                <div className="chat-avatar" data-testid="chat-avatar">
                  {role.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className={cn("chat-bubble", isHuman ? "chat-bubble-human" : "chat-bubble-agent")}>
                <div className="chat-bubble-header">
                  <span className="chat-bubble-name">{role.name}</span>
                  {!isHuman && <span className="chat-bubble-badge">AI</span>}
                  <span className="chat-bubble-time">{formatTime(msg.ts)}</span>
                </div>
                <div className="chat-bubble-text">{msg.message}</div>
              </div>
              {isHuman && (
                <div className="chat-avatar chat-avatar-human" data-testid="chat-avatar">
                  H
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-area" data-testid="chat-input-area">
        <div className="chat-target-selector">
          <span className="chat-target-label">To:</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="chat-target-select"
            data-testid="chat-target-select"
          >
            {SEND_TARGETS.map((t) => (
              <option key={t} value={t}>
                {DEFAULT_ROLES[t]?.name || t}
              </option>
            ))}
          </select>
        </div>
        <div className="chat-input-row">
          <input
            type="text"
            className="chat-input"
            placeholder={`Message @${target}... (or @dev/@uat to change target)`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="chat-input"
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
            data-testid="chat-send-btn"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
