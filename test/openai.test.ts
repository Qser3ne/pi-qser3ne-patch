import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchOpenAIUsage, formatOpenAIChip, openAIErrorText, OpenAIUsageError,
  parseCodexUsage, parseOpenAIAppUsage, resolveOpenAIAuth, OPENAI_USAGE_URL,
} from "../src/openai.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const NOW = 1_800_000_000_000;
const window = { used_percent: 23, limit_window_seconds: 18000, reset_at: NOW / 1000 + 3600 };
const plan = { rate_limit: { primary_window: window, secondary_window: { ...window, used_percent: 40, limit_window_seconds: 604800 } } };
const apps = { items: [{ id: "pi-client", windows: [window], allowed_usage_percent: 50 }] };
const jwt = (accountId = "account-a") => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.signature`;
const nativeToken = "native-must-not-be-sent-to-chatgpt";

function fixture(provider = "openai-codex") {
  const credentials: Record<string, Record<string, unknown>> = {
    "openai-codex": { type: "oauth", access: jwt(), refresh: "codex-refresh", expires: NOW + 3600000, accountId: "account-a" },
    openai: { type: "oauth", access: nativeToken, refresh: "native-refresh", expires: NOW + 3600000, clientId: "pi-client", scopes: ["chatgpt.tokens.use.direct"] },
  };
  const ctx = {
    model: { provider, baseUrl: provider === "openai" ? "https://api.openai.com/v1" : "https://chatgpt.com/backend-api" },
    modelRegistry: {
      getProviderAuth: async (id: string) => ({ source: "OAuth", auth: { apiKey: credentials[id]?.access } }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: credentials[provider]?.access }),
    },
  };
  return { credentials, ctx, options: { agentDir: "/unused", signal: new AbortController().signal, useCodexForOpenAI: true, readCredential: (id: string) => credentials[id] } };
}

test("Codex parses actual window lengths, seconds timestamps, and remaining percentages", () => {
  const windows = parseCodexUsage(plan, NOW);
  assert.equal(windows[0].resetsAt, NOW + 3600000);
  assert.equal(formatOpenAIChip("openai-codex", { plan: windows, app: [] }, NOW), "📊 openai-codex 5h 77% ↻ 1h0m 7d 60% ↻ 1h0m");
  assert.equal(parseCodexUsage({ rate_limit: { primary_window: { ...window, reset_at: null, reset_after_seconds: 90 } } }, NOW)[0].resetsAt, NOW + 90000);
});

test("rejects missing, malformed, and contradictory quota windows rather than inventing limits", () => {
  for (const raw of [null, {}, { rate_limit: {} }, { rate_limit: { primary_window: "bad" } }]) assert.throws(() => parseCodexUsage(raw, NOW), OpenAIUsageError);
  for (const invalid of [{ used_percent: NaN }, { used_percent: -1 }, { used_percent: 101 }, { remaining_percent: 99 }, { limit_window_seconds: 0 }, { reset_at: "2026-01-01" }, { reset_after_seconds: -1 }]) {
    assert.throws(() => parseCodexUsage({ rate_limit: { primary_window: { ...window, ...invalid } } }, NOW), OpenAIUsageError);
  }
});

test("matches native app by OAuth client ID and keeps plan/app quotas separate", () => {
  const app = parseOpenAIAppUsage(apps, "pi-client", NOW);
  const chip = formatOpenAIChip("openai", { plan: parseCodexUsage(plan, NOW), app }, NOW);
  assert.match(chip, /openai plan 5h 77%/);
  assert.match(chip, /app 5h 77%/);
  assert.ok(!chip.includes("50%"), "allowed_usage_percent is not remaining quota");
});

test("app usage fails closed on missing/duplicate registration, pagination, or malformed list", () => {
  for (const raw of [null, { items: [] }, { items: [{ id: "wrong", windows: [window] }] }, { items: [apps.items[0], apps.items[0]] }, { ...apps, has_more: true }, { ...apps, next_cursor: "next" }, { ...apps, total: 20 }, { items: [{ id: "pi-client", windows: [] }] }, { items: [{ windows: [window] }] }]) {
    assert.throws(() => parseOpenAIAppUsage(raw, "pi-client", NOW), OpenAIUsageError);
  }
});

test("uses freshly resolved Pi OAuth and validates stored account identity", async () => {
  const f = fixture();
  const auth = await resolveOpenAIAuth(f.ctx as unknown as ExtensionContext, "openai-codex", f.options);
  assert.equal(auth.headers?.Authorization, `Bearer ${jwt()}`);
  assert.equal(auth.headers?.["ChatGPT-Account-Id"], "account-a");
  assert.ok(!auth.fingerprint.includes(jwt()));
  f.credentials["openai-codex"].accountId = "wrong-account";
  await assert.rejects(resolveOpenAIAuth(f.ctx as unknown as ExtensionContext, "openai-codex", f.options), /identity mismatch/);
});

test("native OpenAI never treats its direct-use token as a Codex backend token", async () => {
  const f = fixture("openai");
  const auth = await resolveOpenAIAuth(f.ctx as unknown as ExtensionContext, "openai", f.options);
  assert.equal(auth.headers?.Authorization, `Bearer ${jwt()}`);
  assert.equal(auth.clientId, "pi-client");
  const disabled = await resolveOpenAIAuth(f.ctx as unknown as ExtensionContext, "openai", { ...f.options, useCodexForOpenAI: false });
  assert.equal(disabled.headers, undefined);
});

test("API keys, model header overrides, custom endpoints and stale stored credentials fail closed", async () => {
  const api = fixture();
  api.ctx.modelRegistry.getProviderAuth = async () => ({ source: "OPENAI_API_KEY", auth: { apiKey: "secret" } });
  await assert.rejects(resolveOpenAIAuth(api.ctx as unknown as ExtensionContext, "openai-codex", api.options), /API keys/);
  const override = fixture();
  override.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: "override" });
  await assert.rejects(resolveOpenAIAuth(override.ctx as unknown as ExtensionContext, "openai-codex", override.options), /overrides/);
  const custom = fixture();
  custom.ctx.model.baseUrl = "https://proxy.test";
  await assert.rejects(resolveOpenAIAuth(custom.ctx as unknown as ExtensionContext, "openai-codex", custom.options), /not native/);
  const stale = fixture();
  stale.options.readCredential = () => ({ ...stale.credentials["openai-codex"], access: "old" });
  await assert.rejects(resolveOpenAIAuth(stale.ctx as unknown as ExtensionContext, "openai-codex", stale.options), /does not match/);
});

test("transport reads app before plan, sends only companion credentials, and forbids redirects", async () => {
  const f = fixture("openai");
  const auth = await resolveOpenAIAuth(f.ctx as unknown as ExtensionContext, "openai", f.options);
  const calls: string[] = [];
  let guards = 0;
  const usage = await fetchOpenAIUsage({
    auth, signal: f.options.signal, guard: async () => { guards++; }, now: () => NOW,
    fetchImpl: (async (url, init) => {
      calls.push(String(url));
      assert.equal(init?.redirect, "error");
      assert.equal(init?.method, "GET");
      assert.ok(!JSON.stringify(init?.headers).includes(nativeToken));
      assert.equal(new Headers(init?.headers).get("ChatGPT-Account-Id"), "account-a");
      return Response.json(calls.length === 1 ? apps : plan);
    }) as typeof fetch,
  });
  assert.deepEqual(calls, [`${OPENAI_USAGE_URL}/chatpass/apps`, OPENAI_USAGE_URL]);
  assert.equal(guards, 4);
  assert.equal(usage.app.length, 1);
  assert.equal(usage.plan.length, 2);
});

test("app mismatch or changed authorization stops before reading plan quota", async () => {
  for (const guardFails of [false, true]) {
    let calls = 0;
    await assert.rejects(fetchOpenAIUsage({
      auth: { fingerprint: "hash", clientId: "not-registered", headers: { Authorization: "Bearer secret" } },
      signal: new AbortController().signal,
      guard: async () => { if (guardFails) throw new OpenAIUsageError("login changed"); },
      fetchImpl: (async () => { calls++; return Response.json(apps); }) as typeof fetch,
    }));
    assert.equal(calls, guardFails ? 0 : 1);
  }
});

test("401 is bounded, cancellation/timeout covers JSON body, and errors never print secrets", async () => {
  let calls = 0;
  const options = { auth: { fingerprint: "hash", headers: { Authorization: "Bearer secret" } }, signal: new AbortController().signal, guard: async () => {} };
  await assert.rejects(fetchOpenAIUsage({ ...options, fetchImpl: (async () => { calls++; return new Response("secret", { status: 401 }); }) as typeof fetch }), /401/);
  assert.equal(calls, 1);
  // Hold the event loop open while AbortSignal.timeout uses an unref'ed timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(fetchOpenAIUsage({ ...options, timeoutMs: 10, fetchImpl: (async (_url, init) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })),
    })) as typeof fetch }), /timeout/i);
  } finally { clearTimeout(keepAlive); }
  assert.equal(openAIErrorText(new Error("Bearer secret")), "usage request failed (network/auth/timeout)");
});
