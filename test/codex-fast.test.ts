import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { calculateCost, normalizeContext } from "@earendil-works/pi-ai";
import { createCodexAccountProvider } from "../src/codex-accounts.ts";
import {
  codexFastAvailability, rewriteCodexFastPayload, resolveCodexResetAuth,
  registerCodexFastMode, createCodexFastCatalog,
} from "../vendor/pi-usage/index.ts";

const ALIAS = "openai-codex-1";
// Generated upstream JS infers the unknown capability's reason as required.
const SUPPORTED = { kind: "supported", reason: "" };
const jwt = (id: string) => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: id } })).toString("base64url")}.signature`;
const credential = (id: string) => ({ type: "oauth" as const, access: jwt(id), refresh: `refresh-${id}`, accountId: id, expires: Date.now() + 3600000 });
const aliasModel = () => ({
  provider: ALIAS, id: "gpt-6.1-sol", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api/codex",
  name: "GPT 6.1 Sol", reasoning: true, input: ["text"], contextWindow: 272000, maxTokens: 128000,
  cost: { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 0 },
});
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };

function fixture() {
  const credentials: Record<string, ReturnType<typeof credential> | undefined> = {
    "openai-codex": credential("first"), [ALIAS]: credential("second"),
  };
  const requestedIds: string[] = [];
  const candidateIds: string[] = [];
  const notifications: Array<{ text: string; level: string }> = [];
  const statuses: Array<string | undefined> = [];
  const handlers = new Map<string, Array<(...args: any[]) => any>>();
  const commands = new Map<string, { handler: (...args: any[]) => any }>();
  let enabled = false;
  const updates: boolean[] = [];
  let sessionId = "session-1";
  const ctx = {
    model: aliasModel(), hasUI: true,
    sessionManager: { getSessionId: () => sessionId },
    ui: {
      notify: (text: string, level: string) => notifications.push({ text, level }),
      setStatus: (key: string, text?: string) => { assert.equal(key, "qser3ne-codex-fast"); statuses.push(text); },
    },
    modelRegistry: {
      getAll: () => [ctx.model], getAvailable: () => [ctx.model],
      getProviderAuth: async (id: string) => { requestedIds.push(id); return credentials[id] ? { source: "OAuth", auth: { apiKey: credentials[id]!.access } } : undefined; },
      getApiKeyAndHeaders: async (model: { provider: string }) => ({ ok: true, apiKey: credentials[model.provider]?.access }),
    },
  };
  const candidateReader = Object.assign(async (_ctx: unknown, id: string) => {
    candidateIds.push(id);
    return { ok: true, candidates: credentials[id] ? [credentials[id]] : [], offeredCount: 0 };
  }, { waitUntilReady: async (_ctx: unknown, id: string) => { candidateIds.push(id); return true; } });
  const settings = {
    get: () => ({ kind: "valid", settings: { codexFastMode: enabled } }),
    update: async (patch: { codexFastMode: boolean }) => { enabled = patch.codexFastMode; updates.push(enabled); },
    reload: async () => settings.get(), flush: async () => {},
  };
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    registerCommand(name: string, command: { handler: (...args: any[]) => any }) { commands.set(name, command); },
  } as unknown as ExtensionAPI;
  const context = ctx as unknown as ExtensionContext;
  const fast = registerCodexFastMode(pi, settings, () => {}, {
    registerSessionStart: false, candidateReader, timeoutMs: 1000,
    fetchImpl: (url: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(url, init),
    credentialReader: () => { throw Error("must use candidates scoped to the selected provider"); },
  });
  return {
    ctx, context, credentials, candidateReader, requestedIds, candidateIds, notifications, statuses, updates, fast,
    enabled: () => enabled,
    command: (args = "") => commands.get("fast")!.handler(args, ctx),
    async request(payload: unknown) { return handlers.get("before_provider_request")![0]({ payload }, ctx); },
    message(message: unknown) { return handlers.get("message_end")![0]({ message }, ctx); },
    session(id: string) { sessionId = id; },
    async close() { for (const h of handlers.get("session_shutdown") ?? []) await h({}, ctx); },
  };
}

const directory = (supported: boolean) => Response.json({ models: [{ slug: "gpt-6.1-sol", service_tiers: supported ? [{ id: "priority" }] : [] }] });

test("Fast recognizes both official Codex providers, but not native OpenAI or proxies", () => {
  for (const provider of ["openai-codex", ALIAS]) {
    const model = { ...aliasModel(), provider };
    assert.deepEqual(codexFastAvailability(model, true, SUPPORTED), { kind: "available", enabled: true });
    const payload = { model: model.id, input: [], service_tier: "auto" };
    assert.equal(rewriteCodexFastPayload(payload, model, true, SUPPORTED).service_tier, "priority");
    assert.equal(rewriteCodexFastPayload(payload, model, false, SUPPORTED).service_tier, "default");
    assert.equal(rewriteCodexFastPayload(payload, model, true, { kind: "unknown", reason: "test" }).service_tier, "default");
    assert.equal(payload.service_tier, "auto");
  }
  for (const patch of [{ provider: "openai" }, { baseUrl: "https://proxy.example/codex" }, { api: "openai-responses" }, { provider: "openai-codex-2" }]) {
    assert.equal(rewriteCodexFastPayload({}, { ...aliasModel(), ...patch }, true, SUPPORTED), undefined);
  }
});

test("Fast auth and directory use only the selected account, never primary credentials", async () => {
  const f = fixture();
  try {
    const auth = await resolveCodexResetAuth(f.context, undefined, () => { throw Error("no primary fallback"); }, f.candidateReader);
    assert.equal(auth.headers.Authorization, `Bearer ${jwt("second")}`);
    assert.equal(auth.headers["chatgpt-account-id"], "second");
    assert.ok(f.requestedIds.every((id) => id === ALIAS));
    assert.ok(f.candidateIds.every((id) => id === ALIAS));
    delete f.credentials[ALIAS];
    await assert.rejects(resolveCodexResetAuth(f.context, undefined, () => f.credentials["openai-codex"], f.candidateReader), /No runtime credential/);
  } finally { await f.close(); }
});

test("the original /fast toggles alias priority/default routing and corrects Fast cost", async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ account: string | null; token: string | null }> = [];
  globalThis.fetch = (async (url, init) => {
    assert.match(String(url), /^https:\/\/chatgpt.com\/backend-api\/codex\/models\?/);
    requests.push({ account: new Headers(init?.headers).get("chatgpt-account-id"), token: new Headers(init?.headers).get("Authorization") });
    return directory(true);
  }) as typeof fetch;
  try {
    await f.command();
    assert.equal(f.enabled(), true);
    assert.equal(f.statuses.at(-1), "⚡ fast");
    assert.deepEqual(f.updates, [true]);
    assert.match(f.notifications.at(-1)!.text, /Fast mode enabled/);
    assert.equal((await f.request({ model: "gpt-6.1-sol", input: [] })).service_tier, "priority");
    const provider = createCodexAccountProvider();
    const model = provider.getModels().find((m) => m.id === "gpt-6.1-sol")!;
    const controller = new AbortController();
    let actualTier: unknown;
    const result = await provider.streamSimple(model, normalizeContext({ messages: [] }), {
      apiKey: jwt("second"), signal: controller.signal,
      async onPayload(payload, selected) {
        assert.equal(selected.provider, ALIAS);
        const rewritten = await f.request(payload);
        actualTier = rewritten.service_tier;
        controller.abort(); // Inspect the native payload without sending an inference request.
        return rewritten;
      },
    }).result();
    assert.equal(actualTier, "priority");
    assert.equal(result.stopReason, "aborted");
    const usage = { input: 100, output: 50, cacheRead: 20, cacheWrite: 0, totalTokens: 170, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    calculateCost(f.ctx.model as never, usage);
    const message = { role: "assistant", provider: ALIAS, model: "gpt-6.1-sol", usage };
    const corrected = f.message(message);
    assert.ok(corrected);
    assert.equal(corrected.message.provider, ALIAS);
    assert.equal(corrected.message.usage.cost.total, usage.cost.total * 2);
    assert.equal(f.message(message), undefined, "a request must not be billed twice");
    await f.command();
    assert.equal(f.enabled(), false);
    assert.equal(f.statuses.at(-1), undefined);
    assert.equal((await f.request({ model: "gpt-6.1-sol" })).service_tier, "default");
    assert.ok(requests.length > 0);
    assert.ok(requests.every((r) => r.account === "second" && r.token === `Bearer ${jwt("second")}`));
  } finally { await f.close(); globalThis.fetch = originalFetch; }
});

test("unsupported models and custom auth cannot enable Fast", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => directory(false)) as typeof fetch;
  const f = fixture();
  try {
    await f.command();
    assert.equal(f.enabled(), false);
    assert.deepEqual(f.updates, []);
    assert.match(f.notifications.at(-1)!.text, /does not advertise/);
    f.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: jwt("first") });
    await assert.rejects(resolveCodexResetAuth(f.context, undefined, () => undefined, f.candidateReader), /credential|account/i);
    f.ctx.model.baseUrl = "https://proxy.example/codex";
    await f.command();
    assert.match(f.notifications.at(-1)!.text, /official/);
  } finally { await f.close(); globalThis.fetch = originalFetch; }
});

test("switching accounts never reuses another account's Fast entitlement", async () => {
  const originalFetch = globalThis.fetch;
  const accounts: Array<string | null> = [];
  globalThis.fetch = (async (_url, init) => {
    const account = new Headers(init?.headers).get("chatgpt-account-id"); accounts.push(account);
    return directory(account === "second");
  }) as typeof fetch;
  const f = fixture();
  try {
    await f.command();
    assert.equal((await f.request({})).service_tier, "priority");
    f.credentials[ALIAS] = credential("third");
    assert.equal((await f.request({})).service_tier, "default");
    await settle();
    assert.equal((await f.request({})).service_tier, "default");
    assert.ok(accounts.includes("third"));
    await f.command();
    assert.equal(f.enabled(), false, "turning off must work even without Fast entitlement");
  } finally { await f.close(); globalThis.fetch = originalFetch; }
});

test("session changes cancel pending capability reads without saving Fast", async () => {
  const originalFetch = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (_url, init) => { await gate; init?.signal?.throwIfAborted(); return directory(true); }) as typeof fetch;
  const f = fixture();
  try {
    const pending = f.command();
    await settle();
    f.session("replacement-session");
    release(); await pending;
    assert.deepEqual(f.updates, []);
  } finally { release(); await f.close(); globalThis.fetch = originalFetch; }
});

test("shutdown aborts directory I/O and never saves a pending toggle", async () => {
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = (async (_url, init) => {
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;
  const f = fixture();
  try {
    const pending = f.command(); await settle();
    await f.close(); await pending;
    assert.equal(signal?.aborted, true);
    assert.deepEqual(f.updates, []);
    assert.equal(f.statuses.at(-1), undefined);
  } finally { await f.close(); globalThis.fetch = originalFetch; }
});

test("the primary account retains its original Fast behavior and /fast argument checks", async () => {
  const originalFetch = globalThis.fetch;
  const accounts: Array<string | null> = [];
  globalThis.fetch = (async (_url, init) => { accounts.push(new Headers(init?.headers).get("chatgpt-account-id")); return directory(true); }) as typeof fetch;
  const f = fixture();
  try {
    await f.command("on");
    assert.match(f.notifications.at(-1)!.text, /does not accept arguments/);
    assert.deepEqual(f.updates, []);
    f.ctx.model.provider = "openai-codex";
    await f.command();
    assert.equal(f.enabled(), true);
    assert.equal((await f.request({})).service_tier, "priority");
    assert.ok(accounts.every((id) => id === "first"));
    assert.ok(f.requestedIds.every((id) => id === "openai-codex"));
    assert.equal(f.statuses.at(-1), undefined, "alias status must not label the primary account");
  } finally { await f.close(); globalThis.fetch = originalFetch; }
});

test("directory HTTP errors remain unknown and route at standard speed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("untrusted response", { status: 401 })) as typeof fetch;
  const f = fixture();
  const catalog = createCodexFastCatalog({ candidateReader: f.candidateReader, timeoutMs: 1000, fetchImpl: (url: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(url, init) });
  try {
    const capability = await catalog.read(f.context, new AbortController().signal, true, true);
    assert.equal(capability?.kind, "unknown");
    await f.command();
    assert.equal(f.enabled(), false);
    assert.equal((await f.request({})).service_tier, "default");
  } finally { catalog.reset(true); await f.close(); globalThis.fetch = originalFetch; }
});
