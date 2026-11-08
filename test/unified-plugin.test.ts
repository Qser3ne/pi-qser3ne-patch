import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import install from "../src/index.ts";

function fixture(t: TestContext) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-unified-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No network allowed in composition tests"); });
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => any }>();
  const statuses = new Map<string, string>();
  const entries: any[] = [];
  const events = new EventEmitter();
  const programReports: any[] = [];
  const terminal = { setProgramStatus: (status: unknown) => { programReports.push(status); } };
  const ctx = {
    model: { provider: "openai-codex", id: "gpt-6-sol", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api", cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
    mode: "tui", hasUI: true, cwd: agentDir, isIdle: () => true,
    sessionManager: { getBranch: () => entries, getSessionId: () => "test-session", getEntries: () => entries },
    modelRegistry: { getAll: () => [], getAvailable: () => [], getProviderAuth: async () => undefined, getApiKeyAndHeaders: async () => ({ ok: false }) },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (key: string, value?: string) => value === undefined ? statuses.delete(key) : statuses.set(key, value),
      notify: () => {}, setFooter: () => assert.fail("unified plugin must not replace the footer"),
      setWidget: (_key: string, factory: any) => { if (typeof factory === "function") factory({ terminal }); },
    },
  };
  install({
    registerProvider: () => {},
    on: (name: string, handler: (event: any, ctx: any) => any) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => {};
    },
    registerCommand: (name: string, command: { handler: (args: string, ctx: any) => any }) => {
      assert.ok(!commands.has(name), `duplicate command ${name}`);
      commands.set(name, command);
    },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    events: { on: (name: string, handler: (...args: any[]) => void) => { events.on(name, handler); return () => events.off(name, handler); }, emit: (name: string, value: unknown) => events.emit(name, value) },
  } as unknown as ExtensionAPI);
  const emit = async (name: string, event: any = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
  };
  const request = async (payload: any) => {
    for (const handler of handlers.get("before_provider_request") ?? []) {
      payload = await handler({ type: "before_provider_request", payload }, ctx) ?? payload;
    }
    return payload;
  };
  t.after(async () => {
    await emit("session_shutdown", { reason: "quit" });
    rmSync(agentDir, { recursive: true, force: true });
  });
  return { ctx, commands, statuses, entries, emit, request, events, terminal, programReports, advance: (ms: number) => { now += ms; } };
}

test("unified entry retains herdr background activity alongside existing feature lifecycles", async (t) => {
  const previous = process.env.HC_TERMINAL_ID;
  const previousStatus = process.env.PI_PROGRAM_STATUS;
  const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  process.env.HC_TERMINAL_ID = "composition";
  delete process.env.PI_PROGRAM_STATUS;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  t.after(() => {
    if (previous === undefined) delete process.env.HC_TERMINAL_ID; else process.env.HC_TERMINAL_ID = previous;
    if (previousStatus === undefined) delete process.env.PI_PROGRAM_STATUS; else process.env.PI_PROGRAM_STATUS = previousStatus;
    if (tty) Object.defineProperty(process.stdout, "isTTY", tty); else Reflect.deleteProperty(process.stdout, "isTTY");
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = fixture(t);
  h.events.on("subagents:rpc:v1:request", (request) => h.events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
    version: 1, requestId: request.requestId, success: true,
    data: { asyncSnapshot: {
      kind: "pi-subagents.async-status-snapshot", version: 1,
      omitted: { runs: 0, children: 0, byteLimitExceeded: false },
      runs: [{ id: "child", kind: "subagent", state: "running", label: "worker" }],
    } },
  }));
  await h.emit("session_start", { reason: "reload" });
  t.mock.timers.tick(25);
  h.terminal.setProgramStatus({ state: "done", app: "pi" });
  assert.deepEqual(h.programReports.at(-1), { state: "working", app: "pi", message: "正在工作的 subagent：1" });
  assert.ok(h.commands.has("daybreak") && h.commands.has("fast"));
  await h.emit("session_shutdown", { reason: "reload" });
  assert.deepEqual(h.programReports.at(-1), { state: "done", app: "pi" });
  assert.equal(h.statuses.size, 0);
});

test("unified entry composes Daybreak and Fast routing without losing request fields", async (t) => {
  const h = fixture(t);
  assert.ok(h.commands.has("daybreak"), "unified entry must initialize Daybreak");
  assert.ok(h.commands.has("fast"), "unified entry must initialize pi-usage");
  await h.commands.get("daybreak")!.handler("on", h.ctx);
  const payload = Object.freeze({ model: "gpt-6-sol", input: [], tools: [], service_tier: "auto", access_programs: { another: "keep" } });
  const rewritten = await h.request(payload);
  assert.deepEqual(rewritten.access_programs, { another: "keep", cyber: "daybreak_blue" });
  assert.equal(rewritten.service_tier, "default", "Fast disabled selects standard routing without discarding Daybreak");
  assert.equal(rewritten.input, payload.input);
  assert.equal(rewritten.tools, payload.tools);
  assert.equal(payload.service_tier, "auto");
  await h.emit("provider_stream_event", { provider: "openai-codex", model: "gpt-6-sol", data: { type: "response.completed", response: { status: "completed", access_programs: { cyber: "daybreak_blue" } } } });
  assert.match(h.statuses.get("daybreak")!, /active$/);
  await h.commands.get("daybreak")!.handler("off", h.ctx);
  assert.equal((await h.request({ model: "gpt-6-sol", input: [] })).access_programs, undefined);
  h.ctx.model.baseUrl = "https://proxy.example/codex";
  assert.equal(await h.request(payload), payload, "neither feature should modify proxy requests");
});

test("unified entry retains token timing and all shutdown handlers", async (t) => {
  const h = fixture(t);
  await h.request({ model: "gpt-6-sol", input: [] });
  h.advance(100);
  const message = { role: "assistant", provider: "openai-codex", model: "gpt-6-sol", usage: { output: 20 }, stopReason: "stop" };
  await h.emit("message_start", { message });
  h.advance(700);
  await h.emit("message_update", { assistantMessageEvent: { type: "text_delta", delta: "hello" } });
  assert.match(h.statuses.get("token-speed") ?? "", /TTFT 800ms/);
  h.advance(500);
  await h.emit("message_update", { assistantMessageEvent: { type: "text_delta", delta: "world" } });
  await h.emit("message_end", { message });
  assert.match(h.statuses.get("token-speed")!, /40\.0 tok\/s/);
  await h.emit("session_shutdown", { reason: "reload" });
  assert.equal(h.statuses.size, 0);
});

test("unified lifecycle restores old Daybreak branch entries without broadening provider support", async (t) => {
  const h = fixture(t);
  h.entries.push({ type: "custom", customType: "daybreak-blue-state", data: { version: 1, enabled: true } });
  h.ctx.model.provider = "test-provider";
  await h.emit("session_start", { reason: "resume" });
  assert.match(h.statuses.get("daybreak") ?? "", /unavailable$/);
  h.ctx.model.provider = "openai-codex-1";
  assert.equal((await h.request({ model: "gpt-6-sol", input: [] })).access_programs, undefined);
  h.ctx.model.provider = "openai-codex";
  assert.equal((await h.request({ model: "gpt-6-sol", input: [] })).access_programs.cyber, "daybreak_blue");
  h.ctx.mode = "rpc";
  await h.emit("message_start", { message: { role: "assistant" } });
  assert.equal(h.statuses.has("token-speed"), false);
});
