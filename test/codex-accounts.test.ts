import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createModels, createAssistantMessageEventStream, normalizeContext,
  type AssistantMessage, type OAuthCredential, type Credential, type CredentialStore, type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { CODEX_ACCOUNT_PROVIDER, createCodexAccountProvider } from "../src/codex-accounts.ts";

class MemoryCredentials implements CredentialStore {
  private values: Map<string, Credential>;
  constructor(initial: Record<string, Credential>) { this.values = new Map(Object.entries(initial)); }
  async read(id: string) { return this.values.get(id); }
  async list() { return [...this.values].map(([providerId, value]) => ({ providerId, type: value.type })); }
  async delete(id: string) { this.values.delete(id); }
  async modify(id: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
    const next = await fn(this.values.get(id));
    if (next) this.values.set(id, next);
    return this.values.get(id);
  }
}

const credential = (accountId: string, expires = Date.now() + 3600000): OAuthCredential => ({
  type: "oauth", access: `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.signature`,
  refresh: `refresh-${accountId}`, expires, accountId,
});
const message = (provider: string, model: string): AssistantMessage => ({
  role: "assistant", provider, model, api: "openai-codex-responses", content: [{ type: "text", text: "hello" }],
  stopReason: "stop", timestamp: Date.now(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

function fakeAuthProvider() {
  const base = openaiCodexProvider();
  const refreshed: string[] = [];
  const provider: typeof base = {
    ...base,
    auth: { oauth: {
      name: "test OAuth", isSubscription: true,
      async login(interaction) { return credential(await interaction.prompt({ type: "text", message: "Account" })); },
      async refresh(current, signal) {
        signal.throwIfAborted(); refreshed.push(String(current.accountId));
        return { ...current, access: `${current.access}-new`, refresh: `${current.refresh}-new`, expires: Date.now() + 3600000 };
      },
      async toAuth(current) { return { apiKey: current.access }; },
    } },
  };
  return { provider, refreshed };
}

test("second Codex provider mirrors the native model catalog without modifying the first", () => {
  const native = openaiCodexProvider();
  const before = native.getModels().map((model) => ({ ...model }));
  const second = createCodexAccountProvider(native);
  assert.equal(second.id, "openai-codex-1");
  assert.ok(second.auth.oauth?.isSubscription);
  assert.deepEqual(second.getModels().map((model) => model.id), native.getModels().map((model) => model.id));
  assert.ok(second.getModels().every((model) => model.provider === second.id && model.api === "openai-codex-responses"));
  assert.ok(second.getAllModels?.().every((model) => model.provider === second.id));
  assert.deepEqual(native.getModels(), before);
  assert.equal(native.id, "openai-codex");
});

test("Pi login stores two accounts under separate keys; alias login never overwrites the first", async () => {
  const { provider } = fakeAuthProvider();
  const first = credential("account-a");
  const storage = new MemoryCredentials({ "openai-codex": first });
  const models = createModels({ credentials: storage });
  models.setProvider(provider);
  models.setProvider(createCodexAccountProvider(provider));
  const notifications: string[] = [];
  await models.login(CODEX_ACCOUNT_PROVIDER, "oauth", {
    prompt: async () => "account-b", notify: (event) => { if (event.type === "info") notifications.push(event.message); },
  });
  assert.deepEqual(await storage.read("openai-codex"), first);
  assert.equal((await storage.read(CODEX_ACCOUNT_PROVIDER) as OAuthCredential).accountId, "account-b");
  assert.equal((await models.getAuth("openai-codex"))?.auth.apiKey, first.access);
  assert.equal((await models.getAuth(CODEX_ACCOUNT_PROVIDER))?.auth.apiKey, credential("account-b").access);
  assert.match(notifications.join(" "), /SECOND ChatGPT account/);
});

test("refresh, logout, and missing credentials are isolated to each provider ID", async () => {
  const { provider, refreshed } = fakeAuthProvider();
  const first = credential("account-a");
  const storage = new MemoryCredentials({ "openai-codex": first, [CODEX_ACCOUNT_PROVIDER]: credential("account-b", 0) });
  const models = createModels({ credentials: storage });
  models.setProvider(provider); models.setProvider(createCodexAccountProvider(provider));
  await models.getAuth(CODEX_ACCOUNT_PROVIDER);
  assert.deepEqual(refreshed, ["account-b"]);
  assert.deepEqual(await storage.read("openai-codex"), first);
  assert.equal((await storage.read(CODEX_ACCOUNT_PROVIDER) as OAuthCredential).refresh, "refresh-account-b-new");
  await models.logout(CODEX_ACCOUNT_PROVIDER);
  assert.equal(await models.getAuth(CODEX_ACCOUNT_PROVIDER), undefined, "must not fall back to primary credentials");
  assert.equal((await models.getAuth("openai-codex"))?.auth.apiKey, first.access);
  assert.deepEqual(await storage.read("openai-codex"), first);
});

test("inference uses the selected account's token and attributes every stream event to the alias", async () => {
  const { provider } = fakeAuthProvider();
  const first = credential("account-a"), second = credential("account-b");
  let key: string | undefined;
  const callbackProviders: string[] = [];
  const base: typeof provider = {
    ...provider,
    streamSimple(model, _context, options) {
      assert.equal(model.provider, "openai-codex", "native wire adapter needs its canonical ID");
      key = options?.apiKey;
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options?.onPayload?.({}, model);
        await options?.onResponse?.({ status: 200, headers: {} }, model);
        await options?.onProviderStreamEvent?.({}, model);
        const partial = message("openai-codex", model.id);
        stream.push({ type: "start", partial });
        stream.push({ type: "done", reason: "stop", message: partial });
        stream.end();
        assert.equal(partial.provider, "openai-codex", "outer mapping must not mutate native continuation state");
      })();
      return stream;
    },
  };
  const models = createModels({ credentials: new MemoryCredentials({ "openai-codex": first, [CODEX_ACCOUNT_PROVIDER]: second }) });
  models.setProvider(base); models.setProvider(createCodexAccountProvider(base));
  const model = models.getModels(CODEX_ACCOUNT_PROVIDER)[0];
  const stream = models.streamSimple(model, { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] }, {
    onPayload: (_payload, selected) => { callbackProviders.push(selected.provider); },
    onResponse: (_response, selected) => { callbackProviders.push(selected.provider); },
    onProviderStreamEvent: (_data, selected) => { callbackProviders.push(selected.provider); },
  });
  for await (const event of stream) {
    const value = "partial" in event ? event.partial : event.type === "done" ? event.message : event.error;
    assert.equal(value.provider, CODEX_ACCOUNT_PROVIDER);
  }
  assert.equal((await stream.result()).provider, CODEX_ACCOUNT_PROVIDER);
  assert.equal(key, second.access);
  assert.notEqual(key, first.access);
  assert.deepEqual(callbackProviders, [CODEX_ACCOUNT_PROVIDER, CODEX_ACCOUNT_PROVIDER, CODEX_ACCOUNT_PROVIDER]);
});

