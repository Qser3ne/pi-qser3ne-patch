import { createHash } from "node:crypto";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { join } from "node:path";
import { readStoredCredential, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatCountdown, truncateChip } from "./format.ts";

export const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const OPENAI_MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";
export type OpenAIProvider = "openai" | "openai-codex";
export const isOpenAIProvider = (id: string | undefined): id is OpenAIProvider =>
  id === "openai" || id === "openai-codex";

export interface OpenAIWindow {
  usedPercent: number;
  seconds: number;
  resetsAt: number | null;
}
export interface OpenAIUsage {
  plan: OpenAIWindow[];
  app: OpenAIWindow[];
}
export interface OpenAIAuth {
  fingerprint: string;
  headers?: Record<string, string>;
  clientId?: string;
}
export interface OpenAIAuthOptions {
  agentDir: string;
  useCodexForOpenAI: boolean;
  signal: AbortSignal;
  readCredential?: (provider: string) => unknown;
}

export class OpenAIUsageError extends Error {}
const fail = (message: string): never => { throw new OpenAIUsageError(message); };
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function bearer(auth: { apiKey?: string; headers?: Record<string, string | null> }): string | undefined {
  const entries = Object.entries(auth.headers ?? {}).filter(([key]) => key.toLowerCase() === "authorization");
  if (entries.length > 1) return fail("ambiguous authorization headers");
  return entries.length === 1 ? /^Bearer\s+(.+)$/iu.exec(entries[0][1] ?? "")?.[1] : auth.apiKey;
}

