import assert from "node:assert/strict";
import test from "node:test";
import { harness, install, manifest, model, state } from "./helpers/daybreak.mjs";

test("Git package declares exactly one loadable extension and no bundled host runtime", () => {
  assert.equal(manifest.name, "pi-daybreak");
  assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
  assert.equal(typeof install, "function");
  assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.equal(manifest.dependencies?.["@earendil-works/pi-coding-agent"], undefined);
});

test("off by default; toggles without changing model; off clears the status", async () => {
  const h = harness();
  h.emit("session_start");
  const body = { model: model.id, input: [] };
  assert.equal(h.payload(body), body);
  assert.equal(h.statuses.size, 0);
  await h.command();
  assert.equal(h.ctx.model, model);
  assert.equal(h.statuses.get("daybreak"), "🛡️ Daybreak Blue requested");
  assert.equal(h.payload(body).access_programs.cyber, "daybreak_blue");
  await h.command();
  assert.equal(h.payload(body), body);
  assert.equal(h.statuses.size, 0);
  assert.deepEqual(h.branch, [state(true), state(false)]);
});

test("on/off are idempotent; status/help/invalid input never change state", async () => {
  const h = harness();
  await h.command("ON");
  await h.command("on");
  assert.equal(h.branch.length, 1);
  for (const arg of ["status", "help", "nope", "on extra"]) await h.command(arg);
  assert.equal(h.branch.length, 1);
  assert.equal(h.notices.at(-1).level, "error");
  await h.command("off");
  await h.command("off");
  assert.equal(h.branch.length, 2);
  assert.deepEqual(h.commands.get("daybreak").getArgumentCompletions("o").map((v) => v.value), ["on", "off"]);
  assert.equal(h.commands.get("daybreak").getArgumentCompletions("zzz"), null);
});

test("busy sessions cannot change mode mid-request", async () => {
  const h = harness();
  h.idle(false);
  await h.command("on");
  assert.equal(h.branch.length, 0);
  assert.equal(h.notices.at(-1).level, "warning");
  h.idle(true);
  await h.command("on");
  h.idle(false);
  await h.command("off");
  assert.equal(h.payload().access_programs.cyber, "daybreak_blue");
  await h.command("status");
  assert.match(h.notices.at(-1).text, /已开启/);
});

test("injection preserves input/tools/cache/reasoning and other access programs without mutation", async () => {
  const h = harness();
  await h.command("on");
  const programs = Object.freeze({ cyber: "standard", another_program: "keep" });
  const body = Object.freeze({
    model: model.id,
    input: [{ role: "user", content: [{ type: "input_text", text: "你好" }, { type: "input_image", image_url: "data:image/png;base64,a" }] }],
    tools: [{ type: "function", name: "test", parameters: { type: "object" } }],
    reasoning: { effort: "high" }, prompt_cache_key: "session", stream: true, access_programs: programs,
  });
  const result = h.payload(body);
  assert.notEqual(result, body);
  assert.equal(result.input, body.input);
  assert.equal(result.tools, body.tools);
  assert.equal(result.reasoning, body.reasoning);
  assert.equal(result.prompt_cache_key, "session");
  assert.deepEqual(result.access_programs, { cyber: "daybreak_blue", another_program: "keep" });
  assert.equal(programs.cyber, "standard");
});

