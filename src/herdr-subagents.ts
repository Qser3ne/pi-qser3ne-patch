import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { countRunningSubagents, createForegroundTracker, isRecord, type ActivityCount } from "./herdr-activity.ts";
import { attachHerdrStatusBridge } from "./herdr-status-bridge.ts";

const WIDGET_KEY = "qser3ne-herdr-subagents:terminal";
const REQUEST_EVENT = "subagents:rpc:v1:request";
const REPLY_PREFIX = "subagents:rpc:v1:reply:";
const CHANGE_EVENTS = [
  "subagents:rpc:v1:ready", "subagent:jobs-changed", "subagent:async-started",
  "subagent:async-complete", "subagent:child-status", "subagent:process-terminal",
];

type ToolUpdate = { toolName: string; toolCallId: string; args: unknown; partialResult: unknown };
type ActiveSession = { update(event: ToolUpdate): void; end(toolCallId: string): void; dispose(): void };

export default function herdrSubagents(pi: ExtensionAPI): void {
  let active: ActiveSession | undefined;
  function cleanup(): void { active?.dispose(); active = undefined; }

  pi.on("session_start", (_event, ctx) => {
    cleanup();
    if (ctx.mode !== "tui" || !process.stdout.isTTY || !process.env.HC_TERMINAL_ID?.trim()
      || process.env.PI_PROGRAM_STATUS === "0" || process.env.PI_SUBAGENT_CHILD === "1") return;
    let bridge: ReturnType<typeof attachHerdrStatusBridge> | undefined;
    // Public widget factory grants access to the terminal without replacing the footer.
    try {
      ctx.ui.setWidget(WIDGET_KEY, (tui) => {
        if (typeof tui.terminal.setProgramStatus === "function") {
          bridge = attachHerdrStatusBridge(tui.terminal, ctx.isIdle()
            ? { state: "idle", app: "pi" }
            : { state: "working", app: "pi", message: ctx.sessionManager.getSessionName() });
        }
        return { render: () => [], invalidate() {} };
      });
    } finally {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
    if (!bridge) return;
    const terminalBridge = bridge;
    const foreground = createForegroundTracker();
    let background: ActivityCount = { count: 0, approximate: false };
    let disposed = false;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let pending: { cancel(): void } | undefined;
    let dirty = false;
    const subscriptions: (() => void)[] = [];
    const publish = () => terminalBridge.setActivity(background.count + foreground.count, background.approximate);

    function refresh(): void {
      if (disposed) return;
      if (pending) { dirty = true; return; }
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = undefined;
        requestStatus();
      }, 25);
      scheduled.unref?.();
    }
    function requestStatus(): void {
      if (disposed) return;
      dirty = false;
      const requestId = randomUUID();
      let finished = false;
      let timeout: ReturnType<typeof setTimeout>;
      let unsubscribe = () => {};
      const finish = (snapshot?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        unsubscribe();
        pending = undefined;
        if (disposed) return;
        // Failure drops only our background overlay, never changes parent/foreground state.
        background = snapshot === undefined ? { count: 0, approximate: false } : countRunningSubagents(snapshot);
        publish();
        if (dirty) refresh();
      };
      unsubscribe = pi.events.on(`${REPLY_PREFIX}${requestId}`, (raw) => {
        if (!isRecord(raw) || raw.version !== 1 || raw.requestId !== requestId) return;
        finish(raw.success === true && isRecord(raw.data) ? raw.data.asyncSnapshot : undefined);
      });
      timeout = setTimeout(() => finish(), 2000);
      timeout.unref?.();
      pending = { cancel() { finished = true; clearTimeout(timeout); unsubscribe(); } };
      try {
        pi.events.emit(REQUEST_EVENT, { version: 1, requestId, method: "status" });
      } catch {
        finish();
      }
    }
    for (const name of CHANGE_EVENTS) subscriptions.push(pi.events.on(name, refresh));
    // Slash execution bypasses Pi tool events. Observe its package-owned progress
    // bridge too; retain only eligibility, never task text or the supplied context.
    const foregroundSlash = new Set<string>();
    subscriptions.push(pi.events.on("subagent:slash:request", (raw) => {
      if (!isRecord(raw) || typeof raw.requestId !== "string" || !isRecord(raw.params)) return;
      if (raw.params.async !== true && raw.params.script === undefined && raw.params.workflow === undefined) foregroundSlash.add(raw.requestId);
    }));
    subscriptions.push(pi.events.on("subagent:slash:update", (raw) => {
      if (!isRecord(raw) || typeof raw.requestId !== "string" || !foregroundSlash.has(raw.requestId)) return;
      foreground.update(`slash:${raw.requestId}`, { mode: "parallel", progress: raw.progress });
      publish();
    }));
    subscriptions.push(pi.events.on("subagent:slash:response", (raw) => {
      if (!isRecord(raw) || typeof raw.requestId !== "string" || !foregroundSlash.delete(raw.requestId)) return;
      foreground.close(`slash:${raw.requestId}`);
      publish();
      refresh();
    }));
    active = {
      update(event): void {
        if (disposed || event.toolName !== "subagent") return;
        const args = isRecord(event.args) ? event.args : {};
        const details = isRecord(event.partialResult) ? event.partialResult.details : undefined;
        // Script/workflow progress is already in the canonical snapshot. An async
        // placeholder may also say "running" before a queued child actually starts.
        if (args.async === true || args.script !== undefined || args.workflow !== undefined
          || (isRecord(details) && details.background === true)) return;
        foreground.update(event.toolCallId, details);
        publish();
      },
      end(toolCallId): void {
        if (disposed) return;
        foreground.close(toolCallId);
        publish();
        refresh();
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        if (scheduled) clearTimeout(scheduled);
        pending?.cancel();
        for (const unsubscribe of subscriptions) unsubscribe();
        terminalBridge.dispose();
      },
    };
    refresh();
  });

  pi.on("tool_execution_update", (event) => active?.update(event));
  pi.on("tool_execution_end", (event) => { if (event.toolName === "subagent") active?.end(event.toolCallId); });
  pi.on("session_shutdown", cleanup);
}
