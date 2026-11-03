import {
  createAssistantMessageEventStream,
  type AssistantMessage, type AssistantMessageEventStream, type Message,
  type Model, type Provider, type StreamOptions, type TranscriptContext,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

export const CODEX_ACCOUNT_PROVIDER = "openai-codex-1";
type CodexApi = "openai-codex-responses";
const NATIVE_PROVIDER = "openai-codex";

/** Keep account identity in Pi; only canonicalize inside the native wire adapter. */
function wireContext(context: TranscriptContext): TranscriptContext {
  return {
    ...context,
    messages: context.messages.map((message): Message => {
      if (message.role !== "assistant") return message;
      if (message.provider === CODEX_ACCOUNT_PROVIDER) return { ...message, provider: NATIVE_PROVIDER };
      // A reply from the first account must stay foreign to the second account:
      // native transforms drop its encrypted reasoning/signatures on handoff.
      if (message.provider === NATIVE_PROVIDER) return { ...message, provider: "codex-other-account" };
      return message;
    }),
  };
}

function wireOptions<T extends StreamOptions>(options: T | undefined, model: Model<CodexApi>): T | undefined {
  if (!options) return undefined;
  return {
    ...options,
    onPayload: options.onPayload ? (payload) => options.onPayload!(payload, model) : undefined,
    onResponse: options.onResponse ? (response) => options.onResponse!(response, model) : undefined,
    onProviderStreamEvent: options.onProviderStreamEvent ? (data) => options.onProviderStreamEvent!(data, model) : undefined,
  };
}

/** Never mutate the inner message: native continuation/tool handling still uses it. */
function accountStream(inner: AssistantMessageEventStream, model: Model<CodexApi>, signal?: AbortSignal): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const mapped = new WeakMap<AssistantMessage, AssistantMessage>();
  const remap = (message: AssistantMessage): AssistantMessage => {
    let result = mapped.get(message);
    if (!result) {
      result = { ...message, provider: CODEX_ACCOUNT_PROVIDER };
      mapped.set(message, result);
    } else {
      Object.assign(result, message, { provider: CODEX_ACCOUNT_PROVIDER });
    }
    return result;
  };
  void (async () => {
    try {
      for await (const event of inner) {
        if ("partial" in event) output.push({ ...event, partial: remap(event.partial) });
        else if (event.type === "done") output.push({ ...event, message: remap(event.message) });
        else output.push({ ...event, error: remap(event.error) });
      }
      output.end(remap(await inner.result()));
    } catch {
      const error: AssistantMessage = {
        role: "assistant", api: model.api, model: model.id, provider: CODEX_ACCOUNT_PROVIDER,
        content: [], timestamp: Date.now(), stopReason: signal?.aborted ? "aborted" : "error",
        errorMessage: "Codex account stream failed",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      output.push({ type: "error", reason: error.stopReason as "error" | "aborted", error });
      output.end();
    }
  })();
  return output;
}

/**
 * A complete native provider, not an alias that resolves auth through the first
 * account. Pi owns login/refresh/logout and stores credentials under this ID.
 */
export function createCodexAccountProvider(base: Provider<CodexApi> = openaiCodexProvider()): Provider<CodexApi> {
  const oauth = base.auth.oauth;
  if (!oauth) throw new Error("Native Codex OAuth support is required");
  return {
    ...base,
    id: CODEX_ACCOUNT_PROVIDER,
    name: "OpenAI Codex (openai-codex-1, account 2)",
    auth: {
      oauth: {
        ...oauth,
        name: "OpenAI Codex — second account",
        async login(interaction, options) {
          interaction.notify({ type: "info", message: "Sign in with your SECOND ChatGPT account. Use a separate/private browser profile if the browser automatically selects your first account." });
          return oauth.login(interaction, options);
        },
      },
    },
    getModels: () => base.getModels().map((model) => ({ ...model, provider: CODEX_ACCOUNT_PROVIDER })),
    getAllModels: () => (base.getAllModels?.() ?? base.getModels()).map((model) => ({ ...model, provider: CODEX_ACCOUNT_PROVIDER })),
    stream(model, context, options) {
      return accountStream(base.stream({ ...model, provider: NATIVE_PROVIDER }, wireContext(context), wireOptions(options, model)), model, options?.signal);
    },
    streamSimple(model, context, options) {
      return accountStream(base.streamSimple({ ...model, provider: NATIVE_PROVIDER }, wireContext(context), wireOptions(options, model)), model, options?.signal);
    },
  };
}
