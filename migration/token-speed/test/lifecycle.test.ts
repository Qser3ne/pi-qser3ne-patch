import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
  ExtensionHandler,
  MessageStartEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import tokenSpeedExtension from "../src/index.ts";

function setup(t: TestContext, mode: ExtensionContext["mode"] = "tui") {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const handlers = new Map<string, ExtensionHandler<ExtensionEvent>>();
  const statuses = new Map<string, string | undefined>();
  const ctx = {
    mode,
    hasUI: true,
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
    },
  } as unknown as ExtensionContext;
  tokenSpeedExtension({
    on: (name: string, handler: ExtensionHandler<ExtensionEvent>) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
  } as unknown as ExtensionAPI);
  const emit = async (event: ExtensionEvent) => {
    await handlers.get(event.type)?.(event, ctx);
  };
  t.after(() => emit({ type: "session_shutdown", reason: "quit" }));

  const message: MessageStartEvent["message"] = {
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: 0, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 20,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: now,
  };
  return {
    emit,
    advance: (ms: number) => { now += ms; },
    status: () => statuses.get("token-speed"),
    start: () => emit({ type: "message_start", message }),
    delta: (type: "text_delta" | "thinking_delta" | "toolcall_delta" = "text_delta") => emit({
      type: "message_update",
      message,
      assistantMessageEvent: { type, contentIndex: 0, delta: "hello", partial: message },
    } as MessageUpdateEvent),
    end: () => emit({ type: "message_end", message }),
  };
}

for (const type of ["text_delta", "thinking_delta", "toolcall_delta"] as const) {
  test(`TTFT is visible on the first ${type}, before speed is available`, async (t) => {
    const h = setup(t);
    await h.start();
    assert.equal(h.status(), "⚡ --");
    h.advance(800);
    await h.delta(type);
    assert.equal(h.status(), "⚡ -- · TTFT 800ms");
    await h.end();
    assert.equal(h.status(), "⚡ -- · TTFT 800ms");
  });
}

test("TTFT remains visible while waiting for the next message, even if it has no deltas", async (t) => {
  const h = setup(t);
  await h.start();
  h.advance(800);
  await h.delta();
  h.advance(500);
  await h.delta();
  await h.end();
  assert.match(h.status()!, /TTFT 800ms/);
  assert.match(h.status()!, /40\.0 tok\/s/);

  h.advance(10000);
  await h.start();
  assert.equal(h.status(), "⚡ -- · TTFT 800ms · 40.0 tok/s");
  h.advance(1000);
  await h.end();
  assert.equal(h.status(), "⚡ -- · TTFT 800ms · 40.0 tok/s");
});

test("the first delta updates the retained TTFT average without waiting for speed", async (t) => {
  const h = setup(t);
  await h.start();
  h.advance(800);
  await h.delta();
  await h.end();
  await h.start();
  h.advance(1200);
  await h.delta();
  assert.equal(h.status(), "⚡ -- · TTFT 1.0s");
});

test("a zero-millisecond TTFT is still a valid visible sample", async (t) => {
  const h = setup(t);
  await h.start();
  await h.delta();
  await h.end();
  assert.equal(h.status(), "⚡ -- · TTFT 0ms");
});

test("starting a new session clears previous TTFT samples", async (t) => {
  const h = setup(t);
  await h.start();
  h.advance(800);
  await h.delta();
  await h.end();
  await h.emit({ type: "session_start", reason: "new" });
  await h.start();
  assert.equal(h.status(), "⚡ --");
});

for (const mode of ["print", "json", "rpc"] as const) {
  test(`TTFT does not publish status in ${mode} mode`, async (t) => {
    const h = setup(t, mode);
    await h.start();
    h.advance(800);
    await h.delta();
    await h.end();
    assert.equal(h.status(), undefined);
  });
}
