import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import * as zlib from "node:zlib";

const runtime = process.env.PI_PACKAGE_DIR ?? join(homedir(), ".local/lib/node_modules/@earendil-works/pi-coding-agent");
const requirePi = createRequire(join(runtime, "package.json"));
const { createJiti } = await import(pathToFileURL(requirePi.resolve("jiti")).href);
const jiti = createJiti(import.meta.url, {
  alias: Object.fromEntries(["pi-coding-agent", "pi-ai", "pi-tui"].map((name) => [
    `@earendil-works/${name}`,
    name === "pi-coding-agent" ? join(runtime, "dist/index.js") : join(runtime, `node_modules/@earendil-works/${name}/dist/index.js`),
  ])),
});
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const [entry] = manifest.pi.extensions;
const install = (await jiti.import(fileURLToPath(new URL(`../${entry}`, import.meta.url)))).default;
const codex = await import(pathToFileURL(join(runtime, "node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js")).href);
const { WebSocketServer } = requirePi("ws");
const STATE = "daybreak-blue-state";
const model = {
  id: "gpt-6-sol", name: "GPT-6 Sol", provider: "openai-codex", api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text", "image"],
  contextWindow: 1000000, maxTokens: 32000,
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
};

function harness(selected = model, entries = []) {
  const handlers = new Map();
  const commands = new Map();
  const statuses = new Map();
  const notices = [];
  const branch = [...entries];
  let idle = true;
  const ctx = {
    model: selected,
    mode: "tui", hasUI: true,
    isIdle: () => idle,
    sessionManager: { getBranch: () => branch },
    ui: {
      setStatus: (key, value) => value === undefined ? statuses.delete(key) : statuses.set(key, value),
      notify: (text, level) => notices.push({ text, level }),
      setFooter: () => assert.fail("Daybreak must not replace pi-statusline"),
    },
  };
  install({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) => branch.push({ type: "custom", customType, data }),
  });
  return {
    ctx, handlers, commands, statuses, notices, branch,
    idle: (value) => { idle = value; },
    emit: (name, event = {}) => handlers.get(name)?.({ type: name, ...event }, ctx),
    command: (args = "") => commands.get("daybreak").handler(args, ctx),
    payload(payload = { model: ctx.model?.id, input: [] }) {
      return handlers.get("before_provider_request")({ type: "before_provider_request", payload }, ctx) ?? payload;
    },
  };
}

const state = (enabled) => ({ type: "custom", customType: STATE, data: { version: 1, enabled } });

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

