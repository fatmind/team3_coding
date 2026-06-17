"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Daemon WebSocket connection states */
export type DaemonStatus = "connecting" | "connected" | "disconnected";

/** Incoming agent message event from daemon */
export interface AgentMsgEvent {
  type: "agent.msg";
  payload: string; // raw JSONL line
}

/** Parsed message from payload */
export interface ParsedMessage {
  action: string;
  from: string;
  to: string;
  ts: number;
  message: string;
}

/** Agent log line from stream-json parsing */
export interface AgentLogLine {
  content: string;
  tone?: "success" | "mention" | "route";
  time?: string;
}

/** Agent log event from daemon WS */
export interface AgentLogEvent {
  type: "agent.log";
  role: "arch" | "dev" | "uat";
  lines: AgentLogLine[];
}

interface UseDaemonSocketOptions {
  /** WebSocket URL (default ws://127.0.0.1:3100) */
  url?: string;
  /** Whether to auto-connect on mount (default true) */
  autoConnect?: boolean;
  /** Callback when an agent message arrives */
  onAgentMessage?: (msg: ParsedMessage) => void;
  /** Callback when an agent.log event arrives (stream-json parsed output) */
  onAgentLog?: (event: AgentLogEvent) => void;
  /** Callback when connection state changes */
  onStatusChange?: (status: DaemonStatus) => void;
  /** Callback triggered on reconnect (to refetch full history) */
  onReconnect?: () => void;
}

/**
 * useDaemonSocket - React hook for managing WebSocket connection to daemon.
 *
 * Features:
 * - Auto-connect on mount
 * - Exponential backoff reconnection (1s → 2s → 4s → 8s → max 30s)
 * - Parses agent.msg events and delivers them via callback
 * - On reconnect, triggers onReconnect for full history refresh
 * - Exposes connection status for UI indicator
 */
export function useDaemonSocket(options: UseDaemonSocketOptions = {}) {
  const {
    url = "ws://127.0.0.1:3100",
    autoConnect = true,
    onAgentMessage,
    onAgentLog,
    onStatusChange,
    onReconnect,
  } = options;

  const [status, setStatus] = useState<DaemonStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000); // Start at 1s
  const hasConnectedOnceRef = useRef(false);
  const mountedRef = useRef(true);

  // Store callbacks in refs so we don't re-trigger effects
  const onAgentMessageRef = useRef(onAgentMessage);
  const onAgentLogRef = useRef(onAgentLog);
  const onStatusChangeRef = useRef(onStatusChange);
  const onReconnectRef = useRef(onReconnect);

  useEffect(() => {
    onAgentMessageRef.current = onAgentMessage;
  }, [onAgentMessage]);
  useEffect(() => {
    onAgentLogRef.current = onAgentLog;
  }, [onAgentLog]);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);
  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  const updateStatus = useCallback((newStatus: DaemonStatus) => {
    if (!mountedRef.current) return;
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  const connect = useCallback(() => {
    // Don't connect if already open or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    updateStatus("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        updateStatus("connected");
        backoffRef.current = 1000; // Reset backoff on successful connect

        // If this is a reconnection (not first connect), trigger refetch
        if (hasConnectedOnceRef.current) {
          onReconnectRef.current?.();
        }
        hasConnectedOnceRef.current = true;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "agent.msg" && data.payload) {
            // payload may be a JSON string (from daemon rawLine) or already an object
            const parsed: ParsedMessage =
              typeof data.payload === "string"
                ? JSON.parse(data.payload)
                : data.payload;
            onAgentMessageRef.current?.(parsed);
          } else if (data.type === "agent.log" && data.role && Array.isArray(data.lines)) {
            // Feature #9: Agent stream-json parsed log lines
            onAgentLogRef.current?.(data as AgentLogEvent);
          }
          // Ignore other message types (connected, pong, ack, etc.)
        } catch (err) {
          console.error("[useDaemonSocket] Failed to parse WS message:", err, "raw:", event.data);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        wsRef.current = null;
        updateStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after this, so just close the socket
        ws.close();
      };
    } catch (err) {
      console.error("[useDaemonSocket] WebSocket connection error:", err);
      updateStatus("disconnected");
      scheduleReconnect();
    }
  }, [url, updateStatus]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current) return; // Already scheduled

    const delay = backoffRef.current;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (mountedRef.current) {
        connect();
      }
    }, delay);

    // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (max)
    backoffRef.current = Math.min(backoffRef.current * 2, 30000);
  }, [connect]);

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;
    if (autoConnect) {
      connect();
    }
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [autoConnect, connect]);

  return { status, connect };
}
