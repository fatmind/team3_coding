import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["e2e/**/*.ts"],
    // e2e tests share filesystem state (test project path), must run sequentially
    fileParallelism: false,
    // e2e tests may need longer timeout (server startup)
    testTimeout: 30000,
  },
});
