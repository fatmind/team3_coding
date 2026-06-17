/**
 * Unit tests for useDaemonSocket hook.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  send(_data: string) {}

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  simulateError() {
    this.onerror?.({});
  }
}

// Set up global WebSocket mock
(global as any).WebSocket = MockWebSocket;

import { useDaemonSocket } from "@/lib/useDaemonSocket";

describe("useDaemonSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("connects to daemon on mount with default URL", () => {
    renderHook(() => useDaemonSocket());

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://127.0.0.1:3100");
  });

  it("reports 'connected' status when WebSocket opens", () => {
    const onStatusChange = vi.fn();
    renderHook(() => useDaemonSocket({ onStatusChange }));

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateOpen();
    });

    expect(onStatusChange).toHaveBeenCalledWith("connected");
  });

  it("reports 'disconnected' status when WebSocket closes", () => {
    const onStatusChange = vi.fn();
    renderHook(() => useDaemonSocket({ onStatusChange }));

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateOpen();
    });
    act(() => {
      ws.simulateClose();
    });

    expect(onStatusChange).toHaveBeenLastCalledWith("disconnected");
  });

  it("parses agent.msg events and calls onAgentMessage", () => {
    const onAgentMessage = vi.fn();
    renderHook(() => useDaemonSocket({ onAgentMessage }));

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateOpen();
    });

    const agentMsg = { action: "to_human", from: "arch", to: "human", ts: 1234, message: "Task done" };
    act(() => {
      ws.simulateMessage({
        type: "agent.msg",
        payload: JSON.stringify(agentMsg),
      });
    });

    expect(onAgentMessage).toHaveBeenCalledWith(agentMsg);
  });

  it("handles agent.msg with object payload (not just string) (Feature #7)", () => {
    const onAgentMessage = vi.fn();
    renderHook(() => useDaemonSocket({ onAgentMessage }));

    const ws = MockWebSocket.instances[0];
    act(() => { ws.simulateOpen(); });

    // Simulate daemon sending payload as already-parsed object (edge case)
    const agentMsg = { action: "to_human", from: "dev", to: "human", ts: 5678, message: "Object payload" };
    act(() => {
      ws.simulateMessage({
        type: "agent.msg",
        payload: agentMsg, // object, not string
      });
    });

    expect(onAgentMessage).toHaveBeenCalledWith(agentMsg);
  });

  it("logs error to console.error on unparseable message (Feature #7)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useDaemonSocket());

    const ws = MockWebSocket.instances[0];
    act(() => { ws.simulateOpen(); });

    // Send invalid agent.msg with broken payload
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "agent.msg", payload: "not-valid-json{" }) });
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[useDaemonSocket]"),
      expect.any(Error),
      expect.stringContaining("raw:"),
      expect.any(String),
    );
    consoleSpy.mockRestore();
  });

  it("ignores non-agent.msg events (connected, pong, etc.)", () => {
    const onAgentMessage = vi.fn();
    renderHook(() => useDaemonSocket({ onAgentMessage }));

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateOpen();
    });

    act(() => {
      ws.simulateMessage({ type: "connected", clientId: "x", daemonPid: 123, timestamp: "..." });
    });
    act(() => {
      ws.simulateMessage({ type: "pong", timestamp: "..." });
    });

    expect(onAgentMessage).not.toHaveBeenCalled();
  });

  it("reconnects with exponential backoff after disconnect", () => {
    renderHook(() => useDaemonSocket());

    const ws1 = MockWebSocket.instances[0];
    act(() => {
      ws1.simulateOpen();
    });
    act(() => {
      ws1.simulateClose();
    });

    // After 1s backoff, should create new WebSocket
    expect(MockWebSocket.instances.length).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockWebSocket.instances.length).toBe(2);

    // Second disconnect: 2s backoff
    const ws2 = MockWebSocket.instances[1];
    act(() => {
      ws2.simulateClose();
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(MockWebSocket.instances.length).toBe(2); // Not yet
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(MockWebSocket.instances.length).toBe(3); // 2s elapsed
  });

  it("resets backoff on successful reconnect", () => {
    renderHook(() => useDaemonSocket());

    const ws1 = MockWebSocket.instances[0];
    act(() => { ws1.simulateOpen(); });
    act(() => { ws1.simulateClose(); });

    // 1s backoff
    act(() => { vi.advanceTimersByTime(1000); });
    const ws2 = MockWebSocket.instances[1];
    // Successful reconnect resets backoff
    act(() => { ws2.simulateOpen(); });
    act(() => { ws2.simulateClose(); });

    // Should be back to 1s, not 2s
    act(() => { vi.advanceTimersByTime(1000); });
    expect(MockWebSocket.instances.length).toBe(3);
  });

  it("calls onReconnect when reconnecting (not on initial connect)", () => {
    const onReconnect = vi.fn();
    renderHook(() => useDaemonSocket({ onReconnect }));

    const ws1 = MockWebSocket.instances[0];
    act(() => { ws1.simulateOpen(); });
    expect(onReconnect).not.toHaveBeenCalled(); // First connect: no callback

    act(() => { ws1.simulateClose(); });
    act(() => { vi.advanceTimersByTime(1000); });

    const ws2 = MockWebSocket.instances[1];
    act(() => { ws2.simulateOpen(); });
    expect(onReconnect).toHaveBeenCalledTimes(1); // Reconnect: called
  });

  it("caps backoff at 30s maximum", () => {
    renderHook(() => useDaemonSocket());

    // Create many disconnects to ramp up backoff
    // 1s → 2s → 4s → 8s → 16s → 30s (capped)
    let totalTime = 0;
    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (let i = 0; i < expectedDelays.length; i++) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      if (i === 0) {
        act(() => { ws.simulateOpen(); });
      }
      act(() => { ws.simulateClose(); });
      totalTime += expectedDelays[i];
      act(() => { vi.advanceTimersByTime(expectedDelays[i]); });
      // New ws instance should be created
      expect(MockWebSocket.instances.length).toBe(i + 2);
    }
  });

  it("does not connect when autoConnect is false", () => {
    renderHook(() => useDaemonSocket({ autoConnect: false }));
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("cleans up WebSocket on unmount", () => {
    const { unmount } = renderHook(() => useDaemonSocket());

    const ws = MockWebSocket.instances[0];
    act(() => { ws.simulateOpen(); });

    unmount();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});
