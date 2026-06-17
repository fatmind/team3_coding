/**
 * Unit tests for Modules Page (Page 2) and Timeline Page (Page 3).
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { createElement } from "react";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => createElement("a", { href, ...props }, children),
}));

// Mock next/navigation (no longer needed for panel components but keep for safety)
vi.mock("next/navigation", () => ({
  useParams: () => ({ mid: "module_1" }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import ProgressPanel from "@/components/panels/ProgressPanel";
import DevProcessPanel from "@/components/panels/DevProcessPanel";

const MOCK_MODULES_DATA = {
  modules: [
    {
      id: "module_1",
      name: "Web UI",
      status: "in_progress",
      features: [
        { id: 1, description: "Feature A", status: "done" },
        { id: 2, description: "Feature B", status: "done" },
        { id: 3, description: "Feature C", status: "pending" },
      ],
    },
    {
      id: "module_2",
      name: "Daemon",
      status: "done",
      features: [
        { id: 1, description: "Feature X", status: "done" },
      ],
    },
  ],
  dependencies: [],
};

const MOCK_FEATURES = [
  { id: 1, description: "Feature A", checkpoint: ["Step 1"], passes: true },
  { id: 2, description: "Feature B", checkpoint: ["Step 1"], passes: true },
  { id: 3, description: "Feature C", checkpoint: ["Step 1"], passes: false },
];

describe("ProgressPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders module cards with names and status badges", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MODULES_DATA })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_FEATURES });

    render(createElement(ProgressPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      expect(screen.getByText("Web UI")).toBeTruthy();
      expect(screen.getByText("Daemon")).toBeTruthy();
    });

    // Status badges
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("shows feature progress N/M for each module", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MODULES_DATA })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_FEATURES });

    render(createElement(ProgressPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      expect(screen.getByText("2/3 features")).toBeTruthy(); // module_1: 2 done / 3 total
      expect(screen.getByText("1/1 features")).toBeTruthy(); // module_2: 1 done / 1 total
    });
  });

  it("default selects first module and shows its feature details", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MODULES_DATA })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_FEATURES });

    render(createElement(ProgressPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      // Features section should show
      expect(screen.getByTestId("features-section")).toBeTruthy();
      // Feature details visible
      expect(screen.getByText("Feature A")).toBeTruthy();
      expect(screen.getByText("Feature C")).toBeTruthy();
    });

    // First module card should be selected
    const card = screen.getByTestId("module-card-module_1");
    expect(card.className).toContain("module-card-selected");
  });

  it("shows passes status for features", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MODULES_DATA })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_FEATURES });

    render(createElement(ProgressPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      const passed = screen.getAllByText("✓ Passed");
      expect(passed.length).toBe(2); // features 1 and 2
      expect(screen.getByText("○ Pending")).toBeTruthy(); // feature 3
    });
  });

  it("clicking a different module card loads its features", async () => {
    const module2Features = [
      { id: 1, description: "Feature X", checkpoint: ["Step 1"], passes: true },
    ];

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MODULES_DATA })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_FEATURES })
      .mockResolvedValueOnce({ ok: true, json: async () => module2Features });

    render(createElement(ProgressPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      expect(screen.getByTestId("module-card-module_2")).toBeTruthy();
    });

    // Click module 2
    fireEvent.click(screen.getByTestId("module-card-module_2"));

    await waitFor(() => {
      expect(screen.getByText("Feature X")).toBeTruthy();
    });

    // Verify fetch was called with module_2
    const fetchCalls = mockFetch.mock.calls;
    const lastMidCall = fetchCalls.find((c) => c[0].includes("mid=module_2"));
    expect(lastMidCall).toBeDefined();
  });

  it("has timeline link for selected module", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MODULES_DATA })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_FEATURES });

    render(createElement(ProgressPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      const link = screen.getByTestId("timeline-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/modules/module_1/timeline");
    });
  });

  it("has back link to chat page", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MODULES_DATA })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_FEATURES });

    render(createElement(ProgressPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      const link = screen.getByTestId("modules-back-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/");
    });
  });
});

describe("DevProcessPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders timeline content from API", async () => {
    const timelineText = "## Current Feature\nfeature_id: 1\nstatus: in_progress\n";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => timelineText,
    });

    render(createElement(DevProcessPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      expect(screen.getByTestId("timeline-content")).toBeTruthy();
      const pre = screen.getByTestId("timeline-content").querySelector("pre");
      expect(pre?.textContent).toBe(timelineText);
    });
  });

  it("shows error when API returns error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "File not found" }),
    });

    render(createElement(DevProcessPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      expect(screen.getByTestId("timeline-error")).toBeTruthy();
      expect(screen.getByText("File not found")).toBeTruthy();
    });
  });

  it("has back link to modules page", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "content",
    });

    render(createElement(DevProcessPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      const link = screen.getByTestId("timeline-back-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/modules");
    });
  });

  it("shows module id in title", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "content",
    });

    render(createElement(DevProcessPanel, { workspace: "/tmp/test-project" }));

    await waitFor(() => {
      expect(screen.getByText("module_1 — Timeline")).toBeTruthy();
    });
  });
});
