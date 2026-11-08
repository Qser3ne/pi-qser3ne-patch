import assert from "node:assert/strict";
import { test } from "node:test";
import { countRunningSubagents, createForegroundTracker } from "../src/herdr-activity.ts";

const step = (id: string, state = "running", children?: unknown[]) => ({
  id, kind: "step", label: "worker", agent: "worker", state, startedAt: 1000, children,
});
const run = (id: string, children: unknown[], state = "running", kind = "subagent") => ({
  id, kind, label: "workers", state, startedAt: 1000, updatedAt: 1100, children,
});
const snapshot = (runs: unknown[], omitted = {}) => ({
  kind: "pi-subagents.async-status-snapshot", version: 1, generatedAt: 1200,
  caps: { maxRuns: 32, maxDepth: 4, maxChildrenPerNode: 32, maxStringLength: 256, maxSerializedBytes: 65536 },
  omitted: { runs: 0, children: 0, byteLimitExceeded: false, ...omitted }, runs,
});

test("counts instances rather than same-named agents, excluding queued and finished steps", () => {
  assert.deepEqual(countRunningSubagents(snapshot([run("parallel", [
    step("step:0"), step("step:1"), step("step:2", "queued"), step("step:3", "complete"),
  ])])), { count: 2, approximate: false });
  assert.equal(countRunningSubagents(snapshot([run("chain", [
    step("step:0", "complete"), step("step:1"), step("step:2", "queued"),
  ])])).count, 1);
});

test("workflow coordinator and host command do not count as agents", () => {
  const host = { id: "ci", kind: "host-step", label: "CI", state: "running", hostStep: { kind: "command", state: "running" } };
  assert.deepEqual(countRunningSubagents(snapshot([run("wf", [host], "running", "workflow")])), { count: 0, approximate: false });
  assert.equal(countRunningSubagents(snapshot([run("wf", [step("a"), step("b"), host], "running", "workflow")])).count, 2);
  assert.equal(countRunningSubagents(snapshot([run("empty", [], "running", "workflow")])).count, 0);
});

test("counts a running parent agent and its nested children, not duplicate containers", () => {
  const child = run("nested", [step("step:0")]);
  const parent = run("parent", [step("step:0", "running", [child])]);
  assert.equal(countRunningSubagents(snapshot([parent])).count, 2);
  assert.equal(countRunningSubagents(snapshot([run("wf", [parent], "complete", "workflow"), parent])).count, 2);
  assert.equal(countRunningSubagents(snapshot([run("done", [step("step:0", "complete", [child])], "complete")])).count, 1);
});

test("single materialized run without steps counts once; queued run does not count", () => {
  assert.equal(countRunningSubagents(snapshot([run("a", [])])).count, 1);
  assert.equal(countRunningSubagents(snapshot([run("a", [], "queued")])).count, 0);
  assert.equal(countRunningSubagents(snapshot([run("materialized", [step("lane", "running", [step("step:0"), step("step:1")])])])).count, 2);
});

test("omissions and malformed nodes cannot pretend to be exact counts", () => {
  for (const omitted of [{ runs: 1 }, { children: 1 }, { byteLimitExceeded: true }]) {
    assert.deepEqual(countRunningSubagents(snapshot([run("a", [])], omitted)), { count: 1, approximate: true });
  }
  for (const value of [null, {}, { version: 99, runs: [] }, snapshot([null]), snapshot([{ id: "bad", kind: "unknown", state: "running" }])]) {
    assert.deepEqual(countRunningSubagents(value), { count: 0, approximate: true });
  }
  const cyclic: any = run("cycle", []);
  cyclic.children.push(cyclic);
  assert.deepEqual(countRunningSubagents(snapshot([cyclic])), { count: 0, approximate: true });
});

test("foreground progress replaces snapshots and uses stable indexes", () => {
  const tracker = createForegroundTracker();
  tracker.update("tool-a", { runId: "a", mode: "parallel", results: [
    { index: 2, agent: "worker", progress: { status: "running" } },
    { index: 4, agent: "worker", progress: { status: "running" } },
  ] });
  assert.equal(tracker.count, 2);
  tracker.update("tool-a", { runId: "a", mode: "parallel", results: [
    { index: 4, agent: "worker", progress: { status: "complete" } },
    { index: 2, agent: "worker", progress: { status: "running" } },
  ], progress: [{ index: 2, status: "running" }, { index: 4, status: "complete" }] });
  assert.equal(tracker.count, 1, "results and progress must not double count");
  tracker.update("tool-b", { runId: "b", mode: "single", progress: [{ index: 0, status: "running" }] });
  assert.equal(tracker.count, 2);
  tracker.update("tool-c", { mode: "management", results: [] });
  tracker.update("tool-d", { mode: "workflow", results: [{ index: 0, progress: { status: "running" } }] });
  assert.equal(tracker.count, 2, "workflows belong to canonical async snapshots");
  tracker.close("tool-a");
  assert.equal(tracker.count, 1);
  tracker.close("tool-b");
  tracker.close("tool-b");
  assert.equal(tracker.count, 0);
});
