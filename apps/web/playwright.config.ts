import { defineConfig, devices } from "@playwright/test";

/** E2E against a running stack (pnpm dev + seed). Mobile-first: Pixel 7 profile. */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", ...devices["Pixel 7"], trace: "retain-on-failure" },
});
