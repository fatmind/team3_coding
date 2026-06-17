"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export interface FileEntry {
  name: string;
  type: "file" | "dir";
}

interface FileTreeProps {
  /** The base path to list (e.g. "spec") */
  basePath: string;
  /** Currently selected file path (relative to workspace root) */
  selectedFile: string | null;
  /** Callback when a file is clicked */
  onFileSelect: (filePath: string) => void;
  /** Optional workspace path for API calls */
  workspace?: string;
}

/**
 * FileTree component - displays a directory listing from the API.
 * Shows files and directories with icons, supports click to select.
 */
export default function FileTree({ basePath, selectedFile, onFileSelect, workspace }: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [subEntries, setSubEntries] = useState<Record<string, FileEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Build API URL with optional workspace param */
  function filesListUrl(dirPath: string): string {
    const params = new URLSearchParams({ path: dirPath });
    if (workspace) params.set("workspace", workspace);
    return `/api/files/list?${params.toString()}`;
  }

  useEffect(() => {
    fetchEntries(basePath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, workspace]);

  async function fetchEntries(dirPath: string) {
    try {
      setLoading(true);
      const res = await fetch(filesListUrl(dirPath));
      if (!res.ok) {
        setError("Failed to load file tree");
        return;
      }
      const data: FileEntry[] = await res.json();
      // Sort: directories first, then files, alphabetically
      data.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(data);
      setError(null);
    } catch {
      setError("Failed to load file tree");
    } finally {
      setLoading(false);
    }
  }

  async function toggleDir(dirPath: string) {
    if (expandedDirs.has(dirPath)) {
      const next = new Set(expandedDirs);
      next.delete(dirPath);
      setExpandedDirs(next);
    } else {
      // Fetch sub-entries if not cached
      if (!subEntries[dirPath]) {
        try {
          const res = await fetch(filesListUrl(dirPath));
          if (res.ok) {
            const data: FileEntry[] = await res.json();
            data.sort((a, b) => {
              if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            setSubEntries((prev) => ({ ...prev, [dirPath]: data }));
          }
        } catch {
          // Silently fail for sub-directories
        }
      }
      setExpandedDirs(new Set([...expandedDirs, dirPath]));
    }
  }

  function renderEntries(items: FileEntry[], parentPath: string, depth: number) {
    return items.map((entry) => {
      const fullPath = `${parentPath}/${entry.name}`;
      const isSelected = selectedFile === fullPath;
      const isExpanded = expandedDirs.has(fullPath);

      return (
        <div key={fullPath}>
          <div
            className={cn("file-tree-item", isSelected && "selected")}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => {
              if (entry.type === "dir") {
                toggleDir(fullPath);
              } else {
                onFileSelect(fullPath);
              }
            }}
            data-testid={`file-tree-item-${entry.name}`}
          >
            <span className="file-tree-icon">
              {entry.type === "dir" ? (isExpanded ? "📂" : "📁") : "📄"}
            </span>
            <span className="file-tree-name">{entry.name}</span>
          </div>
          {entry.type === "dir" && isExpanded && subEntries[fullPath] && (
            renderEntries(subEntries[fullPath], fullPath, depth + 1)
          )}
        </div>
      );
    });
  }

  if (loading) {
    return <div className="file-tree-loading">Loading...</div>;
  }

  if (error) {
    return <div className="file-tree-error">{error}</div>;
  }

  return (
    <div className="file-tree" data-slot="file-tree" data-testid="file-tree">
      <div className="file-tree-header">Files</div>
      {renderEntries(entries, basePath, 0)}
    </div>
  );
}
