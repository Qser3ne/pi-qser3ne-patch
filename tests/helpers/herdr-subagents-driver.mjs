// Offline acceptance fixture: simulates only the public subagents status RPC.
// No child sessions, models, network requests or background runners are started.
export default function driver(pi) {
  let count = 0;
  let terminal;
  let unsubscribe;
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setWidget("herdr-subagents-qa", (tui) => {
      terminal = tui.terminal;
      return { render: () => [], invalidate() {} };
    });
    ctx.ui.setWidget("herdr-subagents-qa", undefined);
    unsubscribe = pi.events.on("subagents:rpc:v1:request", (request) => {
      if (request.version !== 1 || request.method !== "status") return;
      pi.events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
        version: 1, requestId: request.requestId, success: true,
        data: {
          text: "Offline QA snapshot", details: { mode: "management", results: [] },
          fleet: { version: 1, totalActive: count + 1, omitted: 0, entries: [] },
          asyncSnapshot: {
            kind: "pi-subagents.async-status-snapshot", version: 1, generatedAt: Date.now(),
            caps: { maxRuns: 32, maxDepth: 4, maxChildrenPerNode: 32, maxStringLength: 256, maxSerializedBytes: 65536 },
            omitted: { runs: 0, children: 0, byteLimitExceeded: false },
            runs: [{ id: "qa-workflow", kind: "workflow", label: "offline QA", state: "running", startedAt: 1000,
              children: [
                ...Array.from({ length: count }, (_, index) => ({ id: `worker-${index}`, kind: "step", agent: "worker", label: "worker", state: "running", startedAt: 1000 })),
                { id: "queued", kind: "step", agent: "worker", label: "queued", state: "queued" },
                { id: "ci", kind: "host-step", label: "CI", state: "running", hostStep: { kind: "command", state: "running" } },
              ],
            }],
          },
        },
      });
    });
    pi.events.emit("subagents:rpc:v1:ready", { version: 1 });
  });
  pi.registerCommand("herdr-subagents-count", {
    description: "Offline QA: simulate a running child count (0–8); no LLM calls",
    handler: async (args) => {
      const next = Number(args.trim());
      if (!Number.isInteger(next) || next < 0 || next > 8) throw new Error("Expected count 0–8");
      count = next;
      terminal.setProgramStatus({ state: "done", app: "pi", message: "offline QA" });
      pi.events.emit("subagent:jobs-changed", { version: 1 });
    },
  });
  pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; });
}
