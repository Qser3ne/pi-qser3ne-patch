import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProgramStatus } from "@earendil-works/pi-tui";
import { attachHerdrStatusBridge } from "../src/herdr-status-bridge.ts";

function fixture() {
  const reports: ProgramStatus[] = [];
  const terminal = { setProgramStatus(status: ProgramStatus) { assert.equal(this, terminal); reports.push({ ...status }); } };
  const original = terminal.setProgramStatus;
  const bridge = attachHerdrStatusBridge(terminal, { state: "idle", app: "pi" });
  return { terminal, reports, original, bridge, last: () => reports.at(-1) };
}

test("working overlay updates count and restores latest native state, not initial idle", () => {
  const h = fixture();
  h.terminal.setProgramStatus({ state: "done", app: "pi", message: "session" });
  h.bridge.setActivity(2);
  assert.deepEqual(h.last(), { state: "working", app: "pi", message: "正在工作的 subagent：2" });
  h.terminal.setProgramStatus({ state: "working", app: "pi", message: "main" });
  h.bridge.setActivity(1);
  assert.equal(h.last()?.message, "正在工作的 subagent：1");
  h.bridge.setActivity(0);
  assert.deepEqual(h.last(), { state: "working", app: "pi", message: "main" });
  h.bridge.setActivity(2, true);
  assert.equal(h.last()?.message, "正在工作的 subagent：≥2");
  h.terminal.setProgramStatus({ state: "error", app: "pi", message: "latest error" });
  h.bridge.setActivity(0);
  assert.deepEqual(h.last(), { state: "error", app: "pi", message: "latest error" });
});

test("blocked and clear take priority even across activity changes", () => {
  const h = fixture();
  for (const kind of ["question", "permission", "auth"] as const) {
    const blocked: ProgramStatus = { state: "blocked", app: "pi", kind, message: "user" };
    h.terminal.setProgramStatus(blocked);
    h.bridge.setActivity(2);
    h.bridge.setActivity(1);
    assert.deepEqual(h.last(), blocked);
    h.terminal.setProgramStatus({ state: "done", app: "pi" });
    assert.equal(h.last()?.state, "working");
  }
  h.terminal.setProgramStatus({ state: "clear" });
  h.bridge.setActivity(3);
  assert.deepEqual(h.last(), { state: "clear" });
});

test("dispose restores latest native report and does not remove later wrappers", () => {
  const h = fixture();
  h.bridge.setActivity(1);
  h.terminal.setProgramStatus({ state: "done", app: "pi" });
  const ours = h.terminal.setProgramStatus;
  const later = function (status: ProgramStatus) { ours.call(h.terminal, status); };
  h.terminal.setProgramStatus = later;
  h.bridge.dispose();
  assert.equal(h.terminal.setProgramStatus, later);
  assert.deepEqual(h.last(), { state: "done", app: "pi" });
  h.bridge.dispose();
  h.bridge.setActivity(3);
  h.terminal.setProgramStatus({ state: "idle" });
  assert.deepEqual(h.last(), { state: "idle" });
  const h2 = fixture();
  h2.bridge.dispose();
  assert.equal(h2.terminal.setProgramStatus, h2.original);
});

// Same public wrapping behavior as pi-herdr-ask, without a runtime dependency.
function questionnaire(terminal: { setProgramStatus(s: ProgramStatus): void }) {
  const original = terminal.setProgramStatus;
  let native: ProgramStatus = { state: "idle", app: "pi" };
  let pending = false;
  terminal.setProgramStatus = (s) => {
    native = { ...s };
    original.call(terminal, pending && s.state !== "blocked" && s.state !== "clear"
      ? { state: "blocked", app: "pi", kind: "question" } : s);
  };
  return (active: boolean) => {
    pending = active;
    original.call(terminal, active && native.state !== "blocked"
      ? { state: "blocked", app: "pi", kind: "question" } : { ...native });
  };
}

test("questionnaire wrapper preserves precedence and recovery in either installation order", () => {
  for (const questionFirst of [true, false]) {
    const reports: ProgramStatus[] = [];
    const terminal = { setProgramStatus: (s: ProgramStatus) => { reports.push(s); } };
    let ask = questionFirst ? questionnaire(terminal) : undefined;
    const bridge = attachHerdrStatusBridge(terminal, { state: "idle", app: "pi" });
    ask ??= questionnaire(terminal);
    terminal.setProgramStatus({ state: "done", app: "pi", message: "session" });
    bridge.setActivity(2);
    ask(true);
    bridge.setActivity(1);
    assert.equal(reports.at(-1)?.state, "blocked");
    ask(false);
    assert.equal(reports.at(-1)?.message, "正在工作的 subagent：1");
    bridge.setActivity(0);
    assert.deepEqual(reports.at(-1), { state: "done", app: "pi", message: "session" });
    bridge.dispose();
  }
});

test("invalid counts cannot generate bogus working reports or duplicate activity writes", () => {
  const h = fixture();
  h.bridge.setActivity(2);
  const n = h.reports.length;
  h.bridge.setActivity(2);
  assert.equal(h.reports.length, n);
  for (const count of [-1, NaN, Infinity, 1.5]) {
    h.bridge.setActivity(count);
    assert.equal(h.last()?.state, "idle");
  }
});
