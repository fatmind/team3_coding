"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isImageFile } from "@/lib/file-types";

interface DocViewerProps {
  /** File path relative to workspace root (e.g. "spec/app_design.md") */
  filePath: string;
  /** Optional workspace path for API calls */
  workspace?: string;
}

type FileKind = "text" | "image";

interface FileContentResponse {
  kind?: FileKind;
  content?: string;
  mimeType?: string;
  mtime: number;
}

/**
 * DocViewer component - displays file content with preview/edit modes.
 * Supports:
 * - Markdown preview rendering
 * - Image preview for png/jpg/gif/webp
 * - Edit mode with textarea (text files only)
 * - Save via PUT /api/files/update
 * - Auto-switch back to preview after save
 * - mtime-based auto-reload on focus
 */
export default function DocViewer({ filePath, workspace }: DocViewerProps) {
  const [content, setContent] = useState<string>("");
  const [fileKind, setFileKind] = useState<FileKind>("text");
  const [editContent, setEditContent] = useState<string>("");
  const [mtime, setMtime] = useState<number>(0);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mtimeRef = useRef<number>(0);
  const isImage = isImageFile(filePath);

  /** Build API URL with optional workspace param */
  const contentUrl = useCallback(
    (fPath: string) => {
      const params = new URLSearchParams({ path: fPath });
      if (workspace) params.set("workspace", workspace);
      return `/api/files/content?${params.toString()}`;
    },
    [workspace]
  );

  const rawUrl = useCallback(
    (fPath: string, cacheBust?: number) => {
      const params = new URLSearchParams({ path: fPath });
      if (workspace) params.set("workspace", workspace);
      if (cacheBust) params.set("t", String(cacheBust));
      return `/api/files/raw?${params.toString()}`;
    },
    [workspace]
  );

  const updateUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (workspace) params.set("workspace", workspace);
    const qs = params.toString();
    return qs ? `/api/files/update?${qs}` : "/api/files/update";
  }, [workspace]);

  function applyFileData(data: FileContentResponse) {
    if (data.kind === "image") {
      setFileKind("image");
      setContent("");
    } else {
      setFileKind("text");
      setContent(data.content ?? "");
    }
    setMtime(data.mtime);
    mtimeRef.current = data.mtime;
  }

  // Fetch file content
  const fetchContent = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(contentUrl(filePath));
      if (!res.ok) {
        setError("Failed to load file");
        return;
      }
      const data: FileContentResponse = await res.json();
      applyFileData(data);
      setError(null);
    } catch {
      setError("Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [filePath, contentUrl]);

  // Load content on mount and when filePath changes
  useEffect(() => {
    setMode("preview");
    fetchContent();
  }, [filePath, fetchContent]);

  // mtime-based auto-reload on focus
  useEffect(() => {
    async function checkMtime() {
      try {
        const res = await fetch(contentUrl(filePath));
        if (res.ok) {
          const data: FileContentResponse = await res.json();
          if (data.mtime !== mtimeRef.current) {
            applyFileData(data);
            if (mode === "edit" && data.kind !== "image") {
              setEditContent(data.content ?? "");
            }
          }
        }
      } catch {
        // Silently fail on focus check
      }
    }

    function handleFocus() {
      checkMtime();
    }

    window.addEventListener("focus", handleFocus);
    const container = containerRef.current;
    if (container) {
      container.addEventListener("focusin", handleFocus);
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      if (container) {
        container.removeEventListener("focusin", handleFocus);
      }
    };
  }, [filePath, mode, contentUrl]);

  // Switch to edit mode
  function handleEdit() {
    setEditContent(content);
    setMode("edit");
  }

  // Save content
  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(updateUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content: editContent }),
      });

      if (res.ok) {
        const contentRes = await fetch(contentUrl(filePath));
        if (contentRes.ok) {
          const data: FileContentResponse = await contentRes.json();
          applyFileData(data);
        } else {
          setContent(editContent);
        }
        setMode("preview");
        setError(null);
      } else {
        setError("Failed to save file");
      }
    } catch {
      setError("Failed to save file");
    } finally {
      setSaving(false);
    }
  }

  // Cancel edit
  function handleCancel() {
    setMode("preview");
  }

  if (loading) {
    return <div className="doc-viewer-loading">Loading...</div>;
  }

  if (error && !content && fileKind !== "image") {
    return <div className="doc-viewer-error">{error}</div>;
  }

  return (
    <div className="doc-viewer" ref={containerRef} data-slot="doc-viewer" data-testid="doc-viewer">
      <div className="doc-viewer-toolbar">
        <span className="doc-viewer-path" data-testid="doc-viewer-path">
          {filePath}
        </span>
        <div className="doc-viewer-actions">
          {isImage ? (
            <span className="doc-viewer-readonly-hint" data-testid="doc-readonly-hint">
              不可编辑
            </span>
          ) : mode === "preview" ? (
            <button
              onClick={handleEdit}
              className="doc-viewer-btn"
              data-testid="btn-edit"
            >
              Edit
            </button>
          ) : (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="doc-viewer-btn doc-viewer-btn-primary"
                data-testid="btn-save"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleCancel}
                className="doc-viewer-btn"
                data-testid="btn-cancel"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="doc-viewer-error-banner">{error}</div>}

      <div className="doc-viewer-content">
        {mode === "preview" ? (
          <div className="doc-viewer-preview" data-testid="doc-preview">
            {fileKind === "image" ? (
              <img
                src={rawUrl(filePath, mtime)}
                alt={filePath}
                className="doc-viewer-image"
                data-testid="doc-image"
              />
            ) : /\.(md|markdown)$/i.test(filePath) ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            ) : (
              <pre className="doc-viewer-code">{content}</pre>
            )}
          </div>
        ) : (
          <textarea
            className="doc-viewer-editor"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            data-testid="doc-editor"
          />
        )}
      </div>
    </div>
  );
}
