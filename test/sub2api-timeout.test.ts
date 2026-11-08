import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { login } from "../src/auth.ts";
import { fetchAccountUsage } from "../src/sub2api.ts";

interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const operations = [
  {
    name: "login",
    payload: { code: 0, data: { access_token: "test-token", expires_in: 3600 } },
    request: (instanceBaseUrl: string, options: RequestOptions) => login({
      instanceBaseUrl, email: "test@example.test", password: "test-password", ...options,
    }),
  },
  {
    name: "usage",
    payload: { code: 0, data: { five_hour: { utilization: 20, resets_at: null }, seven_day: null } },
    request: (instanceBaseUrl: string, options: RequestOptions) => fetchAccountUsage({
      instanceBaseUrl, route: "/api/v1/admin/accounts/{id}/usage", method: "GET",
      token: "test-token", accountId: 42, usageSource: "passive", ...options,
    }),
  },
];

async function stalledBodyServer(t: TestContext) {
  let markStarted!: () => void;
  const bodyReading = new Promise<void>((resolve) => { markStarted = resolve; });
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const readJson = response.json.bind(response);
    Object.defineProperty(response, "json", { value: () => { markStarted(); return readJson(); } });
    return response;
  };
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"code":0,"data":');
    // Deliberately never finish JSON: exercise real fetch body cancellation.
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { url: `http://127.0.0.1:${address.port}`, bodyReading, fetchImpl };
}

for (const operation of operations) {
  test(`${operation.name} deadline aborts a real HTTP response stalled after headers`, async (t) => {
    const server = await stalledBodyServer(t);
    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const pending = operation.request(server.url, { timeoutMs: 100, signal: controller.signal, fetchImpl: server.fetchImpl }).then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    try {
      await server.bodyReading;
      const result = await Promise.race([
        pending,
        new Promise<{ status: "still-pending" }>((resolve) => {
          watchdog = setTimeout(() => resolve({ status: "still-pending" }), 500);
        }),
      ]);
      assert.equal(result.status, "rejected", "deadline must cover JSON body reading, not only headers");
      assert.ok("error" in result && result.error instanceof Error);
      assert.equal(result.error.name, "AbortError", "timeout must not become a JSON format error");
    } finally {
      clearTimeout(watchdog);
      controller.abort();
      await pending;
    }
  });

  test(`${operation.name} preserves caller cancellation during real HTTP body reading`, async (t) => {
    const server = await stalledBodyServer(t);
    const controller = new AbortController();
    const pending = operation.request(server.url, { signal: controller.signal, fetchImpl: server.fetchImpl });
    const rejected = assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AbortError", "caller cancellation must not become a JSON format error");
      return true;
    });
    await server.bodyReading;
    controller.abort();
    await rejected;
  });

  for (const outcome of ["success", "invalid JSON", "HTTP error"] as const) {
    test(`${operation.name} clears its deadline after ${outcome}`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let signal: AbortSignal | undefined;
      const pending = operation.request("http://example.test", {
        fetchImpl: async (_url, init) => {
          signal = init?.signal ?? undefined;
          return new Response(outcome === "invalid JSON" ? "not-json" : JSON.stringify(operation.payload), {
            status: outcome === "HTTP error" ? 503 : 200,
          });
        },
      });
      if (outcome === "success") await pending;
      else await assert.rejects(pending);
      assert.ok(signal);
      t.mock.timers.tick(15_000);
      assert.equal(signal.aborted, false, "completed request must not receive a late deadline abort");
    });
  }
}
