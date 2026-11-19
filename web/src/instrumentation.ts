/** Runs once when a server instance starts (Node runtime only). Starts the optional in-process scheduler. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}
