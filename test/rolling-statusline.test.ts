import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { getKeybindings, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { initTheme, type ExtensionAPI, type ExtensionContext, type ReadonlyFooterDataProvider, type Theme } from "@earendil-works/pi-coding-agent";
import statusline from "../vendor/pi-statusline/src/statusline.ts";
import { createDefaultConfig, normalizeStatuslineConfig, loadStatuslineSettings, saveStatuslineSettingsDocument } from "../vendor/pi-statusline/src/settings.ts";
import { renderStatusline, type RuntimeState } from "../vendor/pi-statusline/src/render.ts";
import { handleStatuslineCommand } from "../vendor/pi-statusline/src/commands.ts";

const theme = { fg: (_c: string, text: string) => text, bold: (text: string) => text } as Theme;
const footerData = { getGitBranch: () => "main", getExtensionStatuses: () => new Map([["token-speed", "40.0 tok/s"]]), getAvailableProviderCount: () => 1, onBranchChange: () => () => {} } as ReadonlyFooterDataProvider;
const runtime: RuntimeState = { turnCount: 0, activeTools: new Map(), isStreaming: false, thinkingLevel: "high", duplicateExtensions: [],
  extensionStatusIconAliases: new Map(), rollingUsageText: "12.3M CH 85.2%" };
const ctx = { cwd: "/project", model: { id: "gpt-test", provider: "a", contextWindow: 272000 },
  sessionManager: { getEntries: () => [] }, getContextUsage: () => ({ percent: 42, contextWindow: 272000 }) } as unknown as ExtensionContext;

test("old layouts gain usage after context once, custom/hidden/empty layouts stay editable", () => {
  const raw = { palette: "ocean", density: "cozy", segments: ["model", "context", "time"], unknown: "keep" };
  const old = normalizeStatuslineConfig(raw);
  assert.deepEqual(old.config.segments, ["model", "context", "usage24h", "time"]);
  assert.equal(old.config.palettePreset, "ocean"); assert.equal(old.config.density, "cozy");
  assert.deepEqual(raw.segments, ["model", "context", "time"]);
  assert.deepEqual(normalizeStatuslineConfig({ segments: old.config.segments }).config.segments, old.config.segments);
  assert.deepEqual(normalizeStatuslineConfig({ segments: ["context", "time"], segmentText: { usage24h: { prefix: "📊 " } } }).config.segments, ["context", "time"]);
  assert.deepEqual(normalizeStatuslineConfig({ segments: [] }).config.segments, []);
  assert.deepEqual(normalizeStatuslineConfig({ segments: ["model"] }).config.segments, ["model"]);
  assert.deepEqual(normalizeStatuslineConfig({ segments: ["context", "line_break", "time"] }).config.segments, ["context", "usage24h", "line_break", "time"]);
  assert.ok(normalizeStatuslineConfig({ segmentText: { usage24h: { prefix: "\x1b[31m" } } }).diagnostics.some(d => d.code === "invalid"));
  assert.ok(createDefaultConfig().segments.includes("usage24h"));
});

test("native segment renders icon and cached value between context and time, fits all widths", () => {
  const config = normalizeStatuslineConfig({ segments: ["model", "context", "time"] }).config;
  for (const trueColor of [true, false]) {
    const line = renderStatusline(240, ctx, footerData, theme, config, runtime, trueColor);
    const plain = stripVTControlCharacters(line);
    assert.match(plain, /ctx 42\.0%\/272k.*📊 12\.3M CH 85\.2%.*🕒/u);
    assert.equal(plain.includes("24h"), false);
    if (!trueColor) assert.equal(/\x1b\[[\d;]*(?:38|48);2;/.test(line), false);
    for (let width = 1; width <= 240; width++) {
      const value = renderStatusline(width, ctx, footerData, theme, config, runtime, trueColor);
      assert.ok(visibleWidth(value) <= width, `${width}: ${visibleWidth(value)}`);
    }
    const narrow = stripVTControlCharacters(renderStatusline(30, ctx, footerData, theme, config, runtime, trueColor));
    assert.match(narrow, /ctx/); assert.equal(narrow.includes("CH"), false);
  }
  config.segmentText.usage24h.prefix = "◎ ";
  assert.match(stripVTControlCharacters(renderStatusline(240, ctx, footerData, theme, config, { ...runtime, rollingUsageText: "unavailable" })), /◎ unavailable/);
  assert.match(stripVTControlCharacters(renderStatusline(240, ctx, footerData, theme, config, { ...runtime, rollingUsageText: "1.0M CH —" })), /◎ 1\.0M CH —/);
});

test("configuration loading never rewrites legacy documents; settings command retains hiding and errors", async t => {
  const root = mkdtempSync(join(tmpdir(), "rolling-status-settings-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "pi-statusline.json");
  const original = JSON.stringify({ segments: ["context", "time"], customFlag: 123 }); writeFileSync(path, original);
  const loaded = loadStatuslineSettings(path);
  assert.equal(readFileSync(path, "utf8"), original);
  assert.ok(loaded.config.segments.includes("usage24h"));
  const hidden = JSON.stringify({ segments: ["context", "time"], customFlag: 123, segmentText: { usage24h: { prefix: "📊 ", suffix: "" } } });
  let applied = false;
  const notices: string[] = [];
  await handleStatuslineCommand("settings", { mode: "tui", hasUI: true, ui: { editor: async () => hidden, notify: (s: string) => notices.push(s) } } as unknown as Parameters<typeof handleStatuslineCommand>[1], {
    settingsPath: path, getLoaded: () => loaded, apply: next => { applied = true; assert.equal(next.config.segments.includes("usage24h"), false); },
  });
  assert.equal(applied, true); assert.equal(JSON.parse(readFileSync(path, "utf8")).customFlag, 123);
  assert.equal(loadStatuslineSettings(path).config.segments.includes("usage24h"), false);
  assert.throws(() => saveStatuslineSettingsDocument(path, '{"segments":["bogus"]}'));
  assert.equal(readFileSync(path, "utf8"), hidden);
  assert.ok(notices.some(s => s.includes("saved and applied")));
});

test("custom layout menu can hide the automatically inserted usage segment across reloads", async t => {
  initTheme("dark", false);
  const root = mkdtempSync(join(tmpdir(), "rolling-status-menu-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "pi-statusline.json"); writeFileSync(path, JSON.stringify({ segments: ["context", "time"], keep: "yes" }));
  let loaded = loadStatuslineSettings(path), screens = 0;
  const notices: string[] = [];
  const inputs = [["\x1b[B", "\x1b[B", "\r"], ["\r"], ["\x1b[B", " ", "\x03"]];
  const commandContext = { mode: "tui", hasUI: true, ui: { notify: (s: string) => notices.push(s), custom: (factory: any) => new Promise(resolve => {
    const component = factory({ requestRender() {}, terminal: { rows: 40, columns: 100 } }, theme, getKeybindings(), resolve);
    assert.ok(component.render(100).length > 0);
    const keys = inputs[screens++]; assert.ok(keys, "unexpected extra menu screen");
    for (const key of keys) component.handleInput(key);
  }) } } as unknown as Parameters<typeof handleStatuslineCommand>[1];
  await handleStatuslineCommand("", commandContext, { settingsPath: path, getLoaded: () => loaded, apply: next => { loaded = next; } });
  assert.deepEqual(notices, []);
  assert.equal(screens, 3);
  assert.deepEqual(loadStatuslineSettings(path).config.segments, ["context", "time"]);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.keep, "yes"); assert.equal(saved.segmentText.usage24h.prefix, "📊 ");
});

test("integrated lifecycle loads usage asynchronously, preserves statuses and clears the footer", async t => {
  initTheme("dark", false);
  const root = mkdtempSync(join(tmpdir(), "rolling-status-life-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const prior = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => { if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = prior; });
  mkdirSync(join(root, "sessions"));
  writeFileSync(join(root, "pi-statusline.json"), JSON.stringify({ segments: ["context", "time"] }));
  const now = new Date().toISOString();
  writeFileSync(join(root, "sessions", "test.jsonl"), [
    { type: "session", version: 3, id: "test", cwd: root, timestamp: now },
    { type: "message", id: "a", timestamp: now, message: { role: "assistant", provider: "a", model: "m", usage: { input: 100000, output: 100000, cacheRead: 800000, cacheWrite: 0, totalTokens: 1000000 } } },
  ].map(v => JSON.stringify(v)).join("\n") + "\n");
  const handlers = new Map<string, Array<(e: any, c: any) => any>>();
  const commands = new Map<string, any>(); let component: (Component & { dispose?(): void }) | undefined;
  let renders = 0;
  const local = { ...ctx, mode: "tui", hasUI: true, cwd: root, scopedModels: [], modelRegistry: { getAvailable: () => [{ provider: "a", id: "m" }] },
    sessionManager: { getEntries: () => [], getSessionDir: () => join(root, "sessions") },
    ui: { notify: () => {}, setStatus: () => {}, setFooter: (factory: any) => {
      component?.dispose?.();
      component = factory?.({ requestRender: () => renders++ }, theme, footerData);
    } },
  };
  statusline({ on: (name: string, fn: any) => handlers.set(name, [...handlers.get(name) ?? [], fn]),
    getThinkingLevel: () => "high", registerCommand: (name: string, def: any) => { assert.equal(commands.has(name), false); commands.set(name, def); },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
  } as unknown as ExtensionAPI);
  const emit = async (name: string, c = local) => { for (const fn of handlers.get(name) ?? []) await fn({ type: name }, c); };
  t.after(() => emit("session_shutdown"));
  await emit("session_start");
  assert.deepEqual([...commands.keys()], ["statusline"]);
  const current = () => stripVTControlCharacters(component?.render(240).join("\n") ?? "");
  const deadline = Date.now() + 3000;
  while (!current().includes("1.0M CH 88.9%") && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  assert.match(current(), /ctx.*📊 1\.0M CH 88\.9%.*🕒/);
  assert.match(current(), /40\.0 tok\/s/);
  assert.ok(renders > 0);
  await emit("session_tree");
  await emit("model_select"); await emit("turn_end"); await emit("agent_end");
  await emit("session_shutdown"); assert.equal(component, undefined);
});
