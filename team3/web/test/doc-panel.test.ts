/**
 * Unit tests for DocPanel, FileTree, and DocViewer components.
 * Tests the core logic: API calls, state management, mode switching.
 * Uses jsdom environment with fetch mocked.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { createElement } from "react";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import components
import FileTree from "../src/components/FileTree";
import DocViewer from "../src/components/DocViewer";
import DocPanel from "../src/components/DocPanel";

function createResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  });
}

describe("FileTree", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders file list from API", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/files/list")) {
        return createResponse([
          { name: "app_design.md", type: "file" },
          { name: "agents", type: "dir" },
        ]);
      }
      return createResponse({}, 404);
    });

    const onSelect = vi.fn();
    render(createElement(FileTree, {
      basePath: "spec",
      selectedFile: null,
      onFileSelect: onSelect,
    }));

    await waitFor(() => {
      expect(screen.getByText("app_design.md")).toBeDefined();
    });

    expect(screen.getByText("agents")).toBeDefined();
  });

  it("calls onFileSelect when a file is clicked", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/files/list")) {
        return createResponse([
          { name: "app_design.md", type: "file" },
        ]);
      }
      return createResponse({}, 404);
    });

    const onSelect = vi.fn();
    render(createElement(FileTree, {
      basePath: "spec",
      selectedFile: null,
      onFileSelect: onSelect,
    }));

    await waitFor(() => {
      expect(screen.getByText("app_design.md")).toBeDefined();
    });

    fireEvent.click(screen.getByText("app_design.md"));
    expect(onSelect).toHaveBeenCalledWith("spec/app_design.md");
  });

  it("shows loading state initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves
    render(createElement(FileTree, {
      basePath: "spec",
      selectedFile: null,
      onFileSelect: vi.fn(),
    }));

    expect(screen.getByText("Loading...")).toBeDefined();
  });

  it("shows error state on fetch failure", async () => {
    mockFetch.mockImplementation(() => createResponse({}, 500));

    render(createElement(FileTree, {
      basePath: "spec",
      selectedFile: null,
      onFileSelect: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.getByText("Failed to load file tree")).toBeDefined();
    });
  });
});

describe("DocViewer", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders file content in preview mode by default", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/files/content")) {
        return createResponse({
          kind: "text",
          content: "# Hello World\n\nSome content.",
          mtime: 1716652800000,
        });
      }
      return createResponse({}, 404);
    });

    render(createElement(DocViewer, { filePath: "spec/app_design.md" }));

    await waitFor(() => {
      expect(screen.getByTestId("doc-preview")).toBeDefined();
    });

    // Should show markdown rendered content
    expect(screen.getByText("Hello World")).toBeDefined();
    expect(screen.getByText("Some content.")).toBeDefined();
  });

  it("switches to edit mode when Edit button is clicked", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/files/content")) {
        return createResponse({
          kind: "text",
          content: "# Test",
          mtime: 1716652800000,
        });
      }
      return createResponse({}, 404);
    });

    render(createElement(DocViewer, { filePath: "spec/test.md" }));

    await waitFor(() => {
      expect(screen.getByTestId("btn-edit")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("btn-edit"));

    await waitFor(() => {
      expect(screen.getByTestId("doc-editor")).toBeDefined();
    });

    // Textarea should contain the file content
    const textarea = screen.getByTestId("doc-editor") as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Test");
  });

  it("saves content and switches back to preview mode", async () => {
    let savedContent = "";
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("/api/files/content")) {
        return createResponse({
          kind: "text",
          content: savedContent || "# Original",
          mtime: savedContent ? 1716652900000 : 1716652800000,
        });
      }
      if (url.includes("/api/files/update") && options?.method === "PUT") {
        const body = JSON.parse(options.body as string);
        savedContent = body.content;
        return createResponse({ success: true });
      }
      return createResponse({}, 404);
    });

    render(createElement(DocViewer, { filePath: "spec/test.md" }));

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId("btn-edit")).toBeDefined();
    });

    // Switch to edit
    fireEvent.click(screen.getByTestId("btn-edit"));
    await waitFor(() => {
      expect(screen.getByTestId("doc-editor")).toBeDefined();
    });

    // Edit content
    const textarea = screen.getByTestId("doc-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Updated Content" } });

    // Save
    fireEvent.click(screen.getByTestId("btn-save"));

    // Should switch back to preview
    await waitFor(() => {
      expect(screen.getByTestId("doc-preview")).toBeDefined();
    });

    // Verify PUT was called with correct content
    const putCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("/api/files/update")
    );
    expect(putCall).toBeDefined();
    const putBody = JSON.parse(putCall![1].body);
    expect(putBody.path).toBe("spec/test.md");
    expect(putBody.content).toBe("# Updated Content");
  });

  it("shows file path in toolbar", async () => {
    mockFetch.mockImplementation(() =>
      createResponse({ kind: "text", content: "hello", mtime: 1000 })
    );

    render(createElement(DocViewer, { filePath: "spec/app_design.md" }));

    await waitFor(() => {
      expect(screen.getByTestId("doc-viewer-path")).toBeDefined();
    });

    expect(screen.getByTestId("doc-viewer-path").textContent).toBe("spec/app_design.md");
  });

  it("renders image preview and disables edit for png files", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/files/content")) {
        return createResponse({
          kind: "image",
          mimeType: "image/png",
          mtime: 1716652800000,
        });
      }
      return createResponse({}, 404);
    });

    render(createElement(DocViewer, { filePath: "spec/ux_badminton.png" }));

    await waitFor(() => {
      expect(screen.getByTestId("doc-image")).toBeDefined();
    });

    const img = screen.getByTestId("doc-image") as HTMLImageElement;
    expect(img.src).toContain("/api/files/raw?path=spec%2Fux_badminton.png");
    expect(img.src).toContain("t=1716652800000");
    expect(screen.getByTestId("doc-readonly-hint").textContent).toBe("不可编辑");
    expect(screen.queryByTestId("btn-edit")).toBeNull();
  });
});

describe("DocPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders both FileTree and DocViewer with default file", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/files/list")) {
        return createResponse([
          { name: "app_design.md", type: "file" },
        ]);
      }
      if (url.includes("/api/files/content")) {
        return createResponse({
          kind: "text",
          content: "# App Design",
          mtime: 1716652800000,
        });
      }
      return createResponse({}, 404);
    });

    render(createElement(DocPanel));

    // Should render both sections
    await waitFor(() => {
      expect(screen.getByTestId("doc-panel")).toBeDefined();
    });

    // Default file path should be spec/app_design.md
    await waitFor(() => {
      expect(screen.getByTestId("doc-viewer-path")?.textContent).toBe("spec/app_design.md");
    });
  });
});
