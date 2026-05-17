import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  esbuild: {
    // Automatic JSX runtime — React 17+ style. Test files importing
    // .tsx components don't need to `import React from "react"`.
    jsx: "automatic",
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    // happy-dom is enabled per-file (browser DOM env) via the
    // `// @vitest-environment happy-dom` comment at the top of each .tsx test.
    // Default stays node so PAIC/transport/logger tests don't pay for DOM.
    environment: "node",
  },
});
