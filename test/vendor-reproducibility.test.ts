import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
test("vendored compatibility runtime is reproducible and leaves upstream unmodified", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-usage-reproduce-"));
  const upstream = dirname(require.resolve("@narumitw/pi-usage/package.json"));
  const metadata = JSON.parse(readFileSync(join(root, "vendor/pi-usage/upstream.json"), "utf8"));
  try {
    execFileSync(process.execPath, [join(root, "scripts/vendor-pi-usage.mjs"), upstream, temp]);
    for (const file of [...Object.keys(metadata.sha256), "LICENSE", "upstream.json"]) {
      assert.deepEqual(readFileSync(join(temp, file)), readFileSync(join(root, "vendor/pi-usage", file)), file);
    }
    for (const [file, expected] of Object.entries(metadata.sha256)) {
      const actual = createHash("sha256").update(readFileSync(join(upstream, "dist", file))).digest("hex");
      assert.equal(actual, expected, "the upstream package must not be rewritten");
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
