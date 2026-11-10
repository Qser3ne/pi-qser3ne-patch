// Regenerate the pinned source snapshot with small assertion-guarded patches.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const source = process.argv[2] ?? dirname(require.resolve("@narumitw/pi-statusline/package.json"));
const target = process.argv[3] ?? join(root, "vendor/pi-statusline");
const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
assert.equal(manifest.name, "@narumitw/pi-statusline");
assert.equal(manifest.version, "0.50.2", "review compatibility patches before upgrading");
function once(code, old, next) {
  assert.equal(code.split(old).length - 1, 1, `patch must match once: ${old}`);
  return code.replace(old, next);
}
function patch(file, code) {
  if (file === "types.ts") code = once(code, '  "context",', '  "context",\n  "usage24h",');
  if (file === "information-profiles.ts") {
    assert.equal(code.split('"context"').length - 1, 3);
    code = code.replaceAll('"context"', '"context", "usage24h"');
  }
  if (file === "presets/index.ts") code = once(code, '  context: "runtime",', '  context: "runtime",\n  usage24h: "runtime",');
  if (file === "powerline.ts") code = once(code, '  tools: 90,', '  tools: 90,\n  usage24h: 85,');
  if (file === "settings.ts") {
    code = once(code, '    context: { prefix: "🪟 ctx ", suffix: "" },', '    context: { prefix: "🪟 ctx ", suffix: "" },\n    usage24h: { prefix: "📊 ", suffix: "" },');
    code = once(code, '      config.segments = segments;', `      // Migrate old layouts in memory only. An explicit presentation marks an
      // integrated layout, so hiding/reordering the new segment stays effective.
      const contextIndex = segments.indexOf("context");
      if (contextIndex >= 0 && !segments.includes("usage24h") &&
          !(isRecord(value.segmentText) && Object.hasOwn(value.segmentText, "usage24h"))) {
        segments.splice(contextIndex + 1, 0, "usage24h");
      }
      config.segments = segments;`);
  }
  if (file === "commands.ts") {
    code = once(code, '  context: "Current context-window usage",', '  context: "Current context-window usage",\n  usage24h: "Local token total and aggregate cache hit rate since local midnight",');
    code = once(code, '  return { parsed, rawDocument };', `  // Persist the effective migrated layout and an explicit presentation marker.
  // Subsequent hide/reorder saves must not trigger the old-layout migration again.
  parsed.segments = [...current.config.segments];
  parsed.segmentText = {
    ...(isRecord(parsed.segmentText) ? parsed.segmentText : {}),
    usage24h: { ...current.config.segmentText.usage24h },
  };
  return { parsed, rawDocument };`);
    code = once(code, '      "Custom layout can show, hide, reorder, or split data segments across rows.",', '      "Custom layout can show, hide, reorder, or split data segments across rows.",\n      "usage24h: saved local usage for current model list since local midnight; CH is aggregate input cache hit rate.",');
  }
  if (file === "render.ts") {
    code = once(code, '  turnCount: number;', '  rollingUsageText?: string;\n  turnCount: number;');
    code = once(code, '    case "tokens": {', '    case "usage24h":\n      return segment(name, runtime.rollingUsageText ?? "…", config, "accent", "runtime");\n    case "tokens": {');
  }
  if (file === "statusline.ts") {
    code = 'import { createRollingUsageController } from "../../../src/rolling-token-usage.ts";\n' + code;
    code = once(code, '  const refresh = () => runtime.requestRender?.();', '  const rollingUsage = createRollingUsageController({ agentDir: getAgentDir() });\n  const refresh = () => runtime.requestRender?.();');
    code = once(code, '  const installFooter = (ctx: ExtensionContext) => {', '  const installFooter = (ctx: ExtensionContext) => {\n    rollingUsage.dispose();\n    runtime.rollingUsageText = "…";');
    code = once(code, '    if (!activeGitStatusTarget || !loaded) return;', '    if (!activeGitStatusTarget || !ctx.hasUI || !loaded) return;');
    code = once(code, '      runtime.requestRender = () => tui.requestRender();', `      runtime.requestRender = () => tui.requestRender();
      rollingUsage.start(ctx, () => {
        runtime.rollingUsageText = rollingUsage.getText();
        tui.requestRender();
      });
      runtime.rollingUsageText = rollingUsage.getText();`);
    code = once(code, '          if (isActiveGitStatusTarget(cwd, generation)) {', '          if (isActiveGitStatusTarget(cwd, generation)) {\n            rollingUsage.dispose();');
    code = once(code, '    sessionGeneration += 1;', '    rollingUsage.dispose();\n    sessionGeneration += 1;');
    code = once(code, '  pi.on("model_select", () => refresh());', `  pi.on("model_select", (_event, ctx) => {
    if (!ownsRuntime(ctx)) return;
    rollingUsage.refresh(ctx);
    refresh();
  });`);
    code = once(code, '  pi.on("agent_end", (_event, ctx) => {\n    if (!ownsRuntime(ctx)) return;', '  pi.on("agent_end", (_event, ctx) => {\n    if (!ownsRuntime(ctx)) return;\n    rollingUsage.refresh(ctx);');
    code = once(code, '  pi.on("turn_end", (_event, ctx) => {\n    if (!ownsRuntime(ctx)) return;', '  pi.on("turn_end", (_event, ctx) => {\n    if (!ownsRuntime(ctx)) return;\n    rollingUsage.refresh(ctx);');
  }
  // Node's strip-types and Pi's Jiti loader both resolve explicit TS paths.
  return code.replace(/(["'])(\.{1,2}\/[^"']+)\.js\1/g, "$1$2.ts$1");
}
const hashes = {};
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    if (!entry.name.endsWith(".ts")) continue;
    const file = relative(join(source, "src"), path);
    const original = readFileSync(path, "utf8");
    hashes[file] = createHash("sha256").update(original).digest("hex");
    const output = join(target, "src", file);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, '// Generated by scripts/vendor-pi-statusline.mjs from @narumitw/pi-statusline 0.50.2 (MIT).\n' + patch(file, original));
  }
}
visit(join(source, "src"));
writeFileSync(join(target, "LICENSE"), readFileSync(join(source, "LICENSE")));
writeFileSync(join(target, "upstream.json"), JSON.stringify({ package: manifest.name, version: manifest.version, repository: manifest.repository, sha256: hashes }, null, 2) + "\n");
console.log("Generated pi-statusline 0.50.2 with native today token segment.");
