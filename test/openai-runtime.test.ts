import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createRuntime } from "../src/runtime.ts";
import { normalizeSettings } from "../src/settings.ts";

const NOW = 1_800_000_000_000;
const quota = { rate_limit: { primary_window: { used_percent: 23, limit_window_seconds: 18000, reset_at: NOW / 1000 + 3600 } } };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
const jwt = (id: string) => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: id } })).toString("base64url")}.signature`;

function fixture() {
  const agentDir = mkdtempSync(join(tmpdir(), "openai-usage-test-"));
  let now = NOW;
  let source = "OAuth";
  const credentials: Record<string, Record<string, unknown>> = {
    "openai-codex": { type: "oauth", access: jwt("account-a"), refresh: "secret-refresh", expires: NOW + 3600000, accountId: "account-a" },
    openai: { type: "oauth", access: "native-secret", refresh: "native-refresh", expires: NOW + 3600000, clientId: "pi-client", scopes: ["chatgpt.tokens.use.direct"] },
  };
  const timers = new Set<{ fn: () => void; due: number }>();
  const statuses: Array<string | undefined> = [];
  const notifications: Array<{ text: string; level: string }> = [];
  const calls: Array<{ url: string; signal?: AbortSignal | null; headers?: RequestInit["headers"] }> = [];
  let respond = async (_url: string, _init?: RequestInit) => Response.json(quota);
  const ctx = {
    model: { provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api" },
    ui: {
      setStatus: (key: string, text?: string) => { assert.equal(key, "sub2api-usage"); statuses.push(text); },
      notify: (text: string, level: string) => notifications.push({ text, level }),
    },
    modelRegistry: {
      getProviderAuth: async (id: string) => ({ source, auth: { apiKey: credentials[id]?.access } }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: credentials[ctx.model.provider]?.access }),
    },
  };
  const runtime = createRuntime({
    agentDir, now: () => now,
    readCredential: (id) => credentials[id],
    fetchImpl: (async (url, init) => { calls.push({ url: String(url), signal: init?.signal, headers: init?.headers }); return respond(String(url), init); }) as typeof fetch,
    setTimeoutImpl: ((fn: () => void, delay: number) => {
      const timer = { fn, due: now + delay, unref: () => {} }; timers.add(timer); return timer;
    }) as unknown as typeof setTimeout,
    clearTimeoutImpl: ((timer: { fn: () => void; due: number }) => timers.delete(timer)) as unknown as typeof clearTimeout,
  });
  const context = ctx as unknown as ExtensionContext;
  return {
    ctx, context, credentials, runtime, calls, statuses, notifications, timers,
    settings(value: unknown) { writeFileSync(join(agentDir, "pi-sub2api-usage.json"), JSON.stringify(value)); },
    setSource(value: string) { source = value; },
    respond(fn: typeof respond) { respond = fn; },
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers]) if (timer.due <= now && timers.delete(timer)) timer.fn();
    },
    event() { runtime.handleEvent(context, ctx.model); },
    manual() { return runtime.runManualCheck(context as ExtensionCommandContext); },
    close() { runtime.shutdown(context); rmSync(agentDir, { recursive: true, force: true }); },
  };
}

test("OpenAI companion requires explicit boolean opt-in; malformed configuration fails closed", () => {
  assert.equal(normalizeSettings({}).openai.useCodex, false);
  for (const value of [null, false, "true", [], { useCodex: "true" }]) assert.equal(normalizeSettings({ openai: value }).openai.useCodex, false);
  assert.equal(normalizeSettings({ openai: { useCodex: true } }).openai.useCodex, true);
});

test("Codex publishes compatible status, revalidates cache hits, and manual refresh restarts timers", async () => {
  const f = fixture();
  try {
    f.event(); await settle();
    assert.equal(f.statuses.at(-1), "📊 openai-codex 5h 77% ↻ 1h0m");
    f.event(); await settle();
    assert.equal(f.calls.length, 1);
    f.advance(60000); await settle();
    assert.equal(f.calls.length, 1);
    assert.match(f.statuses.at(-1)!, /59m/);
    await f.manual();
    assert.equal(f.calls.length, 2);
    assert.ok(f.notifications.at(-1)?.text.includes('"usedPercent": 23'));
    f.advance(180000); await settle();
    assert.equal(f.calls.length, 3, "automatic refresh must survive a manual query");
  } finally { f.close(); }
});

test("switching OAuth account within TTL never reuses the old account's quota", async () => {
  const f = fixture();
  try {
    f.event(); await settle();
    f.credentials["openai-codex"] = { ...f.credentials["openai-codex"], access: jwt("account-b"), accountId: "account-b" };
    f.respond(async () => Response.json({ rate_limit: { primary_window: { ...quota.rate_limit.primary_window, used_percent: 90 } } }));
    f.event(); await settle();
    assert.equal(f.calls.length, 2);
    assert.match(f.statuses.at(-1)!, /10%/);
    f.setSource("OPENAI_API_KEY");
    f.event(); await settle();
    assert.equal(f.calls.length, 2);
    assert.match(f.statuses.at(-1)!, /error:.*API keys/);
    assert.ok(!f.statuses.at(-1)?.includes("10%"));
  } finally { f.close(); }
});

test("HTTP failures back off for 30s, manual refresh bypasses backoff, and success recovers", async () => {
  const f = fixture();
  try {
    f.respond(async () => new Response("secret-server-body", { status: 401 }));
    f.event(); await settle();
    assert.equal(f.calls.length, 1);
    assert.match(f.statuses.at(-1)!, /HTTP 401/);
    f.event(); await settle();
    assert.equal(f.calls.length, 1);
    f.respond(async () => Response.json(quota));
    await f.manual();
    assert.equal(f.calls.length, 2);
    assert.match(f.statuses.at(-1)!, /77%/);
    assert.ok(!JSON.stringify(f.statuses).includes("secret-server-body"));
  } finally { f.close(); }
});

test("native OpenAI without companion shows an honest connected status and makes no backend requests", async () => {
  const f = fixture();
  try {
    f.ctx.model = { provider: "openai", baseUrl: "https://api.openai.com/v1" };
    f.event(); await settle();
    assert.match(f.statuses.at(-1)!, /ChatGPT connected; quota needs Codex companion/);
    assert.equal(f.calls.length, 0);
    await f.manual();
    assert.match(f.notifications.at(-1)!.text, /same ChatGPT account\/workspace/);
  } finally { f.close(); }
});

test("native OpenAI opt-in queries separate app/plan windows; disabling it removes numerical quota", async () => {
  const f = fixture();
  try {
    f.ctx.model = { provider: "openai", baseUrl: "https://api.openai.com/v1" };
    f.settings({ openai: { useCodex: true } });
    f.respond(async (url) => Response.json(url.endsWith("/apps") ? { items: [{ id: "pi-client", windows: [{ ...quota.rate_limit.primary_window, used_percent: 80 }] }] } : quota));
    f.event(); await settle();
    assert.equal(f.calls.length, 2);
    assert.match(f.statuses.at(-1)!, /plan 5h 77%.*app 5h 20%/);
    f.settings({ openai: { useCodex: false } });
    f.event(); await settle();
    assert.equal(f.calls.length, 2);
    assert.ok(!f.statuses.at(-1)?.includes("%"));
  } finally { f.close(); }
});

test("switching away cancels in-flight OpenAI results and leaves pi-usage's status key untouched", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    f.respond(async () => { await gate; return Response.json(quota); });
    f.event(); await settle();
    assert.equal(f.calls.length, 1);
    f.ctx.model.provider = "plain";
    f.event();
    assert.equal(f.calls[0].signal?.aborted, true);
    release(); await settle();
    assert.equal(f.statuses.at(-1), undefined);
    assert.equal(f.timers.size, 0);
  } finally { release(); f.close(); }
});

test("two Codex providers query different accounts and never reuse another provider's quota", async () => {
  const f = fixture();
  try {
    f.credentials["openai-codex-1"] = { ...f.credentials["openai-codex"], access: jwt("account-b"), accountId: "account-b", refresh: "second-refresh" };
    f.respond(async (_url, init) => {
      const account = new Headers(init?.headers).get("ChatGPT-Account-Id");
      return Response.json({ rate_limit: { primary_window: { ...quota.rate_limit.primary_window, used_percent: account === "account-b" ? 80 : 23 } } });
    });
    f.event(); await settle();
    assert.match(f.statuses.at(-1)!, /openai-codex 5h 77%/);
    f.ctx.model.provider = "openai-codex-1";
    f.event(); await settle();
    assert.match(f.statuses.at(-1)!, /openai-codex-1 5h 20%/);
    assert.equal(new Headers(f.calls[1].headers).get("ChatGPT-Account-Id"), "account-b");
    assert.equal(new Headers(f.calls[1].headers).get("Authorization"), `Bearer ${jwt("account-b")}`);
    f.ctx.model.provider = "openai-codex";
    f.event(); await settle();
    assert.match(f.statuses.at(-1)!, /openai-codex 5h 77%/);
    assert.equal(new Headers(f.calls.at(-1)?.headers).get("ChatGPT-Account-Id"), "account-a");
  } finally { f.close(); }
});

test("missing second-account login never falls back to the first; 401 names the correct login", async () => {
  const f = fixture();
  try {
    f.ctx.model.provider = "openai-codex-1";
    f.event(); await settle();
    assert.equal(f.calls.length, 0);
    assert.match(f.statuses.at(-1)!, /error:.*openai-codex-1 login/);
    f.credentials["openai-codex-1"] = { ...f.credentials["openai-codex"], access: jwt("account-b"), accountId: "account-b" };
    f.respond(async () => new Response("", { status: 401 }));
    await f.manual();
    assert.match(f.statuses.at(-1)!, /reconnect with \/login openai-codex-1/);
    f.ctx.model.provider = "openai-codex";
    f.respond(async () => Response.json(quota));
    f.event(); await settle();
    assert.match(f.statuses.at(-1)!, /openai-codex 5h 77%/);
  } finally { f.close(); }
});

test("rapid turns reuse an in-flight quota request instead of repeatedly aborting it", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    f.respond(async (_url, init) => {
      await gate;
      init?.signal?.throwIfAborted();
      return Response.json(quota);
    });
    f.event(); await settle();
    for (let i = 0; i < 5; i++) { f.event(); await settle(); }
    assert.equal(f.calls.length, 1, "turn_start must not restart the same slow quota request");
    assert.equal(f.calls[0].signal?.aborted, false);
    release(); await settle();
    assert.match(f.statuses.at(-1)!, /77%/);
  } finally { release(); f.close(); }
});

test("a login change during a coalesced request never publishes the previous account's quota", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    f.respond(async () => { await gate; return Response.json(quota); });
    f.event(); await settle();
    f.credentials["openai-codex"] = { ...f.credentials["openai-codex"], access: jwt("account-b"), accountId: "account-b" };
    f.event(); await settle();
    assert.equal(f.calls.length, 1);
    release(); await settle();
    assert.match(f.statuses.at(-1)!, /OAuth login changed/);
    assert.ok(!f.statuses.at(-1)!.includes("%"));
    await f.manual();
    assert.equal(new Headers(f.calls.at(-1)?.headers).get("ChatGPT-Account-Id"), "account-b");
    assert.match(f.statuses.at(-1)!, /77%/);
  } finally { release(); f.close(); }
});

test("manual refresh and model changes still cancel a pending quota request", async () => {
  for (const mode of ["manual", "model", "session"]) {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      let calls = 0;
      f.respond(async (_url, init) => {
        if (++calls === 1) await gate;
        init?.signal?.throwIfAborted();
        return Response.json(quota);
      });
      f.event(); await settle();
      if (mode === "manual") await f.manual();
      else if (mode === "model") { f.ctx.model = { ...f.ctx.model }; f.event(); }
      else {
        const newContext = { ...f.context, sessionManager: {} as ExtensionContext["sessionManager"] };
        f.runtime.handleEvent(newContext, f.ctx.model);
      }
      await settle();
      assert.equal(f.calls.length, 2);
      assert.equal(f.calls[0].signal?.aborted, true);
      release(); await settle();
      assert.match(f.statuses.at(-1)!, /77%/);
    } finally { release(); f.close(); }
  }
});

test("shutdown aborts requests, clears timers, and repeated shutdown is harmless", async () => {
  const f = fixture();
  try {
    f.event(); await settle();
    assert.equal(f.timers.size, 2);
    f.runtime.shutdown(f.context);
    f.runtime.shutdown(f.context);
    assert.equal(f.timers.size, 0);
    const count = f.calls.length;
    f.advance(360000); await settle();
    assert.equal(f.calls.length, count);
    assert.equal(f.statuses.at(-1), undefined);
  } finally { f.close(); }
});
