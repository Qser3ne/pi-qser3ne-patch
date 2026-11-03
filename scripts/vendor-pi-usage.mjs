// Rebuild the compatibility entry from the exact upstream npm release.
// Install dev dependencies, then run: npm run vendor:pi-usage
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const upstream = process.argv[2] ?? dirname(require.resolve("@narumitw/pi-usage/package.json"));
const manifest = JSON.parse(readFileSync(join(upstream, "package.json"), "utf8"));
assert.equal(manifest.name, "@narumitw/pi-usage");
assert.equal(manifest.version, "0.69.0", "review patches before upgrading upstream");
const target = process.argv[3] ?? join(root, "vendor/pi-usage");
const files = ["index.ts", "chunks/chunk-MNR6ZE2W.ts", "chunks/openai-companion-auth-HDUEMR3L.ts", "chunks/openai-companion-usage-GI4ZWMTO.ts"];
const hashes = {};
function replaceOnce(source, oldText, newText) {
  assert.equal(source.split(oldText).length - 1, 1, `upstream patch must match exactly once: ${oldText}`);
  return source.replace(oldText, newText);
}
for (const file of files) {
  let code = readFileSync(join(upstream, "dist", file), "utf8");
  hashes[file] = createHash("sha256").update(code).digest("hex");
  if (file === "index.ts") {
    code = replaceOnce(code, 'if (model?.provider !== "openai-codex") return { kind: "not-codex" };', 'if (!["openai-codex", "openai-codex-1"].includes(model?.provider)) return { kind: "not-codex" };');
    code = replaceOnce(code, 'if (model?.provider !== "openai-codex" || !hasApi(model, "openai-codex-responses")) {', 'if (!["openai-codex", "openai-codex-1"].includes(model?.provider) || !hasApi(model, "openai-codex-responses")) {');
    code = replaceOnce(code, 'if (ctx.model?.provider !== "openai-codex") {', 'if (!["openai-codex", "openai-codex-1"].includes(ctx.model?.provider)) {');
    code = replaceOnce(code, 'if (model?.provider !== "openai-codex") {\n    throw new Error("Usage limit resets require the current model to use OpenAI Codex.");', 'if (!["openai-codex", "openai-codex-1"].includes(model?.provider)) {\n    throw new Error("Usage limit resets require the current model to use OpenAI Codex.");');
    code = replaceOnce(code,
      'const adapter = adapterForProvider("openai-codex");\n  if (!adapter) throw new Error("OpenAI Codex usage support is unavailable.");',
      'const nativeAdapter = adapterForProvider("openai-codex");\n  if (!nativeAdapter) throw new Error("OpenAI Codex usage support is unavailable.");\n  const adapter = { ...nativeAdapter, id: model.provider };');
    code = replaceOnce(code, 'candidateReader.waitUntilReady(ctx, "openai-codex")', 'candidateReader.waitUntilReady(ctx, model.provider)');
    code = replaceOnce(code, 'await candidateReader(ctx, "openai-codex") : fallbackOAuthCredentialCandidates("openai-codex", credentialReader)', 'await candidateReader(ctx, model.provider) : fallbackOAuthCredentialCandidates(model.provider, credentialReader)');
    // Keep transport request-local (Node 22 fetch ignores proxy environment variables).
    code = replaceOnce(code, 'redirect: "error",\n              maxSuccessBodyBytes: MAX_DIRECTORY_BODY_BYTES,', 'redirect: "error",\n              fetchImpl: options.fetchImpl,\n              maxSuccessBodyBytes: MAX_DIRECTORY_BODY_BYTES,');
    code = replaceOnce(code, 'timeoutMs: options.timeoutMs,\n    onChanged(ctx)', 'timeoutMs: options.timeoutMs,\n    fetchImpl: options.fetchImpl,\n    onChanged(ctx)');
    // pi-usage's quota formatter knows only the canonical provider. Publish a
    // separate alias Fast indicator without relabeling either account's quota.
    code = replaceOnce(code, '  const toggle = async (ctx, enabled, callerSignal) => {', `  const publishAliasFastStatus = (ctx) => {
    const enabled = settingsRuntime.get().settings.codexFastMode;
    const availability = codexFastAvailability(ctx.model, enabled, catalog.get(ctx.model));
    const text = ctx.model?.provider !== "openai-codex-1" || !enabled ? undefined :
      availability.kind === "available" ? "⚡ fast" :
      availability.kind === "unknown" ? "⚡ fast unknown" : undefined;
    ctx.ui.setStatus("qser3ne-codex-fast", text);
  };
  const upstreamRefreshStatus = refreshStatus;
  refreshStatus = (ctx) => { upstreamRefreshStatus(ctx); publishAliasFastStatus(ctx); };
  const toggle = async (ctx, enabled, callerSignal) => {`);
    code = replaceOnce(code, '  pi.on("model_select", (_event, ctx) => {\n    void refreshCapabilities(ctx);\n  });', '  pi.on("model_select", (_event, ctx) => {\n    publishAliasFastStatus(ctx);\n    void refreshCapabilities(ctx).then(() => {\n      if (!sessionController.signal.aborted) publishAliasFastStatus(ctx);\n    }).catch(() => {});\n  });');
    code = replaceOnce(code, '    return rewritten;\n  });\n  pi.on("message_end",', '    publishAliasFastStatus(ctx);\n    return rewritten;\n  });\n  pi.on("message_end",');
    code = replaceOnce(code, '  pi.on("session_shutdown", async () => {\n    generation += 1;', '  pi.on("session_shutdown", async (_event, ctx) => {\n    ctx.ui.setStatus("qser3ne-codex-fast", undefined);\n    generation += 1;');
    // Tests use the same upstream runtime, not a reimplementation of its rules.
    code = replaceOnce(code, '  CODEX_FAST_SERVICE_TIER,\n  CODEX_STANDARD_SERVICE_TIER,', '  registerCodexFastMode,\n  createCodexFastCatalog,\n  CODEX_FAST_SERVICE_TIER,\n  CODEX_STANDARD_SERVICE_TIER,');
  }
  if (file === "chunks/chunk-MNR6ZE2W.ts") {
    code = 'import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";\n' + code;
    code = replaceOnce(code, 'async function fetchProviderJson(url, auth, signal, timeoutMs, description, request = {}) {\n  const controller', 'async function fetchProviderJson(url, auth, signal, timeoutMs, description, request = {}) {\n  const dispatcher = request.fetchImpl ? undefined : new EnvHttpProxyAgent();\n  const controller');
    code = replaceOnce(code, 'const response = await fetch(url, {', 'const response = await (request.fetchImpl ?? proxyFetch)(url, {\n      dispatcher,');
    code = replaceOnce(code, 'signal.removeEventListener("abort", abortFromCaller);\n  }\n}\nasync function readBoundedResponse', 'signal.removeEventListener("abort", abortFromCaller);\n    await dispatcher?.destroy();\n  }\n}\nasync function readBoundedResponse');
    code = replaceOnce(code,
      'if (providerId === "openai-codex") return url.origin === "https://chatgpt.com";',
      'if (providerId === "openai-codex" || providerId === "openai-codex-1") return url.origin === "https://chatgpt.com";');
  }
  code = code.replace(/^\/\/# sourceMappingURL=.*$/gm, "").trimEnd() + "\n";
  code = '// @ts-nocheck -- generated upstream JavaScript uses .ts for the Pi loader.\n// Vendored @narumitw/pi-usage 0.69.0 (MIT). See LICENSE and README.md.\n// Generated by scripts/vendor-pi-usage.mjs; do not edit.\n' + code;
  mkdirSync(dirname(join(target, file)), { recursive: true });
  writeFileSync(join(target, file), code);
}
writeFileSync(join(target, "LICENSE"), readFileSync(join(upstream, "LICENSE")));
writeFileSync(join(target, "upstream.json"), JSON.stringify({ package: manifest.name, version: manifest.version, source: manifest.repository, sha256: hashes }, null, 2) + "\n");
console.log("Generated pi-usage 0.69.0 compatibility entry (independent Codex account Fast support).");
