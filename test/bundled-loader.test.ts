import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("..", import.meta.url));

test("production-only package loads through Pi's bundled loader and is selectable by /login ID", async () => {
  // No manual jiti aliases: this must exercise exactly the bundled distribution's
  // embedded module map. A production-like sandbox deliberately has no physical
  // pi-ai peer dependency, so unsupported provider subpath imports cannot pass.
  const bundle = process.env.PI_HOST_BUNDLE ?? join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "bundle", "index.js");
  const host = await import(pathToFileURL(bundle).href);
  const temp = mkdtempSync(join(tmpdir(), "pi-codex-bundle-"));
  try {
    const pkg = join(temp, "package");
    cpSync(join(repo, "src"), join(pkg, "src"), { recursive: true });
    cpSync(join(repo, "package.json"), join(pkg, "package.json"));
    mkdirSync(join(pkg, "node_modules"));
    symlinkSync(dirname(require.resolve("undici/package.json")), join(pkg, "node_modules", "undici"), "dir");
    const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
    assert.equal(manifest.name, "pi-qser3ne-patch");
    assert.equal(manifest.repository.url, "https://github.com/Qser3ne/pi-qser3ne-patch.git");
    const loaded = await host.discoverAndLoadExtensions([pkg], temp, temp);
    assert.deepEqual(loaded.errors, [], "the real production loader must not skip the extension");
    assert.equal(loaded.extensions.length, 1);
    const registrations = loaded.runtime.pendingNativeProviderRegistrations;
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].provider.id, "openai-codex-1");

    const credentials = {
      read: async () => undefined, list: async () => [],
      modify: async () => { throw new Error("this smoke test must not write credentials"); },
      delete: async () => { throw new Error("this smoke test must not delete credentials"); },
    };
    const runtime = await host.ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
    runtime.registerNativeProvider(registrations[0].provider);
    // Exercise the actual UI's option enumeration and exact-ID matching, not a
    // reimplementation of the provider list used by earlier mock-only tests.
    const options = host.InteractiveMode.prototype.getLoginProviderOptions.call({ session: { modelRuntime: runtime } });
    const matches = host.InteractiveMode.prototype.findLoginProviderOptions.call({ getLoginProviderOptions: () => options }, "openai-codex-1");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].authType, "oauth");
    assert.ok(matches[0].method.login);
    host.initTheme("dark", false);
    let selected: string | undefined;
    const selector = new host.OAuthSelectorComponent("login", options, (id: string) => { selected = id; }, () => {}, "openai-codex-1");
    const rendered = selector.render(120).join("\n");
    assert.ok(!rendered.includes("No matching providers"));
    assert.ok(rendered.includes("OpenAI Codex 1(legacy)"), "the actual login selector must show the requested display name");
    assert.ok(!rendered.includes("account 2"));
    selector.handleInput("\r");
    assert.equal(selected, "openai-codex-1");
    assert.equal(await runtime.getAuth("openai-codex-1"), undefined);
    loaded.runtime.invalidate();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
