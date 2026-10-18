import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Tests run in a fixed zone that observes DST, to catch time-zone bugs.
    env: { TZ: "America/New_York" },
  },
});
