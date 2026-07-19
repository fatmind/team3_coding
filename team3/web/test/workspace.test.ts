/**
 * Unit tests for workspace.ts - path resolution and security validation.
 * All filesystem operations are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("node:fs");

import { resolveSafePath } from "../src/lib/workspace";

describe("resolveSafePath", () => {
  const WORKSPACE = "/projects/my-workspace";

  it("resolves a valid relative path", () => {
    const result = resolveSafePath("spec/app_design.md", WORKSPACE);
    expect(result).toBe(path.resolve(WORKSPACE, "spec/app_design.md"));
  });

  it("resolves nested directory paths", () => {
    const result = resolveSafePath("cli/simulate_human.mjs", WORKSPACE);
    expect(result).toBe(path.resolve(WORKSPACE, "cli/simulate_human.mjs"));
  });

  it("returns null for ../etc/passwd traversal", () => {
    const result = resolveSafePath("../etc/passwd", WORKSPACE);
    expect(result).toBeNull();
  });

  it("returns null for ../../etc/passwd deep traversal", () => {
    const result = resolveSafePath("../../etc/passwd", WORKSPACE);
    expect(result).toBeNull();
  });

  it("returns null for path with embedded ../ traversal", () => {
    const result = resolveSafePath("spec/../../../etc/passwd", WORKSPACE);
    expect(result).toBeNull();
  });

  it("allows paths that contain .. but resolve within workspace", () => {
    // spec/../spec/app_design.md resolves to spec/app_design.md — still within workspace
    const result = resolveSafePath("spec/../spec/app_design.md", WORKSPACE);
    expect(result).toBe(path.resolve(WORKSPACE, "spec/app_design.md"));
  });

  it("returns null for absolute path outside workspace", () => {
    const result = resolveSafePath("/etc/passwd", WORKSPACE);
    expect(result).toBeNull();
  });

  it("allows the workspace root itself", () => {
    const result = resolveSafePath(".", WORKSPACE);
    expect(result).toBe(path.resolve(WORKSPACE));
  });

  it("allows simple filename", () => {
    const result = resolveSafePath("README.md", WORKSPACE);
    expect(result).toBe(path.resolve(WORKSPACE, "README.md"));
  });
});

