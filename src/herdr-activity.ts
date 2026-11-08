export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ActivityCount = { count: number; approximate: boolean };

/** Project the public v1 snapshot, not fleet.totalActive (which includes queued work). */
export function countRunningSubagents(snapshot: unknown): ActivityCount {
  if (!isRecord(snapshot) || snapshot.kind !== "pi-subagents.async-status-snapshot"
    || snapshot.version !== 1 || !Array.isArray(snapshot.runs)) return { count: 0, approximate: true };
  const omitted = snapshot.omitted;
  let approximate = !isRecord(omitted) || omitted.runs !== 0 || omitted.children !== 0 || omitted.byteLimitExceeded !== false;
  let count = 0;
  let budget = 4096;
  let cyclic = false;
  const path = new Set<object>();
  const seen = new Set<string>();
  function visit(node: unknown, scope: string, depth: number): void {
    if (--budget < 0 || depth > 32) { approximate = true; return; }
    if (!isRecord(node)) { approximate = true; return; }
    if (path.has(node)) { cyclic = true; approximate = true; return; }
    if (typeof node.id !== "string" || !node.id || !["subagent", "workflow", "step", "host-step"].includes(String(node.kind))
      || typeof node.state !== "string") { approximate = true; return; }
    const container = node.kind === "subagent" || node.kind === "workflow";
    const key = container ? `run:${node.id}` : `${scope}/${node.kind}:${node.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    path.add(node);
    const children = Array.isArray(node.children) ? node.children : [];
    if (node.children !== undefined && !Array.isArray(node.children)) approximate = true;
    // A run (or materialized parallel lane) wraps step records for its agents.
    const wrapsSteps = children.some((child) => isRecord(child) && child.kind === "step");
    if (node.state === "running" && !wrapsSteps && (node.kind === "subagent" || (node.kind === "step" && typeof node.agent === "string" && !!node.agent))) count++;
    for (const child of children) visit(child, container ? key : `${scope}/${node.id}`, depth + 1);
    path.delete(node);
  }
  for (const run of snapshot.runs) visit(run, "root", 0);
  return { count: cyclic ? 0 : count, approximate };
}

/** Only parent-visible foreground tools; background/workflow progress has another owner. */
export function createForegroundTracker() {
  const calls = new Map<string, Set<number>>();
  return {
    update(toolCallId: string, details: unknown): void {
      if (!isRecord(details) || !["single", "parallel", "chain"].includes(String(details.mode))) {
        calls.delete(toolCallId);
        return;
      }
      const statuses = new Map<number, unknown>();
      if (Array.isArray(details.results)) for (const result of details.results) {
        if (isRecord(result) && Number.isSafeInteger(result.index) && isRecord(result.progress)) {
          statuses.set(result.index as number, result.progress.status);
        }
      }
      if (Array.isArray(details.progress)) for (const row of details.progress) {
        if (isRecord(row) && Number.isSafeInteger(row.index)) statuses.set(row.index as number, row.status);
      }
      calls.set(toolCallId, new Set([...statuses].filter(([, status]) => status === "running").map(([index]) => index)));
    },
    close(toolCallId: string): void { calls.delete(toolCallId); },
    get count(): number { return [...calls.values()].reduce((sum, children) => sum + children.size, 0); },
  };
}
