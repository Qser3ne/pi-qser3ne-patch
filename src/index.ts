import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createRuntime } from "./runtime.ts";
import { isOpenAIProvider } from "./openai.ts";
import { createCodexAccountProvider } from "./codex-accounts.ts";
import daybreak from "./daybreak.ts";
import tokenSpeedExtension from "./token-speed.ts";
import usageExtension from "../vendor/pi-usage/index.ts";

export { createRuntime } from "./runtime.ts";

export default function qser3nePatchExtension(pi: ExtensionAPI): void {
  // Preserve the former package order for shared lifecycle/request hooks.
  tokenSpeedExtension(pi);
  daybreak(pi);
  pi.registerProvider(createCodexAccountProvider());
  const runtime = createRuntime({ agentDir: getAgentDir() });
  pi.on("session_start", (_event, ctx) => runtime.handleEvent(ctx, ctx.model));
  pi.on("session_tree", (_event, ctx) => runtime.handleEvent(ctx, ctx.model));
  pi.on("model_select", (event, ctx) => runtime.handleEvent(ctx, event.model));
  pi.on("turn_start", (_event, ctx) => runtime.handleEvent(ctx, ctx.model));
  pi.on("session_shutdown", (_event, ctx) => runtime.shutdown(ctx));
  pi.registerCommand("sub2api-usage", {
    description: "Force-refresh current provider quota (Sub2API or native OpenAI/Codex)",
    handler: async (_args, ctx) => {
      await runtime.runManualCheck(ctx);
    },
  });
  pi.registerCommand("openai-usage", {
    description: "Force-refresh native OpenAI/Codex subscription quota",
    handler: async (_args, ctx) => {
      if (!isOpenAIProvider(ctx.model?.provider)) {
        ctx.ui.notify("Select an openai-codex or openai-codex-1 model first.", "info");
        return;
      }
      await runtime.runManualCheck(ctx);
    },
  });
  usageExtension(pi);
}
