import type { Runtime } from "./statusline.ts";
import { createRuntime as createSub2ApiRuntime } from "./statusline.ts";
import { createOpenAIRuntime, type OpenAIRuntimeDeps } from "./openai-runtime.ts";
import { isOpenAIProvider } from "./openai.ts";

/** One status owner at a time; late requests from the previous provider are cancelled. */
export function createRuntime(deps: OpenAIRuntimeDeps): Runtime {
  const sub2api = createSub2ApiRuntime(deps);
  const openai = createOpenAIRuntime(deps);
  let active: Runtime | undefined;
  const select = (ctx: Parameters<Runtime["handleEvent"]>[0], provider?: string) => {
    const next = isOpenAIProvider(provider) ? openai : sub2api;
    if (active !== next) active?.shutdown(ctx);
    active = next;
    return next;
  };
  return {
    handleEvent(ctx, model) { select(ctx, model?.provider).handleEvent(ctx, model); },
    runManualCheck(ctx) { return select(ctx, ctx.model?.provider).runManualCheck(ctx); },
    shutdown(ctx) { active?.shutdown(ctx); active = undefined; },
  };
}
