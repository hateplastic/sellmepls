import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const { databaseEnv, settlementEnv } = await import("../lib/env");
  databaseEnv();
  settlementEnv();
  const { reconcile } = await import("../lib/reconcile");
  let running = true;
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });
  while (running) {
    try {
      const result = await reconcile();
      if (result.paid || result.failed)
        console.log(new Date().toISOString(), result);
    } catch (error) {
      console.error(
        "Reconciliation failed",
        error instanceof Error ? error.name : "Unknown error",
      );
    }
    if (running) await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Worker startup failed",
  );
  process.exitCode = 1;
});
