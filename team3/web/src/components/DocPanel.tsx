"use client";

import { useState } from "react";
import FileTree from "./FileTree";
import DocViewer from "./DocViewer";

interface DocPanelProps {
  workspace?: string;
}

/**
 * DocPanel - Container component for the document area (Page 1, right 60%).
 * Orchestrates FileTree and DocViewer.
 * Default file: spec/app_design.md
 */
export default function DocPanel({ workspace }: DocPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string>("spec/app_design.md");

  return (
    <div className="doc-panel" data-slot="doc-panel" data-testid="doc-panel">
      <div className="doc-panel-sidebar">
        <FileTree
          basePath="spec"
          selectedFile={selectedFile}
          onFileSelect={setSelectedFile}
          workspace={workspace}
        />
      </div>
      <div className="doc-panel-main">
        <DocViewer filePath={selectedFile} workspace={workspace} />
      </div>
    </div>
  );
}