test("official OpenAI Responses also supports API-key requests", async () => {
  const h = harness({ ...model, provider: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1" });
  await h.command("on");
  assert.equal(h.payload().access_programs.cyber, "daybreak_blue");
});

test("rejects non-OpenAI providers, proxies, insecure endpoints and non-Responses protocols", async () => {
  for (const selected of [
    undefined,
    { ...model, provider: "anthropic", api: "anthropic-messages" },
    { ...model, provider: "sub2api-gpt" },
    { ...model, baseUrl: "https://proxy.example/backend-api" },
    { ...model, baseUrl: "http://chatgpt.com/backend-api" },
    { ...model, baseUrl: "https://chatgpt.com.evil.example/backend-api" },
    { ...model, baseUrl: "https://chatgpt.com/not-codex" },
    { ...model, baseUrl: "https://user:pass@chatgpt.com/backend-api" },
    { ...model, baseUrl: "not a url" },
    { ...model, api: "openai-completions" },
  ]) {
    const h = harness();
    h.ctx.model = selected;
    await h.command("on");
    assert.equal(h.branch.length, 0);
    assert.equal(h.statuses.size, 0);
    assert.equal(h.notices.at(-1).level, "warning");
  }
});

test("switching to an unsupported provider suspends injection; switching back resumes", async () => {
  const h = harness();
  await h.command("on");
  const other = { ...model, provider: "proxy" };
  // ModelSelectEvent.model is authoritative even before the context getter updates.
  h.emit("model_select", { model: other });
  assert.match(h.statuses.get("daybreak"), /unavailable/);
  h.ctx.model = other;
  assert.equal(h.payload().access_programs, undefined);
  h.ctx.model = model;
  h.emit("model_select", { model });
  assert.match(h.statuses.get("daybreak"), /requested/);
  assert.equal(h.payload().access_programs.cyber, "daybreak_blue");
});

test("session restore/reload/tree uses the active branch; new sessions reset", async () => {
  const h = harness(model, [state(true), state(false)]);
  h.emit("session_start");
  assert.equal(h.payload().access_programs, undefined);
  h.branch.pop();
  h.emit("session_tree");
  assert.equal(h.payload().access_programs.cyber, "daybreak_blue");
  const reloaded = harness(model, h.branch);
  reloaded.emit("session_start");
  assert.equal(reloaded.payload().access_programs.cyber, "daybreak_blue");
  h.emit("session_shutdown");
  assert.equal(h.statuses.size, 0);
  assert.equal(h.payload().access_programs, undefined);
  h.branch.length = 0;
  h.emit("session_start");
  assert.equal(h.payload().access_programs, undefined);
});

test("ignores malformed stored state, different models, and non-Responses payloads", async () => {
  const h = harness(model, [state(true), { ...state(false), data: { version: 1, enabled: "false" } }]);
  h.emit("session_start");
  assert.equal(h.payload().access_programs.cyber, "daybreak_blue");
  for (const body of [null, "body", [], { model: "other", input: [] }, { model: model.id }]) {
    assert.equal(h.payload(body), body);
  }
  assert.deepEqual(h.payload({ model: model.id, input: [], access_programs: null }).access_programs, { cyber: "daybreak_blue" });
});

test("confirmation requires an explicit matching completed server echo; errors and model changes clear it", async () => {
  const h = harness();
  await h.command("on");
  h.payload();
  const event = { provider: model.provider, model: model.id, data: { type: "response.completed", response: { status: "completed" } } };
  h.emit("provider_stream_event", event);
  assert.match(h.statuses.get("daybreak"), /requested/);
  event.data.response.access_programs = { cyber: "daybreak_blue" };
  h.emit("provider_stream_event", { ...event, model: "other" });
  assert.match(h.statuses.get("daybreak"), /requested/);
  h.emit("provider_stream_event", event);
  assert.match(h.statuses.get("daybreak"), /active/);
  await h.command("status");
  assert.match(h.notices.at(-1).text, /已由服务端确认/);
  h.emit("message_end", { message: { role: "assistant", provider: model.provider, model: model.id, stopReason: "error", errorMessage: "Daybreak isn't available for this model." } });
  assert.match(h.statuses.get("daybreak"), /error/);
  assert.match(h.notices.at(-1).text, /gpt-6-sol/);
  h.emit("model_select", { model });
  assert.match(h.statuses.get("daybreak"), /requested/);
  h.emit("provider_stream_event", event);
  assert.match(h.statuses.get("daybreak"), /requested/);
});

test("works without a terminal UI", async () => {
  const h = harness();
  h.ctx.mode = "json";
  h.ctx.hasUI = false;
  await h.command("on");
  assert.equal(h.payload().access_programs.cyber, "daybreak_blue");
});
