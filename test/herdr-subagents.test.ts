import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProgramStatus } from "@earendil-works/pi-tui";
import install from "../src/herdr-subagents.ts";

const snapshot = (count: number) => ({
  kind: "pi-subagents.async-status-snapshot", version: 1, generatedAt: 1000,
  caps: { maxRuns: 32, maxDepth: 4, maxChildrenPerNode: 32, maxStringLength: 256, maxSerializedBytes: 65536 },
  omitted: { runs: 0, children: 0, byteLimitExceeded: false },
  runs: count ? [{ id: "run", kind: "subagent", label: "workers", state: "running", startedAt: 1000,
    children: Array.from({ length: count }, (_, index) => ({ id: `step:${index}`, kind: "step", agent: "worker", label: "worker", state: "running", startedAt: 1000 })) }] : [],
});

function fixture(t: TestContext, opts: { mode?: string; tty?: boolean; herdr?: boolean; disabled?: boolean; headlessChild?: boolean } = {}) {
  const env = { HC_TERMINAL_ID: process.env.HC_TERMINAL_ID, PI_PROGRAM_STATUS: process.env.PI_PROGRAM_STATUS, PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD };
  process.env.HC_TERMINAL_ID = opts.herdr === false ? "" : "qa-test";
  if (opts.disabled) process.env.PI_PROGRAM_STATUS = "0"; else delete process.env.PI_PROGRAM_STATUS;
  if (opts.headlessChild) process.env.PI_SUBAGENT_CHILD = "1"; else delete process.env.PI_SUBAGENT_CHILD;
  const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: opts.tty !== false });
  t.after(() => {
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (tty) Object.defineProperty(process.stdout, "isTTY", tty); else Reflect.deleteProperty(process.stdout, "isTTY");
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const bus = new EventEmitter();
  const requests: any[] = [];
  const reports: ProgramStatus[] = [];
  const terminal = { setProgramStatus: (status: ProgramStatus) => { reports.push({ ...status }); } };
  const original = terminal.setProgramStatus;
  const handlers = new Map<string, ((event: any, ctx: any) => any)[]>();
  const widgets = new Map();
  const ctx = {
    mode: opts.mode ?? "tui", hasUI: true, isIdle: () => true,
    sessionManager: { getSessionId: () => "parent", getSessionName: () => "test" },
    ui: { setWidget: (key: string, factory: any) => {
      if (factory) { widgets.set(key, factory); factory({ terminal }); } else widgets.delete(key);
    } },
  };
  install({
    on: (name: string, fn: (event: any, ctx: any) => any) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]); },
    events: { on: (name: string, fn: (...args: any[]) => void) => { bus.on(name, fn); return () => bus.off(name, fn); }, emit: (name: string, value: unknown) => bus.emit(name, value) },
  } as unknown as ExtensionAPI);
  bus.on("subagents:rpc:v1:request", (request) => { assert.equal(request.method, "status", "must never launch or control work"); requests.push(request); });
  const emit = async (name: string, event: any = {}) => {
    for (const fn of handlers.get(name) ?? []) await fn({ type: name, ...event }, ctx);
  };
  t.after(() => emit("session_shutdown", { reason: "quit" }));
  const flush = () => t.mock.timers.tick(250);
  const reply = (request = requests.at(-1), count = 0, extra = {}) => {
    assert.ok(request, "adapter must issue a read-only status request");
    bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, { version: 1, requestId: request.requestId, success: true,
      data: { text: "status", details: { mode: "management", results: [] }, fleet: { version: 1, totalActive: 99, omitted: 0, entries: [] }, asyncSnapshot: snapshot(count) }, ...extra });
  };
  return { bus, requests, terminal, original, reports, ctx, widgets, emit, flush, reply, last: () => reports.at(-1) };
}

test("restores background working on startup and counts 2→1→0 after parent settles", async (t) => {
  const h = fixture(t);
  await h.emit("session_start", { reason: "reload" }); h.flush();
  h.reply(undefined, 2);
  assert.deepEqual(h.last(), { state: "working", app: "pi", message: "正在工作的 subagent：2" });
  h.terminal.setProgramStatus({ state: "done", app: "pi", message: "main" });
  assert.equal(h.last()?.state, "working");
  for (const count of [1, 0]) {
    h.bus.emit("subagent:jobs-changed", { version: 1 }); h.flush(); h.reply(undefined, count);
  }
  assert.deepEqual(h.last(), { state: "done", app: "pi", message: "main" });
  assert.equal(h.widgets.size, 0);
});

test("coalesces events and retains one refresh arriving during an in-flight request", async (t) => {
  const h = fixture(t);
  await h.emit("session_start"); h.flush();
  for (const name of ["subagents:rpc:v1:ready", "subagent:async-started", "subagent:jobs-changed", "subagent:child-status", "subagent:async-complete", "subagent:process-terminal"]) h.bus.emit(name, { version: 1 });
  h.flush();
  assert.equal(h.requests.length, 1);
  h.reply(undefined, 2); h.flush();
  assert.equal(h.requests.length, 2);
  h.reply(undefined, 0); h.flush();
  assert.equal(h.requests.length, 2, "no periodic polling");
});

