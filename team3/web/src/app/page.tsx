"use client";

import { Suspense } from "react";
import AppShell from "@/components/AppShell";

function AppShellWrapper() {
  return <AppShell />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="app-loading">Loading...</div>}>
      <AppShellWrapper />
    </Suspense>
  );
}
