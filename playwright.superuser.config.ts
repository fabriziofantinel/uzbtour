import { defineConfig, devices } from "@playwright/test";

// Config dedicata all'esecuzione manuale della suite Superuser contro un ambiente
// reale (E2E_BASE_URL). Non fa parte del quality gate della CI.
// Esegue ogni test su due dispositivi emulati: Android (Chromium/Pixel) e iOS
// (WebKit/iPhone), per intercettare differenze di layout e comportamento mobile.
export default defineConfig({
  testDir: "./tests/manual-run/superuser",
  outputDir: "./tests/manual-run/superuser/.artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./tests/manual-run/superuser/report", open: "never" }],
    ["json", { outputFile: "./tests/manual-run/superuser/results.json" }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "ios", use: { ...devices["iPhone 13"] } },
  ],
});