test("foreground updates count instances; async/workflow updates do not double count", async (t) => {
  const h = fixture(t);
  await h.emit("session_start"); h.flush(); h.reply(undefined, 2);
  const progress = { mode: "parallel", results: [], progress: [{ index: 0, agent: "w", status: "running" }, { index: 1, agent: "w", status: "pending" }] };
  await h.emit("tool_execution_start", { toolName: "subagent", toolCallId: "fg", args: { async: false } });
  await h.emit("tool_execution_update", { toolName: "subagent", toolCallId: "fg", args: { async: false }, partialResult: { details: progress } });
  assert.equal(h.last()?.message, "正在工作的 subagent：3");
  for (const args of [{ async: true }, { script: "return runs.run(...)" }, { workflow: "parallel" }]) {
    await h.emit("tool_execution_update", { toolName: "subagent", toolCallId: "wf", args, partialResult: { details: progress } });
  }
  assert.equal(h.last()?.message, "正在工作的 subagent：3");
  await h.emit("tool_execution_end", { toolName: "subagent", toolCallId: "fg", isError: true });
  assert.equal(h.last()?.message, "正在工作的 subagent：2");
});

test("slash foreground progress counts children and closes on response without counting async slash placeholders", async (t) => {
  const h = fixture(t);
  await h.emit("session_start"); h.flush(); h.reply(undefined, 0);
  h.terminal.setProgramStatus({ state: "idle", app: "pi" });
  h.bus.emit("subagent:slash:request", { requestId: "slash-1", params: { async: false, agent: "worker" } });
  h.bus.emit("subagent:slash:update", { requestId: "slash-1", progress: [{ index: 0, agent: "worker", status: "running" }], toolCount: 0 });
  assert.equal(h.last()?.message, "正在工作的 subagent：1");
  h.bus.emit("subagent:slash:request", { requestId: "slash-2", params: { async: true, agent: "worker" } });
  h.bus.emit("subagent:slash:update", { requestId: "slash-2", progress: [{ index: 0, agent: "worker", status: "running" }], toolCount: 0 });
  assert.equal(h.last()?.message, "正在工作的 subagent：1");
  h.bus.emit("subagent:slash:response", { requestId: "slash-1", isError: true, errorText: "cancelled" });
  assert.equal(h.last()?.state, "idle");
});

test("shutdown detaches listeners/wrapper and ignores replies from an old session", async (t) => {
  const h = fixture(t);
  await h.emit("session_start"); h.flush(); const old = h.requests.at(-1);
  await h.emit("session_shutdown", { reason: "new" });
  assert.equal(h.terminal.setProgramStatus, h.original);
  assert.equal(h.bus.eventNames().length, 1, "only the fixture responder remains");
  await h.emit("session_start", { reason: "new" }); h.flush(); h.reply(undefined, 1);
  h.reply(old, 9);
  assert.equal(h.last()?.message, "正在工作的 subagent：1");
  await h.emit("session_shutdown", { reason: "quit" });
  h.flush();
  assert.equal(h.bus.eventNames().length, 1);
});

test("RPC failure/malformed data/timeout cannot leave stale working forever", async (t) => {
  const h = fixture(t);
  await h.emit("session_start"); h.flush(); h.reply(undefined, 1);
  h.terminal.setProgramStatus({ state: "done", app: "pi" });
  h.bus.emit("subagent:jobs-changed", {}); h.flush(); h.reply(undefined, 0, { success: false, error: { code: "no_active_session", message: "no session" } });
  assert.equal(h.last()?.state, "done");
  h.bus.emit("subagent:jobs-changed", {}); h.flush(); h.reply(undefined, 1);
  h.bus.emit("subagent:jobs-changed", {}); h.flush();
  t.mock.timers.tick(3000);
  assert.equal(h.last()?.state, "done");
  h.bus.emit("subagent:jobs-changed", {}); h.flush(); h.reply(undefined, 0, { data: { asyncSnapshot: null } });
  assert.equal(h.last()?.state, "done");
});

test("blocked/question and native clear cannot be overwritten by refreshes", async (t) => {
  const h = fixture(t);
  await h.emit("session_start"); h.flush();
  h.terminal.setProgramStatus({ state: "blocked", app: "pi", kind: "question" }); h.reply(undefined, 2);
  assert.equal(h.last()?.kind, "question");
  h.terminal.setProgramStatus({ state: "clear" });
  h.bus.emit("subagent:jobs-changed", {}); h.flush(); h.reply(undefined, 1);
  assert.deepEqual(h.last(), { state: "clear" });
});

for (const opts of [{ mode: "rpc" }, { mode: "json" }, { mode: "print" }, { tty: false }, { herdr: false }, { disabled: true }, { headlessChild: true }]) {
  test(`disabled environment has no widget, bus listeners, status or timers: ${JSON.stringify(opts)}`, async (t) => {
    const h = fixture(t, opts);
    await h.emit("session_start"); h.flush();
    assert.equal(h.requests.length, 0);
    assert.equal(h.reports.length, 0);
    assert.equal(h.bus.eventNames().length, 1);
    assert.equal(h.terminal.setProgramStatus, h.original);
  });
}
