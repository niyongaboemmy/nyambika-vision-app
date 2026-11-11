import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC keeps decorator metadata so NestJS dependency injection works under test.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: { include: ["src/**/*.spec.ts", "test/**/*.spec.ts"], setupFiles: ["test/setup-isolation.ts"], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false },
});
