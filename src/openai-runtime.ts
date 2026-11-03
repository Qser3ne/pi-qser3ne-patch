import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadSettings } from "./settings.ts";
import type { Runtime, RuntimeDeps } from "./statusline.ts";
import {
  fetchOpenAIUsage, formatOpenAIChip, isOpenAIProvider, openAIErrorText,
  OPENAI_MANAGE_USAGE_URL, OpenAIUsageError, resolveOpenAIAuth,
  type OpenAIProvider, type OpenAIUsage,
} from "./openai.ts";

const STATUS_KEY = "sub2api-usage";
const FAILURE_BACKOFF_MS = 30_000;
const COUNTDOWN_MS = 60_000;

export interface OpenAIRuntimeDeps extends RuntimeDeps {
  readCredential?: (provider: string) => unknown;
}

export function createOpenAIRuntime(deps: OpenAIRuntimeDeps): Runtime {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimeoutImpl ?? setTimeout;
  const clearTimer = deps.clearTimeoutImpl ?? clearTimeout;
  let generation = 0;
  let controller: AbortController | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let countdownTimer: ReturnType<typeof setTimeout> | undefined;
  let cache: { key: string; usage: OpenAIUsage; at: number } | undefined;
  let failure: { key: string; until: number; text: string } | undefined;
  let warned = false;

  const safe = (fn: () => void) => {
    try { fn(); } catch (error) {
      if (!/stale|disposed/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  };
  const status = (ctx: ExtensionContext, value?: string) => safe(() => ctx.ui.setStatus(STATUS_KEY, value));
  const notify = (ctx: ExtensionContext, text: string, level: "info" | "warning" | "error") =>
    safe(() => ctx.ui.notify(text, level));
  const cancel = () => {
    generation += 1;
    controller?.abort();
    if (refreshTimer !== undefined) clearTimer(refreshTimer);
    if (countdownTimer !== undefined) clearTimer(countdownTimer);
    refreshTimer = countdownTimer = undefined;
    controller = new AbortController();
    return { gen: generation, signal: controller.signal };
  };
  const schedule = (ctx: ExtensionContext, provider: OpenAIProvider, gen: number, delay: number) => {
    refreshTimer = setTimer(() => {
      refreshTimer = undefined;
      if (generation === gen) handleEvent(ctx, { provider });
    }, Math.max(1, delay));
    refreshTimer.unref?.();
  };
  const publish = (ctx: ExtensionContext, provider: OpenAIProvider, usage: OpenAIUsage, gen: number) => {
    status(ctx, formatOpenAIChip(provider, usage, now()));
    if ([...usage.plan, ...usage.app].some((window) => window.resetsAt !== null && window.resetsAt > now())) {
      countdownTimer = setTimer(() => {
        countdownTimer = undefined;
        if (generation === gen) publish(ctx, provider, usage, gen);
      }, COUNTDOWN_MS);
      countdownTimer.unref?.();
    }
  };

  const check = async (ctx: ExtensionContext, provider: OpenAIProvider, manual: boolean) => {
    const { gen, signal } = cancel();
    const current = () => generation === gen && !signal.aborted;
    const loaded = loadSettings(deps.agentDir);
    const { settings } = loaded;
    if (loaded.broken && !warned) {
      warned = true;
      notify(ctx, "pi-sub2api-usage.json is invalid; using defaults (OpenAI companion disabled).", "warning");
    }
    status(ctx, `📊 ${provider} checking`);
    try {
      const options = {
        agentDir: deps.agentDir, signal, useCodexForOpenAI: settings.openai.useCodex,
        readCredential: deps.readCredential,
      };
      const auth = await resolveOpenAIAuth(ctx, provider, options);
      if (!current()) return;
      if (!auth.headers) {
        cache = failure = undefined;
        status(ctx, "📊 openai ChatGPT connected; quota needs Codex companion");
        if (manual) notify(ctx,
          `Native OpenAI has no supported numerical usage API. To query experimentally, /login openai-codex with the same ChatGPT account/workspace and set "openai": { "useCodex": true } in pi-sub2api-usage.json. Manage usage: ${OPENAI_MANAGE_USAGE_URL}`,
          "info");
        schedule(ctx, provider, gen, settings.refreshMs);
        return;
      }
      const key = auth.fingerprint;
      // Revalidate even cache hits so account switches/logout never reuse another login's quota.
      if (!manual && failure?.key === key && failure.until > now()) {
        status(ctx, `📊 ${provider} error: ${failure.text}`);
        schedule(ctx, provider, gen, failure.until - now());
        return;
      }
      if (!manual && cache?.key === key && cache.at + settings.refreshMs > now()) {
        publish(ctx, provider, cache.usage, gen);
        schedule(ctx, provider, gen, cache.at + settings.refreshMs - now());
        return;
      }
      const guard = async () => {
        signal.throwIfAborted();
        const fresh = await resolveOpenAIAuth(ctx, provider, options);
        signal.throwIfAborted();
        if (fresh.fingerprint !== auth.fingerprint) throw new OpenAIUsageError("OAuth login changed; refresh usage again");
      };
      try {
        const usage = await fetchOpenAIUsage({ auth, signal, guard, fetchImpl: deps.fetchImpl, now });
        if (!current()) return;
        cache = { key, usage, at: now() };
        failure = undefined;
        publish(ctx, provider, usage, gen);
        schedule(ctx, provider, gen, settings.refreshMs);
        if (manual) notify(ctx, `${JSON.stringify(usage, null, 2)}\nManage usage: ${OPENAI_MANAGE_USAGE_URL}${provider === "openai" ? "\nSource: experimental Codex companion; app registration matching is not independent account/workspace proof." : ""}`, "info");
      } catch (error) {
        if (current()) {
          cache = undefined;
          failure = { key, until: now() + FAILURE_BACKOFF_MS, text: openAIErrorText(error) };
        }
        throw error;
      }
    } catch (error) {
      if (!current()) return;
      // Failed auth invalidates previous numerical quota, including cached data.
      cache = undefined;
      const text = openAIErrorText(error);
      status(ctx, `📊 ${provider} error: ${text}`);
      if (manual) notify(ctx, text, "error");
      schedule(ctx, provider, gen, FAILURE_BACKOFF_MS);
    }
  };

  const handleEvent: Runtime["handleEvent"] = (ctx, model) => {
    if (!isOpenAIProvider(model?.provider)) return;
    void check(ctx, model.provider, false).catch(() => { /* UI context is no longer usable. */ });
  };
  const shutdown = (ctx: ExtensionContext) => {
    cancel();
    controller?.abort();
    controller = undefined;
    cache = failure = undefined;
    status(ctx);
  };
  const runManualCheck = async (ctx: ExtensionCommandContext) => {
    if (!isOpenAIProvider(ctx.model?.provider)) {
      notify(ctx, "Select a native openai or openai-codex model first.", "info");
      return;
    }
    await check(ctx, ctx.model.provider, true);
  };
  return { handleEvent, shutdown, runManualCheck };
}
