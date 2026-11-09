import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createRollingUsageController, formatRollingUsage } from "../src/rolling-token-usage.ts";
import { collectUsage } from "../vendor/pi-token-usage/collector.ts";
import { aggregate } from "../vendor/pi-token-usage/query.ts";
import type { UsageReport } from "../vendor/pi-token-usage/types.ts";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const range = { start: NOW - 86400000, end: NOW, amount: 24, unit: "h" as const };
const usage = (totalTokens = 0) => ({ input: 0, output: totalTokens, cacheRead: 0, cacheWrite: 0, totalTokens });
function report(total = 0): UsageReport {
  return { range, usage: usage(total), models: [], warnings: [], recordCount: total ? 1 : 0 };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function context(provider = "a", mode = "tui"): ExtensionContext {
  return { mode, hasUI: true, scopedModels: [], modelRegistry: { getAvailable: () => [{ provider, id: "m" }] },
    sessionManager: { getSessionDir: () => "/custom/sessions" } } as unknown as ExtensionContext;
}

test("format uses one aggregate cache ratio and compact totals without 24h text", () => {
  const r = report(12_300_000);
  r.usage = { input: 1_000_000, cacheRead: 8_520_000, cacheWrite: 480_000, output: 2_300_000, totalTokens: 12_300_000 };
  assert.equal(formatRollingUsage(r), "12.3M CH 85.2%");
  assert.equal(formatRollingUsage(), "…");
  assert.equal(formatRollingUsage(report()), "0 CH —");
  assert.equal(formatRollingUsage(undefined, true), "unavailable");
  r.warnings.push("partial scan");
  assert.equal(formatRollingUsage(r), "~12.3M CH 85.2%");
  const weighted = aggregate([
    { key: "1", timestamp: NOW, source: "a", kind: "assistant", usage: { ...usage(100), input: 10, cacheRead: 90 } },
    { key: "2", timestamp: NOW, source: "a", kind: "assistant", usage: { ...usage(900), input: 900 } },
  ], range);
  assert.equal(formatRollingUsage(weighted), "1.0K CH 9.0%");
});

test("controller freezes model scope, roots and cutoff, then coalesces events and periodic updates", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: NOW });
  const calls: Parameters<typeof collectUsage>[0][] = [];
  let changed = 0;
  const controller = createRollingUsageController({ agentDir: "/agent", collect: async options => {
    calls.push(options); return report(calls.length * 100);
  } });
  t.after(() => controller.dispose());
  const ctx = context();
  controller.start(ctx, () => changed++);
  assert.equal(controller.getText(), "…");
  await flush();
  assert.equal(controller.getText(), "100 CH —");
  assert.deepEqual(calls[0].roots, ["/agent/sessions", "/custom/sessions"]);
  assert.deepEqual(calls[0].allowedModels, [{ provider: "a", id: "m" }]);
  assert.equal(calls[0].cacheDir, "/agent/pi-token-usage/cache-v1");
  assert.deepEqual(calls[0].range, range);
  controller.refresh(ctx); controller.refresh(ctx); controller.refresh(ctx);
  t.mock.timers.tick(250); await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].memoryCache, calls[1].memoryCache);
  t.mock.timers.tick(60000); await flush();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].range.end, NOW + 60250);
  assert.ok(changed >= 3);
  controller.dispose();
  t.mock.timers.tick(120000); await flush();
  assert.equal(calls.length, 3);
});

