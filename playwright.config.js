// Screen tests: drive the real app in a phone-sized Chromium.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    ...devices["Pixel 7"],
    serviceWorkers: "block",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "python3 -m http.server 4173",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "ignore",
    },
    {
      // Stand-in for Supabase, used by the sync tests.
      command: "node e2e/fake-supabase.mjs",
      port: 5998,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
