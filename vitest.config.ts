import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(".") } },
  test: {
    environment: "node",
    maxWorkers: 2,
    env: { NEXT_PUBLIC_CHAIN_ENV: "testnet" },
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