test("gpt-6.1-sol keeps composite tool IDs valid and drops the other account's encrypted reasoning", async () => {
  const native = openaiCodexProvider();
  const alias = createCodexAccountProvider(native);
  const model = alias.getModels().find((model) => model.id === "gpt-6.1-sol")!;
  assert.ok(model, "gpt-6.1-sol must be tested, not just the first catalog model");
  for (const source of [CODEX_ACCOUNT_PROVIDER, "openai-codex"]) {
    const assistant: AssistantMessage = {
      ...message(source, model.id), stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "", thinkingSignature: JSON.stringify({ type: "reasoning", id: "rs_test", encrypted_content: "account-encrypted-data" }) },
        { type: "toolCall", id: "call_test|fc_test", name: "test_tool", arguments: {} },
      ],
    };
    const context = normalizeContext({ messages: [
      { role: "user", content: "hi", timestamp: Date.now() }, assistant,
      { role: "toolResult", toolCallId: "call_test|fc_test", toolName: "test_tool", content: [{ type: "text", text: "done" }], isError: false, timestamp: Date.now() },
    ] });
    let payload: Record<string, unknown> | undefined;
    const options: SimpleStreamOptions = {
      apiKey: credential("account-b").access,
      onPayload(value, selected) {
        assert.equal(selected.provider, CODEX_ACCOUNT_PROVIDER);
        payload = value as Record<string, unknown>;
        throw new Error("test stops before any network request");
      },
    };
    const result = await alias.streamSimple(model, context, options).result();
    assert.equal(result.provider, CODEX_ACCOUNT_PROVIDER);
    assert.match(result.errorMessage ?? "", /test stops before any network/);
    assert.ok(payload, "must reach native payload conversion");
    const input = payload.input as Array<Record<string, unknown>>;
    const call = input.find((item) => item.type === "function_call")!;
    const output = input.find((item) => item.type === "function_call_output")!;
    assert.equal(call.call_id, "call_test");
    assert.equal(output.call_id, call.call_id);
    assert.ok(String(call.id).startsWith("fc_"));
    assert.equal(input.some((item) => item.type === "reasoning"), source === CODEX_ACCOUNT_PROVIDER);
    assert.equal(assistant.provider, source, "context must not be mutated");
  }
});

test("explicit stream delegates preserve account attribution on native error and abort", async () => {
  const alias = createCodexAccountProvider();
  const model = alias.getModels()[0];
  const controller = new AbortController(); controller.abort();
  const result = await alias.stream(model, normalizeContext({ messages: [] }), { signal: controller.signal, apiKey: credential("account-b").access }).result();
  assert.equal(result.provider, CODEX_ACCOUNT_PROVIDER);
  assert.equal(result.stopReason, "aborted");
});