test("slow scans remain single-flight and stale session/model results are never published", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pending: Array<(r: UsageReport) => void> = [];
  const calls: Parameters<typeof collectUsage>[0][] = [];
  const controller = createRollingUsageController({ agentDir: "/agent", collect: options => {
    calls.push(options); return new Promise(resolve => pending.push(resolve));
  } });
  t.after(() => controller.dispose());
  const a = context(), b = context("b");
  controller.start(a, () => {});
  controller.refresh(a); controller.refresh(a);
  controller.start(b, () => {});
  assert.equal(calls.length, 1);
  pending.shift()!(report(999)); await flush();
  assert.equal(controller.getText(), "…");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].allowedModels, [{ provider: "b", id: "m" }]);
  pending.shift()!(report(200)); await flush();
  assert.equal(controller.getText(), "200 CH —");
  b.scopedModels = [{ model: { provider: "scoped", id: "only" } }] as unknown as ExtensionContext["scopedModels"];
  controller.refresh(b); t.mock.timers.tick(250);
  assert.deepEqual(calls[2].allowedModels, [{ provider: "scoped", id: "only" }]);
  controller.dispose(); pending.shift()!(report(333)); await flush();
  assert.equal(controller.getText(), "…");
});

test("failure is visibly unavailable, then recovers; non-TUI never scans", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let calls = 0;
  const controller = createRollingUsageController({ agentDir: "/agent", collect: async () => {
    if (++calls === 1) throw Error("cannot scan"); return report(42);
  } });
  t.after(() => controller.dispose());
  controller.start(context("a", "rpc"), () => {});
  assert.equal(calls, 0);
  const ctx = context(); controller.start(ctx, () => {}); await flush();
  assert.equal(controller.getText(), "unavailable");
  controller.refresh(ctx); t.mock.timers.tick(250); await flush();
  assert.equal(controller.getText(), "42 CH —");
});

test("temporary model catalogue failure invalidates stale scans but the next refresh recovers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let broken = false;
  const ctx = context();
  ctx.modelRegistry.getAvailable = () => {
    if (broken) throw Error("catalogue unavailable");
    return [{ provider: "a", id: "m" }] as ReturnType<ExtensionContext["modelRegistry"]["getAvailable"]>;
  };
  const pending: Array<(r: UsageReport) => void> = [];
  const controller = createRollingUsageController({ agentDir: "/agent", collect: () => new Promise(resolve => pending.push(resolve)) });
  t.after(() => controller.dispose());
  controller.start(ctx, () => {});
  broken = true; controller.refresh(ctx);
  pending.shift()!(report(999)); await flush();
  assert.equal(controller.getText(), "unavailable");
  broken = false; controller.refresh(ctx); t.mock.timers.tick(250);
  assert.equal(pending.length, 1);
  pending.shift()!(report(8)); await flush();
  assert.equal(controller.getText(), "8 CH —");
});

test("real collector preserves fork deduplication, child-summary coordination and model filtering", async t => {
  const root = await mkdtemp(join(tmpdir(), "rolling-tokens-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessions = join(root, "sessions"); await mkdir(sessions);
  const child = join(sessions, "child.jsonl");
  const shared = { type: "message", id: "shared", timestamp: new Date(NOW).toISOString(),
    message: { role: "assistant", provider: "a", model: "m", timestamp: NOW, usage: usage(100) } };
  async function save(name: string, entries: unknown[]) {
    await writeFile(join(sessions, name), [{ type: "session", version: 3, id: name, cwd: root, timestamp: new Date(NOW - 1000).toISOString() }, ...entries]
      .map(x => JSON.stringify(x)).join("\n") + "\n");
  }
  await save("parent.jsonl", [shared, { type: "message", id: "summary", timestamp: new Date(NOW).toISOString(),
    message: { role: "toolResult", toolName: "subagent", provider: "a", model: "m", usage: usage(50),
      details: { results: [{ sessionFile: child, provider: "a", model: "m", usage: usage(50) }] } } }]);
  await save("fork.jsonl", [shared]);
  await save("child.jsonl", [{ ...shared, id: "own", message: { ...shared.message, usage: usage(50) } }]);
  await save("excluded.jsonl", [{ ...shared, id: "excluded", message: { ...shared.message, provider: "b", usage: usage(999) } }]);
  const result = await collectUsage({ roots: [sessions, sessions], cacheDir: join(root, "cache"), range, allowedModels: [{ provider: "a", id: "m" }] });
  assert.equal(result.usage.totalTokens, 150);
  assert.equal(result.scope, "current-models");
});
