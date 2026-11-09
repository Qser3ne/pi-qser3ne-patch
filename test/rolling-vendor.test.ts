import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

test("statusline generator reproduces delivered sources and fails closed on upstream drift", t => {
  const tmp = mkdtempSync(join(tmpdir(), "rolling-status-vendor-")); t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const upstream = dirname(require.resolve("@narumitw/pi-statusline/package.json"));
  const output = join(tmp, "vendor");
  const run = (source: string, target = output) => spawnSync(process.execPath, [join(root, "scripts/vendor-pi-statusline.mjs"), source, target], { encoding: "utf8" });
  const result = run(upstream);
  assert.equal(result.status, 0, result.stderr);
  const provenance = JSON.parse(readFileSync(join(root, "vendor/pi-statusline/upstream.json"), "utf8"));
  for (const [file, expected] of Object.entries(provenance.sha256)) {
    assert.equal(hash(readFileSync(join(upstream, "src", file), "utf8")), expected, file);
    assert.equal(readFileSync(join(output, "src", file), "utf8"), readFileSync(join(root, "vendor/pi-statusline/src", file), "utf8"), file);
  }
  for (const file of ["LICENSE", "upstream.json"]) assert.equal(readFileSync(join(output, file), "utf8"), readFileSync(join(root, "vendor/pi-statusline", file), "utf8"));
  const changed = join(tmp, "changed");
  cpSync(join(upstream, "src"), join(changed, "src"), { recursive: true });
  for (const file of ["package.json", "LICENSE"]) cpSync(join(upstream, file), join(changed, file));
  const types = join(changed, "src/types.ts");
  writeFileSync(types, readFileSync(types, "utf8").replace('  "context",', '  "renamed-context",'));
  const drifted = run(changed, join(tmp, "drifted"));
  assert.notEqual(drifted.status, 0);
  assert.match(drifted.stderr, /patch must match once/);
});

test("pure collector files match the unmodified pinned snapshot without a sibling runtime dependency", () => {
  const vendor = join(root, "vendor/pi-token-usage");
  const provenance = JSON.parse(readFileSync(join(vendor, "upstream.json"), "utf8"));
  assert.equal(provenance.commit, "295bfb579ff4d159683f6400cffdeb683c461b54");
  assert.equal(readdirSync(vendor).includes("index.ts"), false);
  for (const [file, expected] of Object.entries(provenance.sha256)) {
    assert.equal(hash(readFileSync(join(vendor, file), "utf8")), expected, file);
  }
});
