import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SnapshotCache } from "../vendor/pi-token-usage/cache.ts";
import { collectUsage } from "../vendor/pi-token-usage/collector.ts";
import { cacheHitRate } from "../vendor/pi-token-usage/query.ts";
import type { ModelIdentity, UsageReport } from "../vendor/pi-token-usage/types.ts";

function compactCount(value: number): string {
  for (const [size, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (value >= size) return `${(value / size).toFixed(1)}${suffix}`;
  }
  return String(value);
}

/** Value only: the statusline owns the configurable single-icon prefix. */
export function formatRollingUsage(report?: UsageReport, failed = false): string {
  if (failed) return "unavailable";
  if (!report) return "…";
  const rate = cacheHitRate(report.usage);
  return `${compactCount(report.usage.totalTokens)} CH ${rate === undefined ? "—" : `${(rate * 100).toFixed(1)}%`}`;
}

type Options = {
  agentDir: string;
  collect?: typeof collectUsage;
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};
type Owner = { ctx: ExtensionContext; models: ModelIdentity[]; scope: string };

/** Disk I/O never runs inside render. At most one scan, including across session replacements. */
export function createRollingUsageController(options: Options) {
  const collect = options.collect ?? collectUsage;
  const now = options.now ?? Date.now;
  const every = options.setInterval ?? setInterval;
  const cancelEvery = options.clearInterval ?? clearInterval;
  const later = options.setTimeout ?? setTimeout;
  const cancelLater = options.clearTimeout ?? clearTimeout;
  const memoryCache = new SnapshotCache();
  let owner: Owner | undefined;
  let activeContext: ExtensionContext | undefined;
  let onChange: (() => void) | undefined;
  let text = "…";
  let inFlight = false;
  let dirty = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  function publish(next: string): void {
    if (next === text) return;
    text = next;
    onChange?.();
  }
  function select(ctx: ExtensionContext): Owner {
    const models = (ctx.scopedModels.length ? ctx.scopedModels.map(entry => entry.model) : ctx.modelRegistry.getAvailable())
      .map(({ provider, id }) => ({ provider, id }));
    return { ctx, models, scope: JSON.stringify(models) };
  }
  function publishCurrent(current: Owner, nextText: string): void {
    if (owner !== current || !activeContext) return;
    // /models mutates the live scopedModels getter without model_select.
    // Never publish success OR failure for a scope that changed during I/O.
    let latest: Owner;
    try { latest = select(activeContext); } catch {
      owner = undefined;
      publish("unavailable");
      return;
    }
    if (latest.scope !== current.scope) {
      owner = latest;
      dirty = true;
      publish("…");
      return;
    }
    publish(nextText);
  }
  async function run(): Promise<void> {
    if (!owner) return;
    if (inFlight) { dirty = true; return; }
    const current = owner;
    inFlight = true;
    dirty = false;
    try {
      const end = now();
      // Calendar midnight in the host's local timezone, including DST changes.
      const start = new Date(end).setHours(0, 0, 0, 0);
      const report = await collect({
        roots: [join(options.agentDir, "sessions"), current.ctx.sessionManager.getSessionDir()],
        cacheDir: join(options.agentDir, "pi-token-usage", "cache-v1"),
        range: { start, end, amount: (end - start) / 3600000, unit: "h" }, memoryCache, allowedModels: current.models,
      });
      publishCurrent(current, formatRollingUsage(report));
    } catch {
      publishCurrent(current, formatRollingUsage(undefined, true));
    } finally {
      inFlight = false;
      if (dirty && owner) void run();
    }
  }
  function refresh(ctx: ExtensionContext, immediate = false): void {
    if (!activeContext || ctx.mode !== "tui" || !ctx.hasUI) return;
    activeContext = ctx;
    try {
      const next = select(ctx);
      if (!owner || ctx.sessionManager !== owner.ctx.sessionManager || next.scope !== owner.scope) {
        owner = next;
        publish("…");
      } else owner.ctx = ctx;
    } catch {
      // Invalidate any earlier request when model scope cannot be resolved.
      owner = undefined;
      publish("unavailable");
      return;
    }
    if (inFlight) { dirty = true; return; }
    if (immediate) {
      if (debounce) cancelLater(debounce);
      debounce = undefined;
      void run();
      return;
    }
    if (debounce) return;
    debounce = later(() => { debounce = undefined; void run(); }, 250);
    debounce.unref?.();
  }
  function dispose(): void {
    if (interval) cancelEvery(interval);
    if (debounce) cancelLater(debounce);
    interval = debounce = undefined;
    owner = undefined;
    activeContext = undefined;
    onChange = undefined;
    dirty = false;
    text = "…";
  }
  return {
    getText: () => text,
    refresh,
    start(ctx: ExtensionContext, changed: () => void): void {
      dispose();
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      onChange = changed;
      activeContext = ctx;
      interval = every(() => {
        // Refresh scope too: changes in another catalogue operation must not leave old totals visible.
        if (activeContext) refresh(activeContext, true);
      }, 60000);
      interval.unref?.();
      try { owner = select(ctx); } catch { publish("unavailable"); return; }
      void run();
    },
    dispose,
  };
}
