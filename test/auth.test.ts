import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthError,
  login,
  obtainAccessToken,
  readTokenCache,
  writeTokenCache,
} from "../src/auth.ts";
import { normalizeSettings } from "../src/settings.ts";

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const tempCachePath = (content?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "s2a-auth-"));
  const path = join(dir, "pi-sub2api-usage-cache.json");
  if (content !== undefined) writeFileSync(path, content);
  return path;
};

const loginEnvelope = (data: unknown) => ({ code: 0, message: "success", data });
const identity = { instanceBaseUrl: "https://example.test", email: "a@b.c" };
const credentials = { ...identity, baseUrl: identity.instanceBaseUrl, password: "p" };

test("manual token takes precedence and skips fetch", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  const state = await obtainAccessToken({
    settings: normalizeSettings({ token: "t" }),
    cachePath: tempCachePath(),
    fetchImpl,
  });
  assert.deepEqual(state, { accessToken: "t", expiresAt: Infinity });
  assert.equal(calls, 0);
});

test("valid cached token is reused without login", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  const now = 1_000_000;
  const cachePath = tempCachePath();
  writeTokenCache(cachePath, { accessToken: "cached", expiresAt: now + 120_000 }, identity);
  const state = await obtainAccessToken({ settings: normalizeSettings(credentials), cachePath, now, fetchImpl });
  assert.equal(state.accessToken, "cached");
  assert.equal(calls, 0);
});

test("cached token inside the 60s margin triggers login", async () => {
  const now = 1_000_000;
  const cachePath = tempCachePath();
  writeTokenCache(cachePath, { accessToken: "stale", expiresAt: now + 30_000 }, identity);
  const state = await obtainAccessToken({
    settings: normalizeSettings(credentials),
    cachePath,
    now,
    fetchImpl: (async () =>
      jsonResponse(loginEnvelope({ access_token: "fresh", expires_in: 3600 }))) as unknown as typeof fetch,
  });
  assert.equal(state.accessToken, "fresh");
  assert.equal(state.expiresAt, now + 3_600_000);
});

