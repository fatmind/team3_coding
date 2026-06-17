"use client";

import { useState } from "react";

interface CreateProjectModalProps {
  onClose: () => void;
  onCreated: (name: string) => void;
}

export default function CreateProjectModal({ onClose, onCreated }: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim() || !parentDir.trim() || creating) return;

    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/project/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parentDir: parentDir.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(name.trim());
      } else {
        setError(data.error || "Failed to create project");
      }
    } catch {
      setError("Failed to connect to server");
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} data-slot="create-project-modal" data-testid="create-modal-backdrop">
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        data-testid="create-modal"
      >
        <h3 className="modal-title">新建项目</h3>

        <div className="modal-field">
          <label className="modal-label">项目名称</label>
          <input
            type="text"
            className="modal-input"
            placeholder="e.g. my-app"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            data-testid="modal-name-input"
          />
        </div>

        <div className="modal-field">
          <label className="modal-label">父目录路径</label>
          <input
            type="text"
            className="modal-input"
            placeholder="e.g. /Users/me/projects"
            value={parentDir}
            onChange={(e) => setParentDir(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="modal-path-input"
          />
          <span className="modal-hint">已有目录也可以，会自动初始化 team3 配置</span>
        </div>

        {error && (
          <div className="modal-error" data-testid="modal-error">{error}</div>
        )}

        <div className="modal-actions">
          <button className="modal-btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="modal-btn-primary"
            onClick={handleCreate}
            disabled={!name.trim() || !parentDir.trim() || creating}
            data-testid="modal-create-btn"
          >
            {creating ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