test("current pi-statusline renders the status/icon/colors and wraps narrow terminals", async () => {
  const statuslineRoot = join(homedir(), ".pi/agent/npm/node_modules/@narumitw/pi-statusline");
  const { formatExtensionStatus, wrapExtensionStatusline } = await jiti.import(join(statuslineRoot, "src/extension-status.ts"));
  const { visibleWidth } = await import(pathToFileURL(join(runtime, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
  const h = harness();
  await h.command("on");
  const colors = [];
  const theme = { fg: (color, text) => { colors.push(color); return text; } };
  const text = formatExtensionStatus("daybreak", h.statuses.get("daybreak"), theme, { extensionStatusIcons: {} });
  assert.equal(text, "🛡️ Daybreak Blue requested");
  assert.ok(!colors.includes("success"));
  colors.length = 0;
  formatExtensionStatus("daybreak", "🛡️ Daybreak Blue active", theme, { extensionStatusIcons: {} });
  assert.ok(colors.includes("success"));
  for (const width of [8, 16, 40, 100]) {
    for (const line of wrapExtensionStatusline(text, width)) assert.ok(visibleWidth(line) <= width);
  }
  colors.length = 0;
  formatExtensionStatus("daybreak", "🛡️ Daybreak Blue unavailable", theme, { extensionStatusIcons: {} });
  assert.ok(colors.includes("warning"));
  assert.match(formatExtensionStatus("daybreak", text, theme, { extensionStatusIcons: { daybreak: "🌅" } }), /^🌅 /);
});

const completed = {
  type: "response.completed",
  response: {
    id: "resp_test", status: "completed", access_programs: { cyber: "daybreak_blue" },
    output: [{ type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK 你好", annotations: [] }] }],
    usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 4 } },
  },
};
const events = [
  { type: "response.created", response: { id: "resp_test" } },
  { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_test", role: "assistant", content: [] } },
  { type: "response.output_text.delta", output_index: 0, delta: "OK 你好" },
  { type: "response.output_item.done", output_index: 0, item: completed.response.output[0] },
  completed,
];
function decodeBody(init) {
  const bytes = init.headers.get("content-encoding") === "zstd" ? zlib.zstdDecompressSync(init.body) : init.body;
  return JSON.parse(typeof bytes === "string" ? bytes : Buffer.from(bytes).toString());
}
const fakeKey = `e30.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64")}.fake`;
const context = { messages: [{ role: "user", content: "Reply OK", timestamp: Date.now() }] };

async function request(h, extra = {}, selected = model) {
  const result = await codex.stream(selected, context, {
    apiKey: fakeKey, transport: "sse", maxRetries: 0, timeoutMs: 3000,
    onPayload: (body) => h.payload(body),
    onProviderStreamEvent: (data, requestModel) => h.emit("provider_stream_event", { data, model: requestModel.id, provider: requestModel.provider }),
    ...extra,
  }).result();
  h.emit("message_end", { message: result });
  return result;
}

test("built-in Codex SSE sends the parameter, preserves normal response/usage, and removes it when off", async () => {
  const h = harness();
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, body: decodeBody(init) });
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  };
  await h.command("on");
  const result = await request(h, { fetch });
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(result.content[0].text, "OK 你好");
  assert.equal(result.usage.cacheRead, 4);
  assert.equal(result.usage.output, 3);
  assert.equal(h.statuses.get("daybreak"), "🛡️ Daybreak Blue active");
  assert.equal(sent[0].body.access_programs.cyber, "daybreak_blue");
  assert.equal(sent[0].url, "https://chatgpt.com/backend-api/codex/responses");
  await h.command("off");
  assert.equal((await request(h, { fetch })).stopReason, "stop");
  assert.equal(sent[1].body.access_programs, undefined);
});

test("a server entitlement rejection stays an error; no silent ordinary-mode fallback", async () => {
  const h = harness();
  await h.command("on");
  let requests = 0;
  const result = await request(h, { fetch: async (_url, init) => {
    requests++;
    assert.equal(decodeBody(init).access_programs.cyber, "daybreak_blue");
    return Response.json({ error: { message: "Daybreak Blue access is not enabled", code: "access_denied" } }, { status: 403 });
  } });
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage, /Daybreak Blue/);
  assert.equal(requests, 1);
  assert.equal(h.statuses.get("daybreak"), "🛡️ Daybreak Blue error");
  await h.command("status");
  assert.match(h.notices.at(-1).text, /最近请求失败/);
  assert.equal(h.payload().access_programs.cyber, "daybreak_blue");
});

test("built-in Codex WebSocket serializes the same Daybreak field", async () => {
  const h = harness();
  await h.command("on");
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const sent = [];
  wss.on("connection", (socket) => socket.on("message", (message) => {
    sent.push(JSON.parse(message.toString()));
    for (const event of events) socket.send(JSON.stringify(event));
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    // Local stand-in for the official transport; the extension sees the selected official model.
    const localModel = { ...model, baseUrl: `http://127.0.0.1:${server.address().port}` };
    const result = await request(h, { transport: "websocket", fetch: () => assert.fail("Unexpected SSE fallback") }, localModel);
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(sent[0].type, "response.create");
    assert.equal(sent[0].access_programs.cyber, "daybreak_blue");
    assert.equal(result.content[0].text, "OK 你好");
  } finally {
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
