import assert from "node:assert/strict";
import { test } from "node:test";
import { formatProgramStatus, type ProgramStatus } from "@earendil-works/pi-tui";
import { attachHerdrStatusBridge } from "../src/herdr-status-bridge.ts";

const { ProgramStatusReporter } = await import(new URL(
  "./modes/interactive/program-status-reporter.js",
  import.meta.resolve("@earendil-works/pi-coding-agent"),
).href);

test("real Pi reporter dedup cannot leave done while children run or stale working after completion", () => {
  const reports: ProgramStatus[] = [];
  const wire: string[] = [];
  const terminal = { setProgramStatus: (s: ProgramStatus) => { reports.push(s); wire.push(formatProgramStatus(s)); } };
  const reporter = new ProgramStatusReporter(() => terminal, () => "parent");
  reporter.report();
  const bridge = attachHerdrStatusBridge(terminal, { state: "idle", app: "pi" });
  reporter.handleEvent({ type: "agent_start" });
  bridge.setActivity(2);
  reporter.handleEvent({ type: "agent_settled", aborted: false });
  assert.deepEqual(reports.at(-1), { state: "working", app: "pi", message: "正在工作的 subagent：2" });
  const before = wire.length;
  reporter.report();
  assert.equal(wire.length, before, "native reporter deduplicates settled state");
  bridge.setActivity(1);
  reporter.setBlocked("login", { kind: "auth", message: "Login" });
  assert.equal(reports.at(-1)?.kind, "auth");
  reporter.setBlocked("login", undefined);
  assert.equal(reports.at(-1)?.state, "working");
  bridge.setActivity(0);
  assert.deepEqual(reports.at(-1), { state: "done", message: "parent", app: "pi" });
  assert.equal(wire.at(-1), "\x1b]7501;state=done:app=pi:msg=cGFyZW50\x1b\\");
  bridge.dispose();
});