/** Use Pi's fresh runtime auth (including refresh), never refresh or write OAuth tokens ourselves. */
export async function resolveOpenAIAuth(
  ctx: ExtensionContext,
  provider: OpenAIProvider,
  options: OpenAIAuthOptions,
): Promise<OpenAIAuth> {
  const { signal } = options;
  const read = options.readCredential ?? ((id: string) => readStoredCredential(id, join(options.agentDir, "auth.json")));
  const resolve = async (id: OpenAIProvider) => {
    signal.throwIfAborted();
    const result = await ctx.modelRegistry.getProviderAuth(id);
    signal.throwIfAborted();
    if (result?.source !== "OAuth") return fail(`use /login ${id} (API keys have no subscription quota)`);
    const access = bearer(result.auth);
    const credential = object(read(id));
    if (!access || credential?.type !== "oauth" || credential.access !== access || !nonempty(credential.refresh) ||
        typeof credential.expires !== "number" || !Number.isFinite(credential.expires)) {
      return fail(`runtime OAuth does not match stored ${id} login`);
    }
    if (ctx.model?.provider === id) {
      const selected = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      signal.throwIfAborted();
      if (!selected.ok || bearer(selected) !== access) return fail("model authorization overrides its OAuth login");
      const expected = id === "openai" ? "https://api.openai.com" : "https://chatgpt.com";
      try {
        if (new URL(selected.baseUrl ?? ctx.model.baseUrl).origin !== expected) return fail("custom model endpoint is not native OpenAI");
      } catch (error) {
        if (error instanceof OpenAIUsageError) throw error;
        return fail("invalid native OpenAI endpoint");
      }
    }
    return { access, credential };
  };
  const native = await resolve(provider);
  let clientId: string | undefined;
  if (provider === "openai") {
    if (!nonempty(native.credential.clientId) || !Array.isArray(native.credential.scopes) ||
        !native.credential.scopes.includes("chatgpt.tokens.use.direct")) return fail("reconnect with /login openai");
    clientId = native.credential.clientId;
    if (!options.useCodexForOpenAI) {
      return { fingerprint: hash([provider, native.access, clientId]) };
    }
  }
  const codex = provider === "openai-codex" ? native : await resolve("openai-codex");
  let accountId: unknown;
  try {
    const parts = codex.access.split(".");
    if (parts.length === 3) {
      const payload = object(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
      accountId = object(payload?.["https://api.openai.com/auth"])?.chatgpt_account_id;
    }
  } catch { /* Invalid token claims fail closed below. */ }
  if (!nonempty(accountId) || accountId.length > 512 || !/^[\x21-\x7e]+$/u.test(accountId) ||
      accountId !== codex.credential.accountId) return fail("Codex OAuth account identity mismatch");
  return {
    fingerprint: hash([provider, native.access, codex.access, accountId, clientId]),
    headers: { Authorization: `Bearer ${codex.access}`, "ChatGPT-Account-Id": accountId },
    clientId,
  };
}

const hash = (values: unknown[]): string => createHash("sha256").update(JSON.stringify(values)).digest("hex");
const percent = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

function parseWindow(raw: unknown, now: number): OpenAIWindow {
  const value = object(raw);
  const used = value?.used_percent;
  const seconds = value?.limit_window_seconds;
  const reset = value?.reset_at;
  const after = value?.reset_after_seconds;
  if (!percent(used) || typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0 ||
      (value?.remaining_percent !== undefined && (!percent(value.remaining_percent) || Math.abs(used + value.remaining_percent - 100) > 1)) ||
      (reset !== undefined && reset !== null && (typeof reset !== "number" || !Number.isSafeInteger(reset) || reset < 0 || reset > 8_640_000_000_000)) ||
      (after !== undefined && after !== null && (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0 || after > 8_640_000_000_000))) {
    return fail("invalid OpenAI usage window");
  }
  return {
    usedPercent: used,
    seconds,
    resetsAt: typeof reset === "number" ? reset * 1000 : typeof after === "number" ? now + after * 1000 : null,
  };
}

export function parseCodexUsage(payload: unknown, now: number): OpenAIWindow[] {
  const limits = object(object(payload)?.rate_limit);
  const windows = [limits?.primary_window, limits?.secondary_window]
    .filter((value) => value !== null && value !== undefined).map((value) => parseWindow(value, now));
  if (windows.length === 0) return fail("OpenAI returned no quota windows");
  return windows;
}

/** Registration matching is a routing check, not independent proof of the same user/workspace. */
export function parseOpenAIAppUsage(payload: unknown, clientId: string, now: number): OpenAIWindow[] {
  const root = object(payload);
  if (!root || !Array.isArray(root.items) || root.items.length > 128 ||
      Object.keys(root).some((key) => !["items", "has_more", "next_cursor"].includes(key)) ||
      (root.has_more !== undefined && root.has_more !== false) ||
      (root.next_cursor !== undefined && root.next_cursor !== null && root.next_cursor !== "")) {
    return fail("incomplete ChatGPT app list (pagination unsupported)");
  }
  const apps = root.items.map(object);
  if (apps.some((app) => !nonempty(app?.id))) return fail("invalid ChatGPT app registration");
  const matches = apps.filter((app) => app?.id === clientId);
  if (!clientId || matches.length !== 1) return fail("app not uniquely found; check account/workspace for both logins");
  const windows = matches[0]?.windows;
  if (!Array.isArray(windows) || windows.length === 0 || windows.length > 32) return fail("OpenAI app has no valid quota windows");
  return windows.map((window) => parseWindow(window, now));
}

export async function fetchOpenAIUsage(options: {
  auth: OpenAIAuth;
  signal: AbortSignal;
  guard: () => Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}): Promise<OpenAIUsage> {
  const { auth } = options;
  if (!auth.headers) return fail("native OpenAI has no numerical usage API; enable Codex companion usage");
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]);
  // Node 22 global fetch ignores HTTP(S)_PROXY. Keep a request-local dispatcher,
  // honoring NO_PROXY without changing the host process's global networking.
  const dispatcher = options.fetchImpl ? undefined : new EnvHttpProxyAgent();
  const fetchImpl = options.fetchImpl ?? ((url, init) => undiciFetch(String(url), {
    method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)),
    signal: init?.signal, redirect: init?.redirect, dispatcher,
  }) as unknown as Promise<Response>) as typeof fetch;
  const read = async (url: string): Promise<unknown> => {
    signal.throwIfAborted();
    await options.guard();
    signal.throwIfAborted();
    const response = await fetchImpl(url, {
      method: "GET", redirect: "error", signal,
      headers: { ...auth.headers, Accept: "application/json", "User-Agent": "pi-sub2api-usage" },
    });
    if (!response.ok) return fail(`OpenAI usage HTTP ${response.status}${response.status === 401 ? "; reconnect with /login openai-codex" : ""}`);
    const payload: unknown = await response.json();
    signal.throwIfAborted();
    await options.guard();
    signal.throwIfAborted();
    return payload;
  };
  const now = options.now ?? Date.now;
  try {
    // Never substitute Codex-only limits for native OpenAI app usage.
    const app = auth.clientId ? parseOpenAIAppUsage(await read(`${OPENAI_USAGE_URL}/chatpass/apps`), auth.clientId, now()) : [];
    const plan = parseCodexUsage(await read(OPENAI_USAGE_URL), now());
    return { plan, app };
  } finally {
    await dispatcher?.destroy();
  }
}

export function formatOpenAIChip(provider: OpenAIProvider, usage: OpenAIUsage, now: number): string {
  const render = (windows: OpenAIWindow[]) => windows.map((window) => {
    const label = window.seconds % 86_400 === 0 ? `${window.seconds / 86_400}d`
      : window.seconds % 3_600 === 0 ? `${window.seconds / 3_600}h` : `${Math.ceil(window.seconds / 60)}m`;
    return `${label} ${Math.round(100 - window.usedPercent)}%${window.resetsAt === null ? "" : ` ↻ ${formatCountdown(window.resetsAt, now)}`}`;
  }).join(" ");
  return truncateChip(`📊 ${provider} ${usage.app.length ? "plan " : ""}${render(usage.plan)}${usage.app.length ? ` app ${render(usage.app)}` : ""}`, 180);
}

/** Only known, locally authored errors may reach the UI; never print server bodies or auth errors. */
export const openAIErrorText = (error: unknown): string => error instanceof OpenAIUsageError
  ? error.message : "usage request failed (network/auth/timeout)";
