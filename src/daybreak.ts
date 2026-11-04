import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATE_TYPE = "daybreak-blue-state";
const STATUS_KEY = "daybreak";
const HELP = "/daybreak 切换 · /daybreak on 开启 · /daybreak off 关闭 · /daybreak status 查看状态";

type SelectedModel = ExtensionContext["model"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep account-scoped access selection off unrelated providers and proxy endpoints. */
function supportsDaybreak(model: SelectedModel): boolean {
  if (!model || !["openai", "openai-codex"].includes(model.provider)) return false;
  if (!["openai-responses", "openai-codex-responses"].includes(model.api)) return false;
  try {
    const url = new URL(model.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    return model.api === "openai-codex-responses"
      ? url.origin === "https://chatgpt.com" && /^\/backend-api(?:\/|$)/.test(url.pathname)
      : url.origin === "https://api.openai.com" && /^\/v1(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

export default function daybreak(pi: ExtensionAPI) {
  let enabled = false;
  let result: "pending" | "confirmed" | "error" = "pending";
  let lastError: string | undefined;
  let requestModel: string | undefined;

  function resetConfirmation() {
    result = "pending";
    lastError = undefined;
    requestModel = undefined;
  }

  // Plain text lets pi-statusline select its own colors and leading emoji icon.
  // Do not call setFooter(): pi-statusline retains ownership of the footer.
  function updateStatus(ctx: ExtensionContext, model = ctx.model) {
    ctx.ui.setStatus(
      STATUS_KEY,
      enabled
        ? `🛡️ Daybreak Blue ${!supportsDaybreak(model) ? "unavailable" : result === "confirmed" ? "active" : result === "error" ? "error" : "requested"}`
        : undefined,
    );
  }

  function restore(ctx: ExtensionContext) {
    enabled = false;
    resetConfirmation();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
      if (isRecord(entry.data) && entry.data.version === 1 && typeof entry.data.enabled === "boolean") {
        enabled = entry.data.enabled;
      }
    }
    updateStatus(ctx);
  }

  function describe(ctx: ExtensionContext): string {
    if (!enabled) return "Daybreak Blue 已关闭。";
    if (!supportsDaybreak(ctx.model)) {
      return "Daybreak Blue 已开启但暂停：当前模型/端点不支持，不会注入参数。请用 /model 选择官方 OpenAI Responses 模型。";
    }
    const selected = `${ctx.model!.provider}/${ctx.model!.id}`;
    if (result === "error") {
      return `Daybreak Blue 请求模式已开启，但最近请求失败：${lastError}。可切换支持 Daybreak 的模型（例如 openai-codex/gpt-6-sol），或 /daybreak off；不会静默降级。`;
    }
    if (result === "confirmed") {
      return `Daybreak Blue 已由服务端确认：${selected} 的完成响应明确回传 access_programs.cyber=daybreak_blue。`;
    }
    return `Daybreak Blue 请求模式已开启（尚未获服务端确认）：${selected} 的后续请求将携带 access_programs.cyber=daybreak_blue。账号与模型是否支持由 OpenAI 服务端校验。`;
  }

  pi.registerCommand("daybreak", {
    description: "切换 Daybreak Blue 请求模式（on / off / status / help）",
    getArgumentCompletions: (prefix) => {
      const items = ["on", "off", "status", "help"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "help") {
        ctx.ui.notify(HELP, "info");
        return;
      }
      if (action === "status") {
        updateStatus(ctx);
        ctx.ui.notify(describe(ctx), enabled && (!supportsDaybreak(ctx.model) || result === "error") ? "warning" : "info");
        return;
      }
      if (!["", "on", "off"].includes(action)) {
        ctx.ui.notify(`无效参数。${HELP}`, "error");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("请等待当前回复结束或先按 Esc 停止，再切换 Daybreak Blue。", "warning");
        return;
      }
      const next = action === "" ? !enabled : action === "on";
      if (next && !supportsDaybreak(ctx.model)) {
        ctx.ui.notify("无法开启：请选择官方 openai-codex 或 openai 的 Responses 模型；不会自动切换模型或修改代理配置。", "warning");
        return;
      }
      if (enabled !== next) {
        // Session-only, branch-aware state; never modify auth.json or model defaults.
        pi.appendEntry(STATE_TYPE, { version: 1, enabled: next });
        enabled = next;
        resetConfirmation();
      }
      updateStatus(ctx);
      ctx.ui.notify(describe(ctx), result === "error" ? "warning" : "info");
    },
  });

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("model_select", (event, ctx) => {
    resetConfirmation();
    updateStatus(ctx, event.model);
    if (enabled && !supportsDaybreak(event.model)) {
      ctx.ui.notify("Daybreak Blue 已暂停：当前模型/端点不支持。切回官方 OpenAI Responses 模型后自动恢复。", "warning");
    }
  });
  pi.on("session_shutdown", (_event, ctx) => {
    enabled = false;
    resetConfirmation();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  // Only a successful response explicitly echoing the program counts as confirmed.
  pi.on("provider_stream_event", (event, ctx) => {
    if (!enabled || !ctx.model || event.provider !== ctx.model.provider || event.model !== requestModel) return;
    const data = event.data;
    if (!isRecord(data) || !["response.completed", "response.done"].includes(String(data.type))) return;
    const response = data.response;
    if (!isRecord(response) || response.status !== "completed" || !isRecord(response.access_programs)) return;
    if (response.access_programs.cyber !== "daybreak_blue") return;
    result = "confirmed";
    lastError = undefined;
    updateStatus(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (!enabled || message.role !== "assistant" || message.provider !== ctx.model?.provider || message.model !== requestModel) return;
    if (message.stopReason !== "error") return;
    result = "error";
    lastError = message.errorMessage || "未知错误";
    updateStatus(ctx);
    if (/daybreak|access_programs/i.test(lastError)) ctx.ui.notify(describe(ctx), "warning");
  });

  // Pi calls this before serialization for both SSE and WebSocket transports.
  // Retain all original request fields and any other access-program selections.
  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || !supportsDaybreak(ctx.model)) return;
    const payload = event.payload;
    // The hook does not expose the request model: avoid modifying auxiliary requests
    // for a different model (e.g. compaction routed elsewhere by another extension).
    if (!isRecord(payload) || payload.model !== ctx.model!.id || !Array.isArray(payload.input)) return;
    resetConfirmation();
    requestModel = ctx.model!.id;
    updateStatus(ctx);
    return {
      ...payload,
      access_programs: {
        ...(isRecord(payload.access_programs) ? payload.access_programs : {}),
        cyber: "daybreak_blue",
      },
    };
  });
}
