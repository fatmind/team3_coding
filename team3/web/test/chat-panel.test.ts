/**
 * Unit tests for ChatPanel component.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { createElement } from "react";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

// Mock useDaemonSocket to avoid WebSocket in unit tests
vi.mock("@/lib/useDaemonSocket", () => ({
  useDaemonSocket: () => ({ status: "disconnected", connect: () => {} }),
}));

// Import component after mocks
import ChatPanel from "@/components/ChatPanel";

function renderPanel() {
  return render(createElement(ChatPanel));
}

describe("ChatPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default: return empty history
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state initially", () => {
    // Make fetch hang
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText("Loading messages...")).toBeTruthy();
  });

  it("shows empty state when no messages", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("No messages yet. Start a conversation!")).toBeTruthy();
    });
  });

  it("renders messages from history with correct role styling", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { action: "to_arch", from: "human", to: "arch", ts: 1000, message: "Hello architect" },
        { action: "to_human", from: "arch", to: "human", ts: 1001, message: "Got it" },
      ],
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Hello architect")).toBeTruthy();
      expect(screen.getByText("Got it")).toBeTruthy();
    });

    // Human message should be in a right-aligned bubble
    const humanMsg = screen.getByTestId("chat-msg-0");
    expect(humanMsg.className).toContain("chat-bubble-right");

    // Agent message should be in a left-aligned bubble
    const agentMsg = screen.getByTestId("chat-msg-1");
    expect(agentMsg.className).toContain("chat-bubble-left");
  });

  it("shows role name and AI badge for agent messages", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { action: "to_human", from: "arch", to: "human", ts: 1000, message: "Response" },
      ],
    });

    renderPanel();

    await waitFor(() => {
      // Role name appears in bubble header (also in select option, so use getAllByText)
      const archTexts = screen.getAllByText("Architect");
      expect(archTexts.length).toBeGreaterThanOrEqual(1);
      // AI badge shown for agent messages
      expect(screen.getByText("AI")).toBeTruthy();
      // Verify the bubble name specifically
      const bubbleMsg = screen.getByTestId("chat-msg-0");
      const nameEl = bubbleMsg.querySelector(".chat-bubble-name");
      expect(nameEl?.textContent).toBe("Architect");
    });
  });

  it("has target selector with arch/dev/uat options", async () => {
    renderPanel();

    await waitFor(() => {
      const select = screen.getByTestId("chat-target-select") as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.value).toBe("arch");
      const options = select.querySelectorAll("option");
      expect(options.length).toBe(3);
      expect(options[0].value).toBe("arch");
      expect(options[1].value).toBe("dev");
      expect(options[2].value).toBe("uat");
    });
  });

  it("sends message on Enter key and shows optimistically", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // history
      .mockResolvedValueOnce({ ok: true }); // send (no json needed)

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeTruthy();
    });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Test message" } });
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    });

    // Message should appear immediately (optimistic)
    await waitFor(() => {
      expect(screen.getByText("Test message")).toBeTruthy();
    });

    // Input should be cleared
    expect(input.value).toBe("");

    // Fetch should be called with correct payload
    expect(mockFetch).toHaveBeenCalledWith("/api/chat/send", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }));

    // Verify body
    const sendCall = mockFetch.mock.calls[1];
    const body = JSON.parse(sendCall[1].body);
    expect(body.action).toBe("to_arch");
    expect(body.to).toBe("arch");
    expect(body.message).toBe("Test message");
  });

  it("parses @mention to override target", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true }); // send

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeTruthy();
    });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "@dev please fix the bug" } });
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    });

    await waitFor(() => {
      expect(screen.getByText("please fix the bug")).toBeTruthy();
    });

    // Should have sent to dev, not arch
    const sendCall = mockFetch.mock.calls[1];
    const body = JSON.parse(sendCall[1].body);
    expect(body.to).toBe("dev");
    expect(body.action).toBe("dev_do");
    expect(body.message).toBe("please fix the bug");
  });

  it("send button is disabled when input is empty", async () => {
    renderPanel();

    await waitFor(() => {
      const btn = screen.getByTestId("chat-send-btn") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it("shows avatars with correct letters", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { action: "to_arch", from: "human", to: "arch", ts: 1000, message: "Hi" },
        { action: "to_human", from: "dev", to: "human", ts: 1001, message: "Hello" },
      ],
    });

    renderPanel();

    await waitFor(() => {
      const avatars = screen.getAllByTestId("chat-avatar");
      // Human avatar shows "H", Dev avatar shows "D"
      expect(avatars.some((a) => a.textContent === "H")).toBe(true);
      expect(avatars.some((a) => a.textContent === "D")).toBe(true);
    });
  });

  it("fetches history from /api/chat/history on mount", async () => {
    renderPanel();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/chat/history");
    });
  });
});
