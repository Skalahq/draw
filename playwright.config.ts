import { defineConfig } from "@playwright/test";

const port = 4317;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  use: { baseURL, viewport: { width: 1000, height: 700 }, trace: "retain-on-failure" },
  webServer: {
    command: `bun run --filter @draw/demo start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
