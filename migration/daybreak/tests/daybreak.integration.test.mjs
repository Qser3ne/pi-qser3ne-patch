import assert from "node:assert/strict";
import { createServer } from "node:http";
import { findPackageJSON } from "node:module";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import test from "node:test";
import * as zlib from "node:zlib";
import { createJiti } from "jiti";
import { WebSocketServer } from "ws";
import { harness, model } from "./helpers/daybreak.mjs";

// Default to the locked local devDependencies, never a user-specific global install.
// Optional overrides allow checking a different installed host/statusline explicitly.
const packageRoot = (name, from = import.meta.url) => dirname(findPackageJSON(name, from));
const runtimeRoot = process.env.PI_PACKAGE_DIR
  ? resolve(process.env.PI_PACKAGE_DIR)
  : packageRoot("@earendil-works/pi-coding-agent");
const runtimeBase = pathToFileURL(join(runtimeRoot, "package.json")).href;
const runtimeRoots = Object.fromEntries(["pi-coding-agent", "pi-ai", "pi-tui"].map((name) => [
  `@earendil-works/${name}`,
  name === "pi-coding-agent" ? runtimeRoot : packageRoot(`@earendil-works/${name}`, runtimeBase),
]));
const runtimeModules = Object.fromEntries(Object.entries(runtimeRoots).map(([name, root]) => [name, join(root, "dist/index.js")]));
const jiti = createJiti(import.meta.url, { alias: runtimeModules });
const codex = await import(pathToFileURL(join(runtimeRoots["@earendil-works/pi-ai"], "dist/api/openai-codex-responses.js")).href);
const { visibleWidth } = await import(pathToFileURL(runtimeModules["@earendil-works/pi-tui"]).href);
const statuslineRoot = process.env.PI_STATUSLINE_DIR
  ? resolve(process.env.PI_STATUSLINE_DIR)
  : packageRoot("@narumitw/pi-statusline");

test("current pi-statusline renders the status/icon/colors and wraps narrow terminals", async () => {
  const { formatExtensionStatus, wrapExtensionStatusline } = await jiti.import(join(statuslineRoot, "src/extension-status.ts"));
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