test("login happy path persists cache with mode 0600", async () => {
  const now = 5_000_000;
  const cachePath = tempCachePath();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const state = await obtainAccessToken({
    settings: normalizeSettings({ email: "a@b.c", password: "p", baseUrl: "https://example.test" }),
    cachePath,
    now,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(loginEnvelope({ access_token: "abc", expires_in: 3600 }));
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(state, { accessToken: "abc", expiresAt: now + 3_600_000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://example.test/api/v1/auth/login");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], "pi-sub2api-usage/0.1.0");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { email: "a@b.c", password: "p" });
  const persisted = JSON.parse(readFileSync(cachePath, "utf8"));
  assert.deepEqual(persisted, { version: 1, ...identity, accessToken: "abc", expiresAt: now + 3_600_000 });
  assert.equal(statSync(cachePath).mode & 0o777, 0o600);
});

test("login with baseUrl from settings, requires_2fa raises AuthError 2fa", async () => {
  const now = 9_000_000;
  const state = await obtainAccessToken({
    settings: normalizeSettings({
      email: "a@b.c",
      password: "p",
      baseUrl: "http://h:8080",
    }),
    cachePath: tempCachePath(),
    now,
    fetchImpl: (async () =>
      jsonResponse(
        loginEnvelope({ requires_2fa: true, temp_token: "tmp", user_email_masked: "a***@b.c" }),
      )) as unknown as typeof fetch,
  }).catch((error: unknown) => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.kind, "2fa");
    return undefined;
  });
  assert.equal(state, undefined);
});

test("missing expires_in yields immediately-stale token", async () => {
  const now = 7_000_000;
  const state = await login({
    instanceBaseUrl: "http://h:8080",
    email: "a@b.c",
    password: "p",
    now,
    fetchImpl: (async () =>
      jsonResponse(loginEnvelope({ access_token: "x" }))) as unknown as typeof fetch,
  });
  assert.deepEqual(state, { accessToken: "x", expiresAt: now });
});

test("captcha-ish envelope message maps to captcha kind", async () => {
  await assert.rejects(
    login({
      instanceBaseUrl: "http://h:8080",
      email: "a@b.c",
      password: "p",
      fetchImpl: (async () => jsonResponse({ code: 1, message: "captcha required" })) as unknown as typeof fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal((error as AuthError).kind, "captcha");
      return true;
    },
  );
});

test("other envelope failures map to login-failed", async () => {
  for (const body of [
    { code: 1, message: "invalid credentials" },
    { code: 1, message: "unauthorized" },
  ]) {
    await assert.rejects(
      login({
        instanceBaseUrl: "http://h:8080",
        email: "a@b.c",
        password: "p",
        fetchImpl: (async () => jsonResponse(body)) as unknown as typeof fetch,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AuthError);
        assert.equal((error as AuthError).kind, "login-failed");
        return true;
      },
    );
  }
});

test("HTTP 401 on login maps to login-failed", async () => {
  await assert.rejects(
    login({
      instanceBaseUrl: "http://h:8080",
      email: "a@b.c",
      password: "p",
      fetchImpl: (async () => jsonResponse({ code: 0 }, 401)) as unknown as typeof fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal((error as AuthError).kind, "login-failed");
      return true;
    },
  );
});

test("missing email+password+token raises no-credentials without fetch", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  await assert.rejects(
    obtainAccessToken({ settings: normalizeSettings({}), cachePath: tempCachePath(), fetchImpl }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal((error as AuthError).kind, "no-credentials");
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("readTokenCache rejects missing, malformed, legacy and unknown-version caches", () => {
  for (const content of [
    undefined,
    "{nope",
    JSON.stringify({ accessToken: "legacy", expiresAt: 5 }),
    JSON.stringify({ version: 2, ...identity, accessToken: "future", expiresAt: 5 }),
    JSON.stringify({ version: 1, ...identity, accessToken: "", expiresAt: 5 }),
    JSON.stringify({ version: 1, ...identity, accessToken: "bad", expiresAt: "later" }),
  ]) {
    const path = tempCachePath(content);
    assert.equal(readTokenCache(path, identity), undefined);
    rmSync(join(path, ".."), { recursive: true, force: true });
  }
});

test("writeTokenCache writes scoped JSON readable back", () => {
  const path = tempCachePath();
  writeTokenCache(path, { accessToken: "z", expiresAt: 42 }, identity);
  assert.deepEqual(readTokenCache(path, identity), { accessToken: "z", expiresAt: 42 });
  assert.equal(readTokenCache(path, { ...identity, instanceBaseUrl: "https://other.test" }), undefined);
  assert.equal(readTokenCache(path, { ...identity, email: "other@example.test" }), undefined);
  rmSync(join(path, ".."), { recursive: true, force: true });
});

test("instance, scheme, port, path and user changes require a new login", async () => {
  for (const changed of [
    { baseUrl: "https://other.test" },
    { baseUrl: "http://example.test" },
    { baseUrl: "https://example.test:8443" },
    { baseUrl: "https://example.test/another-instance" },
    { email: "other@example.test" },
  ]) {
    const cachePath = tempCachePath();
    const now = 1_000_000;
    writeTokenCache(cachePath, { accessToken: "old-instance-token", expiresAt: now + 120_000 }, identity);
    let calls = 0;
    const settings = normalizeSettings({ ...credentials, ...changed });
    try {
      const result = await obtainAccessToken({
        settings, cachePath, now,
        fetchImpl: (async (url, init) => {
          calls++;
          assert.equal(String(url), `${settings.baseUrl}/api/v1/auth/login`);
          assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
          assert.equal(JSON.parse(init?.body as string).email, settings.email);
          return jsonResponse(loginEnvelope({ access_token: "new-instance-token", expires_in: 3600 }));
        }) as typeof fetch,
      });
      assert.equal(calls, 1);
      assert.equal(result.accessToken, "new-instance-token");
      assert.equal(readTokenCache(cachePath, identity), undefined);
    } finally {
      rmSync(join(cachePath, ".."), { recursive: true, force: true });
    }
  }
});

test("equivalent normalized instance URLs reuse the scoped token", async () => {
  const cachePath = tempCachePath();
  const now = 1_000_000;
  writeTokenCache(cachePath, { accessToken: "cached", expiresAt: now + 120_000 }, identity);
  try {
    const result = await obtainAccessToken({
      settings: normalizeSettings({ ...credentials, baseUrl: "https://EXAMPLE.test:443/" }),
      cachePath, now,
      fetchImpl: async () => { throw new Error("must not log in"); },
    });
    assert.equal(result.accessToken, "cached");
  } finally {
    rmSync(join(cachePath, ".."), { recursive: true, force: true });
  }
});

test("legacy unscoped cache triggers login and is replaced", async () => {
  const cachePath = tempCachePath(JSON.stringify({ accessToken: "legacy", expiresAt: 9_999_999 }));
  try {
    const state = await obtainAccessToken({
      settings: normalizeSettings(credentials), cachePath, now: 1_000_000,
      fetchImpl: (async () => jsonResponse(loginEnvelope({ access_token: "fresh", expires_in: 3600 }))) as unknown as typeof fetch,
    });
    assert.equal(state.accessToken, "fresh");
    assert.equal(JSON.parse(readFileSync(cachePath, "utf8")).version, 1);
  } finally {
    rmSync(join(cachePath, ".."), { recursive: true, force: true });
  }
});

test("cached tokens are not reused after credentials or base URL are removed", async () => {
  const cachePath = tempCachePath();
  writeTokenCache(cachePath, { accessToken: "cached", expiresAt: 9_999_999 }, identity);
  try {
    for (const changed of [{ email: undefined }, { password: undefined }, { baseUrl: undefined }]) {
      await assert.rejects(obtainAccessToken({
        settings: normalizeSettings({ ...credentials, ...changed }), cachePath, now: 1_000_000,
        fetchImpl: async () => { throw new Error("must not fetch"); },
      }), AuthError);
    }
  } finally {
    rmSync(join(cachePath, ".."), { recursive: true, force: true });
  }
});

test("password whitespace is sent to login unchanged", async () => {
  const cachePath = tempCachePath();
  try {
    await obtainAccessToken({
      settings: normalizeSettings({ ...credentials, password: " secret \t" }), cachePath,
      fetchImpl: (async (_url, init) => {
        assert.equal(JSON.parse(init?.body as string).password, " secret \t");
        return jsonResponse(loginEnvelope({ access_token: "fresh", expires_in: 3600 }));
      }) as typeof fetch,
    });
  } finally {
    rmSync(join(cachePath, ".."), { recursive: true, force: true });
  }
});
